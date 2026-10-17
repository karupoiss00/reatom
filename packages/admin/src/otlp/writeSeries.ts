import {
  framedByFrameId,
  frameRecordKey,
  isStateWrite,
  recordHasError,
  recordHistory,
  recordValuePreview,
  toRailNode,
} from './bind.ts'
import type { AdminRecord } from './ingest.ts'

export type WritePoint = {
  record: AdminRecord
  start: number
  value: unknown
  numeric: number | undefined
  hasErrorCause: boolean
}

export type HistoryGroupBy = 'cause' | 'route' | 'session' | 'outcome'

export type HistoryGroupBar = {
  label: string
  count: number
}

function parentKeys(record: AdminRecord): string[] {
  const node = toRailNode(record)
  if (!node) return []
  return node.parentIds.map((parentId) =>
    frameRecordKey(record.traceId, String(parentId)),
  )
}

function writeHasErrorCause(
  record: AdminRecord,
  byFrame: Map<string, AdminRecord>,
): boolean {
  if (recordHasError(record)) return true
  const visited = new Set<string>()
  const queue = parentKeys(record)
  while (queue.length > 0) {
    const key = queue.shift()!
    if (visited.has(key)) continue
    visited.add(key)
    const ancestor = byFrame.get(key)
    if (!ancestor) continue
    if (recordHasError(ancestor)) return true
    queue.push(...parentKeys(ancestor))
  }
  return false
}

export function numericWriteValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return undefined
}

export function atomWriteSeries(
  records: readonly AdminRecord[],
  atomName: string,
  sourceId: string,
): WritePoint[] {
  const byFrame = framedByFrameId(records)
  const points: WritePoint[] = []
  for (const record of records) {
    if (!isStateWrite(record)) continue
    if (record.atomName !== atomName || record.sourceId !== sourceId) continue
    const value = recordValuePreview(record)
    points.push({
      record,
      start: record.start,
      value,
      numeric: numericWriteValue(value),
      hasErrorCause: writeHasErrorCause(record, byFrame),
    })
  }
  return points.sort((left, right) =>
    left.start === right.start
      ? left.record.id.localeCompare(right.record.id)
      : left.start - right.start,
  )
}

export function writeCountByAtom(
  records: readonly AdminRecord[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    if (!isStateWrite(record) || record.atomName === undefined) continue
    const key = `${record.sourceId}:${record.atomName}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function firstActionAncestorName(
  record: AdminRecord,
  byFrame: Map<string, AdminRecord>,
): string {
  const visited = new Set<string>()
  const queue = parentKeys(record)
  while (queue.length > 0) {
    const key = queue.shift()!
    if (visited.has(key)) continue
    visited.add(key)
    const ancestor = byFrame.get(key)
    if (!ancestor) continue
    if (ancestor.reatomKind === 'action') {
      return ancestor.atomName ?? ancestor.name
    }
    queue.push(...parentKeys(ancestor))
  }
  return '(none)'
}

function groupLabel(
  point: WritePoint,
  by: HistoryGroupBy,
  byFrame: Map<string, AdminRecord>,
): string {
  if (by === 'outcome') return point.record.outcome ?? 'ok'
  if (by === 'session') {
    const session = point.record.attributes['session.id']
    return typeof session === 'string' && session !== '' ? session : '(none)'
  }
  if (by === 'route') {
    const path = point.record.attributes['url.path']
    if (typeof path === 'string' && path !== '') return path
    const visited = new Set<string>()
    const queue = parentKeys(point.record)
    while (queue.length > 0) {
      const key = queue.shift()!
      if (visited.has(key)) continue
      visited.add(key)
      const ancestor = byFrame.get(key)
      if (!ancestor) continue
      if (ancestor.reatomKind === 'route') {
        return ancestor.atomName ?? ancestor.name
      }
      queue.push(...parentKeys(ancestor))
    }
    return '(none)'
  }
  return firstActionAncestorName(point.record, byFrame)
}

export function groupWriteCounts(
  points: readonly WritePoint[],
  by: HistoryGroupBy,
  records: readonly AdminRecord[],
): HistoryGroupBar[] {
  const byFrame = framedByFrameId(records)
  const counts = new Map<string, number>()
  for (const point of points) {
    const label = groupLabel(point, by, byFrame)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) =>
      right.count === left.count
        ? left.label.localeCompare(right.label)
        : right.count - left.count,
    )
}

function scalarPreview(value: unknown): string | undefined {
  if (value === '***' || value === undefined) return undefined
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

export function formatWriteChangeText(
  record: AdminRecord,
  records: readonly AdminRecord[],
): string | undefined {
  if (!isStateWrite(record)) return undefined
  const next = recordValuePreview(record)
  const nextText = scalarPreview(next)
  if (next === '***') return 'masked'
  const previous = recordHistory(records, record, 1)[0]
  if (previous === undefined) return nextText
  const previousValue = recordValuePreview(previous)
  if (previousValue === '***') return 'masked'
  const previousText = scalarPreview(previousValue)
  if (previousText === undefined || nextText === undefined) return undefined
  return `${previousText} → ${nextText}`
}

export function writeSeriesHeader(points: readonly WritePoint[]): {
  first: number | undefined
  last: number | undefined
  count: number
} {
  return {
    first: points[0]?.start,
    last: points.at(-1)?.start,
    count: points.length,
  }
}
