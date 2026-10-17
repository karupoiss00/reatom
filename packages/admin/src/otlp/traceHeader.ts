import { recordHasError, recordLabel } from './bind.ts'
import type { AdminRecord, AdminRecordOutcome } from './ingest.ts'
import { quoteCalculatorValue } from './calculator.ts'

export const TRACE_TRIAGE_MIN_SPANS = 8

export type TraceKindShare = {
  kind: string
  durationMs: number
  share: number
}

export type TraceHeaderStats = {
  traceId: string
  rootName: string
  durationMs: number
  spanCount: number
  logCount: number
  atomCount: number
  outcome: AdminRecordOutcome
  kindShare: TraceKindShare[]
}

export type TraceTriageSegment = {
  id: 'busiest' | 'errors' | 'slowest'
  label: string
  name: string
  value: string
  tone: 'error' | 'default'
}

export type TraceTriageStats = {
  segments: TraceTriageSegment[]
}

function recordKindName(record: AdminRecord): string {
  return record.reatomKind ?? 'other'
}

function spanDurationMs(record: AdminRecord): number | undefined {
  if (record.kind !== 'span' || record.end === undefined) return undefined
  return Math.max(0, record.end - record.start)
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(ratio * sorted.length) - 1),
  )
  return sorted[index]!
}

export function singleTraceId(
  records: readonly AdminRecord[],
): string | undefined {
  if (records.length === 0) return undefined
  const traceId = records[0]!.traceId
  for (const record of records) {
    if (record.traceId !== traceId) return undefined
  }
  return traceId
}

function rootSpan(records: readonly AdminRecord[]): AdminRecord | undefined {
  const spans = records.filter((record) => record.kind === 'span')
  if (spans.length === 0) return records[0]
  const roots = spans.filter((span) => span.parentSpanId === undefined)
  const pool = roots.length > 0 ? roots : spans
  const action = pool.find((span) => span.reatomKind === 'action')
  if (action) return action
  return pool.reduce((earliest, span) =>
    span.start < earliest.start ? span : earliest,
  )
}

function traceOutcome(records: readonly AdminRecord[]): AdminRecordOutcome {
  if (records.some(recordHasError)) return 'error'
  if (records.some((record) => record.outcome === 'abort')) return 'abort'
  if (records.some((record) => record.outcome === 'suspense')) return 'suspense'
  if (
    records.some(
      (record) =>
        record.kind === 'span' &&
        (record.outcome === 'pending' || record.end === undefined),
    )
  ) {
    return 'pending'
  }
  return 'ok'
}

export function traceHeaderStats(
  records: readonly AdminRecord[],
): TraceHeaderStats | undefined {
  const traceId = singleTraceId(records)
  if (traceId === undefined) return undefined
  const root = rootSpan(records)
  if (root === undefined) return undefined
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = Number.NEGATIVE_INFINITY
  let spanCount = 0
  let logCount = 0
  let atomCount = 0
  const durationByKind = new Map<string, number>()
  for (const record of records) {
    minStart = Math.min(minStart, record.start)
    maxEnd = Math.max(maxEnd, record.end ?? record.start)
    if (record.kind === 'span') spanCount += 1
    if (record.kind === 'log') logCount += 1
    if (record.reatomKind === 'atom') atomCount += 1
    const duration = spanDurationMs(record)
    if (duration === undefined) continue
    const kind = recordKindName(record)
    durationByKind.set(kind, (durationByKind.get(kind) ?? 0) + duration)
  }
  const totalKindMs = [...durationByKind.values()].reduce(
    (sum, duration) => sum + duration,
    0,
  )
  const kindShare: TraceKindShare[] = [...durationByKind.entries()]
    .filter(([, durationMs]) => durationMs > 0)
    .map(([kind, durationMs]) => ({
      kind,
      durationMs,
      share: totalKindMs === 0 ? 0 : durationMs / totalKindMs,
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
  return {
    traceId,
    rootName: recordLabel(root),
    durationMs: Number.isFinite(minStart)
      ? Math.max(0, maxEnd - minStart)
      : 0,
    spanCount,
    logCount,
    atomCount,
    outcome: traceOutcome(records),
    kindShare,
  }
}

export function traceTriageStats(
  records: readonly AdminRecord[],
): TraceTriageStats | undefined {
  const spans = records.filter((record) => record.kind === 'span')
  if (spans.length < TRACE_TRIAGE_MIN_SPANS) return undefined
  const byName = new Map<
    string,
    { count: number; errors: number; durations: number[] }
  >()
  for (const span of spans) {
    const name = recordLabel(span)
    const bucket = byName.get(name) ?? { count: 0, errors: 0, durations: [] }
    bucket.count += 1
    if (recordHasError(span)) bucket.errors += 1
    const duration = spanDurationMs(span)
    if (duration !== undefined) bucket.durations.push(duration)
    byName.set(name, bucket)
  }
  const names = [...byName.entries()]
  const busiest = names.reduce((best, entry) =>
    entry[1].count > best[1].count ? entry : best,
  )
  const errorNames = names.filter(([, bucket]) => bucket.errors > 0)
  const mostErrors =
    errorNames.length === 0
      ? undefined
      : errorNames.reduce((best, entry) =>
          entry[1].errors > best[1].errors ? entry : best,
        )
  const timed = names.filter(([, bucket]) => bucket.durations.length > 0)
  const slowest =
    timed.length === 0
      ? undefined
      : timed.reduce((best, entry) => {
          const p95 = percentile(
            [...entry[1].durations].sort((left, right) => left - right),
            0.95,
          )
          const bestP95 = percentile(
            [...best[1].durations].sort((left, right) => left - right),
            0.95,
          )
          return p95 > bestP95 ? entry : best
        })
  const segments: TraceTriageSegment[] = [
    {
      id: 'busiest',
      label: 'Busiest',
      name: busiest[0],
      value: `${busiest[1].count}×`,
      tone: 'default',
    },
  ]
  if (mostErrors !== undefined) {
    segments.push({
      id: 'errors',
      label: 'Most errors',
      name: mostErrors[0],
      value: String(mostErrors[1].errors),
      tone: 'error',
    })
  }
  if (slowest !== undefined) {
    const p95 = percentile(
      [...slowest[1].durations].sort((left, right) => left - right),
      0.95,
    )
    segments.push({
      id: 'slowest',
      label: 'Slowest p95',
      name: slowest[0],
      value: `${Math.round(p95)}ms`,
      tone: 'default',
    })
  }
  return { segments }
}

export function triageNameFilter(name: string): string {
  return `name=${quoteCalculatorValue(name)}`
}

export function shortenTraceId(traceId: string): string {
  return traceId.length <= 8 ? traceId : traceId.slice(0, 8)
}

export function kindShareColorVar(
  kind: string,
): 'action' | 'atom' | 'computed' | 'effect' | 'other' {
  if (
    kind === 'action' ||
    kind === 'atom' ||
    kind === 'computed' ||
    kind === 'effect'
  ) {
    return kind
  }
  return 'other'
}
