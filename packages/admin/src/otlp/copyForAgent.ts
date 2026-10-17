import { quoteCalculatorValue } from './calculator.ts'
import { resolveCauseChips } from './causeChips.ts'
import {
  firstExceptionMessageLine,
  LOCAL_VALUES,
  recordErrorMessage,
  recordErrorStack,
  recordErrorType,
  recordReatomName,
  stackCulprit,
  type AdminRecord,
} from './ingest.ts'
import { recordHasError, recordLabel } from './bind.ts'
import { recordValues } from './values.ts'

const LIVE_TEXT_CAP = 4096

function safeLiveText(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    const text = JSON.stringify(value, (_key, inner) => {
      if (typeof inner === 'bigint') return inner.toString()
      if (inner !== null && typeof inner === 'object') {
        if (seen.has(inner)) return '[Circular]'
        seen.add(inner)
      }
      return inner
    })
    if (text === undefined) return '[unserializable]'
    return text.length > LIVE_TEXT_CAP
      ? `${text.slice(0, LIVE_TEXT_CAP - 1)}…`
      : text
  } catch {
    return '[unserializable]'
  }
}

export function frameCalculatorExpression(record: AdminRecord): string {
  return `name=${quoteCalculatorValue(recordReatomName(record))}`
}

export function frameMcpSnippet(record: AdminRecord): string {
  return `getRecord({ id: ${JSON.stringify(record.id)} })`
}

export function copyForAgentMarkdown(
  record: AdminRecord,
  records: readonly AdminRecord[],
  includeLive: boolean,
): string {
  const duration =
    record.end === undefined ? 'open' : `${Math.round(record.end - record.start)}ms`
  const causes = resolveCauseChips(record, records)
    .map((chip) => chip.name)
    .join(', ')
  const lines = [
    `# ${recordLabel(record)}`,
    `outcome: ${record.outcome ?? (recordHasError(record) ? 'error' : 'ok')}`,
    `duration: ${duration}`,
    `trace: ${record.traceId}`,
  ]
  if (causes !== '') lines.push(`causes: ${causes}`)
  if (recordHasError(record)) {
    const type = recordErrorType(record)
    const message = firstExceptionMessageLine(recordErrorMessage(record))
    if (type !== '' || message !== '') {
      lines.push(`exception: ${[type, message].filter(Boolean).join(' — ')}`)
    }
    const culprit = stackCulprit(recordErrorStack(record))
    if (culprit) lines.push(`culprit: ${culprit}`)
  }
  const values = recordValues(record)
  if (!includeLive && values.source === 'local') {
    lines.push('params: masked')
  } else if (includeLive) {
    const live = record[LOCAL_VALUES]
    if (live !== undefined) {
      lines.push(`live: ${safeLiveText(live)}`)
    }
  }
  return lines.join('\n')
}
