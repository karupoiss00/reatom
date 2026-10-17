import { isInProgressRecord } from '../otlp/inProgress'
import type { AdminRecord } from '../otlp/ingest'

export type GanttBarMark = 'filled' | 'hollow' | 'hatch'

export type GanttColorBy = 'kind' | 'outcome' | 'service'

const FILLED_KINDS = new Set([
  'action',
  'effect',
  'route',
  'loader',
  'render',
])

const UPDATE_EVENTS = new Set(['reatom.atom.update', 'reatom.computed.update'])

export function isUpdateLog(record: AdminRecord): boolean {
  return record.kind === 'log' && UPDATE_EVENTS.has(record.eventName ?? '')
}

export function recordBarMark(record: AdminRecord): GanttBarMark {
  if (isInProgressRecord(record) || record.outcome === 'pending') return 'hatch'
  if (record.kind === 'span' && record.reatomKind === 'computed') return 'hollow'
  if (record.kind === 'span' && FILLED_KINDS.has(record.reatomKind ?? 'action')) {
    return 'filled'
  }
  if (record.kind === 'span') return 'filled'
  return 'filled'
}

export function recordSourceIds(records: readonly AdminRecord[]): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.sourceId)) continue
    seen.add(record.sourceId)
    ids.push(record.sourceId)
  }
  return ids
}

export function colorByChoices(
  records: readonly AdminRecord[],
): Array<{ value: GanttColorBy; label: string }> {
  const choices: Array<{ value: GanttColorBy; label: string }> = [
    { value: 'kind', label: 'Kind' },
    { value: 'outcome', label: 'Outcome' },
  ]
  if (recordSourceIds(records).length > 1) {
    choices.push({ value: 'service', label: 'Service' })
  }
  return choices
}

export function legendKinds(records: readonly AdminRecord[]): string[] {
  const kinds: string[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const kind = record.reatomKind ?? (record.kind === 'log' ? 'log' : 'action')
    if (seen.has(kind)) continue
    seen.add(kind)
    kinds.push(kind)
  }
  return kinds
}

export function kindLegendClause(kind: string): string {
  return `kind:${kind}`
}
