import { quoteCalculatorValue } from './calculator.ts'
import { resolveCauseChips } from './causeChips.ts'
import {
  firstExceptionMessageLine,
  LOCAL_VALUES,
  recordErrorMessage,
  recordErrorType,
  recordReatomName,
  stackCulprit,
  type AdminRecord,
} from './ingest.ts'
import { recordHasError, recordLabel } from './bind.ts'
import { recordValues } from './values.ts'

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
    const culprit = stackCulprit(
      record.error?.stack ??
        (typeof record.attributes['exception.stacktrace'] === 'string'
          ? record.attributes['exception.stacktrace']
          : undefined),
    )
    if (culprit) lines.push(`culprit: ${culprit}`)
  }
  const values = recordValues(record)
  if (!includeLive && values.source === 'local') {
    lines.push('params: masked')
  } else if (includeLive) {
    const live = record[LOCAL_VALUES]
    if (live !== undefined) {
      lines.push(`live: ${JSON.stringify(live)}`)
    }
  }
  return lines.join('\n')
}
