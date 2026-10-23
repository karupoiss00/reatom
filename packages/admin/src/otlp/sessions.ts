import { recordHasError } from './bind.ts'
import type { AdminRecord } from './ingest.ts'

export interface InvestigationSession {
  id: string
  sessionId?: string
  label: string
  boundary: string
  records: AdminRecord[]
  start: number
  end: number
  pages: number
  errors: number
  entry?: string
  last?: string
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(stable))
  if (value && typeof value === 'object')
    return JSON.stringify(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    )
  return JSON.stringify(value) ?? 'undefined'
}

/** Resource identity is conservative: never join sources or distinct resources. */
function boundaryOf(record: AdminRecord): string {
  const resource = Object.fromEntries(
    Object.entries(record.resource).filter(([key]) => key !== 'session.id'),
  )
  return stable([record.sourceId, resource])
}
function identity(record: AdminRecord): string | undefined {
  const value = record.attributes['session.id'] ?? record.resource['session.id']
  return typeof value === 'string' && value !== '' ? value : undefined
}
export function journeySignal(
  record: AdminRecord,
): 'errors' | 'spans' | 'logs' | 'measurements' {
  if (sessionRecordHasError(record)) return 'errors'
  if (record.kind === 'span') return 'spans'
  if (
    record.eventName === 'measurement' &&
    typeof record.attributes['measurement.type'] === 'string'
  ) {
    const values = record.attributes['measurement.values']
    if (
      values &&
      typeof values === 'object' &&
      !Array.isArray(values) &&
      Object.values(values).every(
        (value) => typeof value === 'number' && Number.isFinite(value),
      )
    )
      return 'measurements'
  }
  return 'logs'
}
export function sessionPage(record: AdminRecord): string | undefined {
  const path =
    record.attributes['url.path'] ??
    record.attributes['page.url'] ??
    record.attributes['url.full']
  return typeof path === 'string' ? path : undefined
}

/**
 * Explicit ownership wins. Trace correlation requires one owner in this
 * boundary.
 */
export function investigationSessions(
  records: readonly AdminRecord[],
): InvestigationSession[] {
  const owners = new Map<string, Set<string>>()
  for (const record of records) {
    const session = identity(record)
    if (!session || !record.traceId) continue
    const key = stable([boundaryOf(record), record.traceId])
    const set = owners.get(key) ?? new Set<string>()
    set.add(session)
    owners.set(key, set)
  }
  const groups = new Map<string, InvestigationSession>()
  for (const record of records) {
    const boundary = boundaryOf(record)
    const traceOwners = record.traceId
      ? owners.get(stable([boundary, record.traceId]))
      : undefined
    const sessionId =
      identity(record) ??
      (traceOwners?.size === 1 ? [...traceOwners][0] : undefined)
    const id = stable([boundary, sessionId ?? null])
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        sessionId,
        label: sessionId ?? 'Diagnostic capture',
        boundary,
        records: [],
        start: record.start,
        end: record.start,
        pages: 0,
        errors: 0,
      }
      groups.set(id, group)
    }
    group.records.push(record)
    group.start = Math.min(group.start, record.start)
    group.end = Math.max(group.end, record.end ?? record.start)
    if (sessionRecordHasError(record)) group.errors++
  }
  for (const group of groups.values()) {
    group.records.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    const pages = group.records.filter(
      (record) => record.kind === 'log' && record.eventName === 'app.page_view',
    )
    group.pages = pages.length
    group.entry = pages[0] ? sessionPage(pages[0]) : undefined
    group.last = pages.at(-1) ? sessionPage(pages.at(-1)!) : undefined
  }
  return [...groups.values()].sort(
    (a, b) => b.start - a.start || a.id.localeCompare(b.id),
  )
}

export function sessionSearchText(record: AdminRecord): string {
  const values = [
    record.name,
    record.traceId,
    record.spanId,
    record.sourceId,
    record.error?.message,
    record.body,
    ...Object.values(record.attributes),
    ...Object.values(record.resource),
  ]
  return values
    .map((value) =>
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '',
    )
    .join(' ')
    .toLowerCase()
}

export function sessionRecordHasError(record: AdminRecord): boolean {
  return (
    recordHasError(record) ||
    (record.kind === 'log' &&
      record.eventName === 'exception' &&
      record.outcome !== 'abort' &&
      record.outcome !== 'suspense')
  )
}

export function sessionSource(session: InvestigationSession): string {
  const record = session.records[0]!
  return [
    record.sourceId,
    record.resource['service.name'],
    record.resource['service.instance.id'],
  ]
    .filter((value) => typeof value === 'string' && value !== '')
    .join(' · ')
}
