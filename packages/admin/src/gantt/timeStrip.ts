import { recordHasError } from '../otlp/bind'
import type { AdminRecord } from '../otlp/ingest'
import { isInProgressRecord } from '../otlp/inProgress'
import type { GanttTime } from './reatomGantt'

export type TimeStripStack = {
  left: number
  width: number
  kinds: Array<{ kind: string; share: number; count: number }>
}

export type TimeStripGap = {
  left: number
  width: number
  reason: 'pause' | 'dropped' | 'tail'
}

export type TimeStripModel = {
  stacks: TimeStripStack[]
  errorTicks: number[]
  gaps: TimeStripGap[]
  viewport: { left: number; width: number } | null
}

const BUCKET_COUNT = 48

function kindName(record: AdminRecord): string {
  return record.reatomKind ?? (record.kind === 'log' ? 'log' : 'action')
}

function fraction(time: number, range: GanttTime): number {
  const span = range.end - range.start
  if (!(span > 0)) return 0
  return (time - range.start) / span
}

export function timeStripModel(
  records: readonly AdminRecord[],
  range: GanttTime | null,
  viewport: GanttTime | null,
  options: { paused: boolean; dropped: boolean; now?: number } = {
    paused: false,
    dropped: false,
  },
): TimeStripModel | null {
  if (range === null) return null
  const safeRange: GanttTime =
    range.end > range.start ? range : { start: range.start, end: range.start + 1 }
  const span = safeRange.end - safeRange.start
  const bucketMs = span / BUCKET_COUNT
  const buckets = Array.from({ length: BUCKET_COUNT }, () => new Map<string, number>())
  const errorTicks: number[] = Array.from({ length: BUCKET_COUNT })
  let latest = Number.NEGATIVE_INFINITY
  for (const record of records) {
    if (isInProgressRecord(record)) continue
    const end = record.end ?? record.start
    if (end > latest) latest = end
    if (recordHasError(record)) {
      const errorBucket = Math.max(
        0,
        Math.min(
          BUCKET_COUNT - 1,
          Math.floor((record.start - safeRange.start) / bucketMs),
        ),
      )
      errorTicks[errorBucket] = (errorBucket + 0.5) / BUCKET_COUNT
    }
    const startBucket = Math.max(
      0,
      Math.min(BUCKET_COUNT - 1,         Math.floor((record.start - safeRange.start) / bucketMs)),
    )
    const endBucket = Math.max(
      startBucket,
      Math.min(
        BUCKET_COUNT - 1,
        Math.floor(((record.end ?? record.start) - safeRange.start) / bucketMs),
      ),
    )
    const kind = kindName(record)
    for (let index = startBucket; index <= endBucket; index++) {
      const bucket = buckets[index]!
      bucket.set(kind, (bucket.get(kind) ?? 0) + 1)
    }
  }
  const stacks: TimeStripStack[] = []
  for (let index = 0; index < BUCKET_COUNT; index++) {
    const bucket = buckets[index]!
    if (bucket.size === 0) continue
    const total = [...bucket.values()].reduce((sum, count) => sum + count, 0)
    stacks.push({
      left: index / BUCKET_COUNT,
      width: 1 / BUCKET_COUNT,
      kinds: [...bucket.entries()]
        .map(([kind, count]) => ({
          kind,
          count,
          share: total === 0 ? 0 : count / total,
        }))
        .sort((left, right) => right.count - left.count),
    })
  }
  const gaps: TimeStripGap[] = []
  if (options.dropped) {
    gaps.push({ left: 0, width: 0.04, reason: 'dropped' })
  }
  const tailStart = Number.isFinite(latest) ? fraction(latest, safeRange) : 1
  if (tailStart < 1) {
    gaps.push({
      left: Math.max(0, tailStart),
      width: Math.max(0, 1 - tailStart),
      reason: options.paused ? 'pause' : 'tail',
    })
  } else if (options.paused) {
    const now = options.now ?? safeRange.end
    const left = Math.min(
      1,
      Math.max(0, fraction(now > latest ? latest : now, safeRange)),
    )
    if (left < 1) {
      gaps.push({ left, width: 1 - left, reason: 'pause' })
    }
  }
  let viewportBox: { left: number; width: number } | null = null
  if (viewport !== null && viewport.end > viewport.start) {
    const left = Math.min(1, Math.max(0, fraction(viewport.start, safeRange)))
    const right = Math.min(1, Math.max(0, fraction(viewport.end, safeRange)))
    viewportBox = { left, width: Math.max(0.01, right - left) }
  }
  return {
    stacks,
    errorTicks: errorTicks.filter((tick): tick is number => tick !== undefined),
    gaps,
    viewport: viewportBox,
  }
}

export function timeStripViewport(
  range: GanttTime,
  viewport: GanttTime | null,
): { left: number; width: number } | null {
  if (viewport === null || viewport.end <= viewport.start) return null
  const safeRange: GanttTime =
    range.end > range.start ? range : { start: range.start, end: range.start + 1 }
  const left = Math.min(1, Math.max(0, fraction(viewport.start, safeRange)))
  const right = Math.min(1, Math.max(0, fraction(viewport.end, safeRange)))
  return { left, width: Math.max(0.01, right - left) }
}

export function timeAtStripFraction(range: GanttTime, fractionValue: number): number {
  return range.start + (range.end - range.start) * Math.min(1, Math.max(0, fractionValue))
}

export function hoverKindCounts(
  model: TimeStripModel,
  fractionValue: number,
): Array<{ kind: string; count: number }> {
  const stack = model.stacks.find(
    (entry) =>
      fractionValue >= entry.left && fractionValue < entry.left + entry.width,
  )
  return stack?.kinds ?? []
}
