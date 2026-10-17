import { appendCalculatorClause, quoteCalculatorValue } from '../otlp/calculator'
import { recordErrorType } from '../otlp/ingest'
import type { AdminRecord } from '../otlp/ingest'
import { recordValues } from '../otlp/values'

export type RowChipTone = 'default' | 'error'

export type RowChip = {
  id: string
  label: string
  clause: string
  tone: RowChipTone
}

const PREVIEW_CAP = 16

function paramsPreview(record: AdminRecord): string | undefined {
  const values = recordValues(record)
  const params = values.params
  if (params === undefined) return undefined
  if (Array.isArray(params)) {
    if (params.length === 0) return undefined
    const first = params[0]
    if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean') {
      const text = String(first)
      return text.length > PREVIEW_CAP ? `${text.slice(0, PREVIEW_CAP - 1)}…` : text
    }
    return `${params.length}`
  }
  if (typeof params === 'string') {
    return params.length > PREVIEW_CAP ? `${params.slice(0, PREVIEW_CAP - 1)}…` : params
  }
  return undefined
}

export function recordRowChips(record: AdminRecord): RowChip[] {
  const chips: RowChip[] = []
  if (record.outcome !== undefined) {
    chips.push({
      id: 'outcome',
      label: record.outcome,
      clause: `outcome:${record.outcome}`,
      tone: record.outcome === 'error' ? 'error' : 'default',
    })
  }
  const preview = paramsPreview(record)
  if (preview !== undefined) {
    chips.push({
      id: 'params',
      label: preview,
      clause: `name=${quoteCalculatorValue(record.atomName ?? record.name)}`,
      tone: 'default',
    })
  }
  if (record.causeIds.length > 0) {
    const firstCause = record.causeIds[0]!
    chips.push({
      id: 'causes',
      label: `←${record.causeIds.length}`,
      clause: `cause>${quoteCalculatorValue(firstCause)}`,
      tone: 'default',
    })
  }
  const errorType = recordErrorType(record)
  if (errorType !== '') {
    chips.push({
      id: 'error-type',
      label: errorType,
      clause: `attr.exception.type=${quoteCalculatorValue(errorType)}`,
      tone: 'error',
    })
  }
  return chips
}

export function visibleRowChips(chips: readonly RowChip[], limit = 3): {
  shown: RowChip[]
  extra: number
} {
  if (chips.length <= limit) return { shown: [...chips], extra: 0 }
  return { shown: chips.slice(0, limit), extra: chips.length - limit }
}

export function rowChipDraft(
  draft: string,
  chip: RowChip,
  negate: boolean,
): string {
  return appendCalculatorClause(draft, chip.clause, negate)
}
