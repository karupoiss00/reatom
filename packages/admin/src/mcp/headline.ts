import type { AdminMcpFilter, AdminMcpHeader, AdminMcpMiss, AdminMcpOk } from './types.ts'
import { describeMcpFilter } from './filterSentence.ts'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms >= 1000) {
    const seconds = ms / 1000
    return `${seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1).replace(/\.0$/, '')}s`
  }
  return `${Math.round(ms)}ms`
}

export function errorCountPhrase(errorCount: number): string {
  if (errorCount <= 0) return 'no errors'
  return plural(errorCount, 'error')
}

export function countsHeadline(
  header: Pick<AdminMcpHeader, 'recordCount' | 'errorCount'>,
  extra: string[] = [],
): string {
  const parts = [
    plural(header.recordCount, 'record'),
    errorCountPhrase(header.errorCount),
    ...extra,
  ]
  return parts.join(' · ')
}

export function tracesHeadline(
  header: Pick<AdminMcpHeader, 'traceCount' | 'errorCount'>,
  extra: string[] = [],
): string {
  return [plural(header.traceCount, 'trace'), errorCountPhrase(header.errorCount), ...extra].join(
    ' · ',
  )
}

export function missHeadline(result: Pick<AdminMcpMiss, 'missing' | 'id' | 'path' | 'error'>): string {
  if (result.missing === 'too-large') return 'too large for the 20 KB cap'
  if (result.missing === 'filter') {
    return result.error ? `filter error: ${result.error}` : 'filter error'
  }
  if (result.missing === 'remote') {
    return result.id ? `ClickHouse failed: ${result.id}` : 'ClickHouse failed'
  }
  const target = result.id ?? result.path
  return target ? `missing ${result.missing} ${target}` : `missing ${result.missing}`
}

export function slowestPhrase(name: string | undefined, durationMs: number | undefined): string | undefined {
  if (!name || durationMs === undefined || !Number.isFinite(durationMs)) {
    return undefined
  }
  return `slowest ${name} ${formatDurationMs(durationMs)}`
}

export function searchHeadline(
  header: Pick<AdminMcpHeader, 'recordCount' | 'errorCount'>,
  filter: AdminMcpFilter | undefined,
  slowest?: string,
): string {
  const extra = [slowest, describeMcpFilter(filter)].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return countsHeadline(header, extra)
}

export function truncationHints(
  tool: string,
  result: AdminMcpOk<unknown> | AdminMcpMiss,
  nextCall?: string,
): string[] | undefined {
  if (!result.ok) return undefined
  const hints: string[] = []
  if (result.header.truncated) {
    hints.push(nextCall ?? `${tool} with nextCursor`)
  }
  if (result.header.valuesTruncated) {
    hints.push('getRecord <id> for full params')
  }
  return hints.length > 0 ? hints : undefined
}

export function nextCursorHint(tool: string, cursor: string | undefined, extra = ''): string | undefined {
  if (cursor === undefined) return undefined
  const suffix = extra === '' ? '' : `, ${extra}`
  return `${tool} { cursor: "${cursor}"${suffix} }`
}
