import { recordHasError, recordLabel } from './bind.ts'
import {
  buildCalculatorIndex,
  parseFilterCalculator,
  recordMatchesCalculator,
  type CalculatorParse,
  type CalculatorRecordIndex,
} from './calculator.ts'
import type { AdminRecord } from './ingest.ts'
import { recordValuesText } from './values.ts'
import type { AdminMcpFilter } from '../mcp/types.ts'
import type { FilterMode } from '../types.ts'

export interface OtlpFilterIndex {
  records(): readonly AdminRecord[]
  byTrace(traceId: string): readonly AdminRecord[]
}

export function matchesQuery(record: AdminRecord, query: string): boolean {
  const needle = query.toLowerCase()
  const parts = [
    record.name,
    record.atomName,
    record.eventName,
    record.outcome,
    record.error?.type,
    record.error?.message,
  ]
  if (typeof record.body === 'string') parts.push(record.body)
  for (const [key, value] of Object.entries(record.attributes)) {
    parts.push(key)
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      parts.push(String(value))
    }
  }
  if (
    parts.some(
      (part) => part !== undefined && part.toLowerCase().includes(needle),
    )
  ) {
    return true
  }
  const localText = recordValuesText(record)
  return localText !== '' && localText.toLowerCase().includes(needle)
}

function nameCandidates(record: AdminRecord): string[] {
  const names = [record.name]
  if (record.atomName !== undefined) names.push(record.atomName)
  const label = recordLabel(record)
  if (!names.includes(label)) names.push(label)
  return names
}

/** Case-insensitive substring of the span name, atom name, or label. `*` is a whole-value glob. */
function matchesName(record: AdminRecord, name: string): boolean {
  const candidates = nameCandidates(record)
  if (name.includes('*')) {
    const escaped = name.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i')
    return candidates.some((candidate) => pattern.test(candidate))
  }
  const needle = name.toLowerCase()
  return candidates.some((candidate) =>
    candidate.toLowerCase().includes(needle),
  )
}

export function recordMatches(
  record: AdminRecord,
  filter: AdminMcpFilter | undefined,
  calculator: CalculatorParse | undefined = parseFilterCalculator(filter),
  index?: CalculatorRecordIndex,
): boolean {
  if (!filter) return true
  if (filter.traceId && record.traceId !== filter.traceId) return false
  if (filter.name && !matchesName(record, filter.name)) return false
  if (filter.kind && record.kind !== filter.kind) return false
  if (filter.reatomKind && record.reatomKind !== filter.reatomKind) return false
  if (filter.hasError === true && !recordHasError(record)) return false
  if (filter.hasError === false && recordHasError(record)) return false
  if (filter.query && !matchesQuery(record, filter.query)) return false
  if (!recordMatchesCalculator(record, calculator, index)) return false
  return true
}

export function candidateRecords(
  admin: OtlpFilterIndex,
  filter: AdminMcpFilter | undefined,
): readonly AdminRecord[] {
  if (filter?.traceId) return admin.byTrace(filter.traceId)
  return admin.records()
}

export function filteredRecords(
  admin: OtlpFilterIndex,
  filter: AdminMcpFilter | undefined,
  calculator: CalculatorParse | undefined = parseFilterCalculator(filter),
): AdminRecord[] {
  const records = candidateRecords(admin, filter)
  const index =
    calculator !== undefined && calculator.ok
      ? buildCalculatorIndex(admin.records())
      : undefined
  return records.filter((record) =>
    recordMatches(record, filter, calculator, index),
  )
}

/**
 * Match predicates that Hide / Highlight / Exclude invert or mark.
 * `traceId` is a candidate-set scope, not a match — a trace-only Hide
 * must not empty the scoped trace.
 */
export function hasActiveFilter(
  filter: AdminMcpFilter | undefined,
): boolean {
  if (!filter) return false
  return (
    filter.name !== undefined ||
    filter.kind !== undefined ||
    filter.reatomKind !== undefined ||
    filter.hasError !== undefined ||
    filter.query !== undefined ||
    (filter.calculator !== undefined && filter.calculator.trim() !== '')
  )
}

export function filterMode(
  filter: AdminMcpFilter | undefined,
): FilterMode {
  return filter?.mode ?? 'show'
}

/**
 * Apply calculator/chip mode to already-matched records. `show` keeps
 * matches. `highlight` keeps every candidate so Activity / MCP can mark
 * matches in place. `hide` and `exclude` both drop matches from the
 * candidate set — on this live OTLP path there is one filter, so they
 * are the same (Reporter saved rules used exclude as a pre-filter).
 * Empty match predicates ignore mode so Hide cannot wipe an unfiltered
 * feed. `traceId` scopes candidates and is not itself a match.
 */
export function applyFilterMode(
  candidates: readonly AdminRecord[],
  matched: readonly AdminRecord[],
  filter: AdminMcpFilter | undefined,
): AdminRecord[] {
  if (!hasActiveFilter(filter)) return [...candidates]
  const mode = filterMode(filter)
  if (mode === 'show') return [...matched]
  if (mode === 'highlight') return [...candidates]
  const matchedIds = new Set(matched.map((record) => record.id))
  return candidates.filter((record) => !matchedIds.has(record.id))
}

export function recordsForFilter(
  admin: OtlpFilterIndex,
  filter: AdminMcpFilter | undefined,
  calculator: CalculatorParse | undefined = parseFilterCalculator(filter),
): {
  matched: AdminRecord[]
  visible: AdminRecord[]
  highlightedIds: Set<string>
} {
  const matched = filteredRecords(admin, filter, calculator)
  const visible = applyFilterMode(
    candidateRecords(admin, filter),
    matched,
    filter,
  )
  return {
    matched,
    visible,
    highlightedIds: highlightedRecordIds(matched, filter),
  }
}

export function visibleRecords(
  admin: OtlpFilterIndex,
  filter: AdminMcpFilter | undefined,
  calculator: CalculatorParse | undefined = parseFilterCalculator(filter),
): AdminRecord[] {
  return recordsForFilter(admin, filter, calculator).visible
}

export function highlightedRecordIds(
  matched: readonly AdminRecord[],
  filter: AdminMcpFilter | undefined,
): Set<string> {
  if (filterMode(filter) !== 'highlight' || !hasActiveFilter(filter)) {
    return new Set()
  }
  return new Set(matched.map((record) => record.id))
}
