import { adminRecordSpanKey } from '../gantt/records'
import type { AdminRecord } from './ingest'

export const IN_PROGRESS_NAME = 'In progress'
export const IN_PROGRESS_ID_PREFIX = 'in-progress:'

export function isInProgressRecord(record: { id: string }): boolean {
  return record.id.startsWith(IN_PROGRESS_ID_PREFIX)
}

export function isAbortOrSuspense(record: AdminRecord): boolean {
  return record.outcome === 'abort' || record.outcome === 'suspense'
}

export function inProgressRecord(log: AdminRecord, start: number): AdminRecord {
  return {
    id: `${IN_PROGRESS_ID_PREFIX}${adminRecordSpanKey(log)}`,
    sourceId: log.sourceId,
    kind: 'span',
    traceId: log.traceId,
    spanId: log.spanId,
    name: IN_PROGRESS_NAME,
    start,
    attributes: {},
    resource: log.resource,
    links: [],
    causeIds: [],
    outcome: 'pending',
  }
}

export function syncInProgressRecords(
  visible: readonly AdminRecord[],
  previous: readonly AdminRecord[],
  alsoLanded: ReadonlySet<string> = new Set(),
): AdminRecord[] {
  const landed = new Set(alsoLanded)
  for (const record of visible) {
    if (record.kind === 'span') landed.add(adminRecordSpanKey(record))
  }

  const previousByKey = new Map<string, AdminRecord>()
  for (const record of previous) {
    previousByKey.set(adminRecordSpanKey(record), record)
  }

  const earliestLog = new Map<string, AdminRecord>()
  for (const record of visible) {
    if (record.kind !== 'log') continue
    const key = adminRecordSpanKey(record)
    if (landed.has(key)) continue
    const current = earliestLog.get(key)
    if (current === undefined || record.start < current.start) {
      earliestLog.set(key, record)
    }
  }

  const next: AdminRecord[] = []
  for (const [key, record] of earliestLog) {
    const existing = previousByKey.get(key)
    if (existing) {
      next.push(
        record.start < existing.start
          ? { ...existing, start: record.start }
          : existing,
      )
      continue
    }
    next.push(inProgressRecord(record, record.start))
  }
  return next
}
