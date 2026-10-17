import type { AdminRecord } from './ingest.ts'
import { ANALYTICS_MIN_SHARE_SESSIONS } from './analytics.ts'
import { CLICKHOUSE_FETCH_LIMIT } from './clickhouse.ts'

export interface FreshnessInput {
  source: 'live' | 'replay' | 'remote'
  paused: boolean
  waiting: number
  now: number
  records: readonly AdminRecord[]
}

export interface AttentionItem {
  id: string
  text: string
  next: string
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})

const UNIX_MS_FLOOR = 1_000_000_000_000
const MEANINGLESS_AGE_MS = 365 * 86_400_000

export function formatRecordAge(now: number, then: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function captureClockNow(
  records: readonly AdminRecord[],
  wallNow: number,
): number {
  const latest = latestRecordTime(records)
  if (latest === undefined) return wallNow
  const latestIsUnix = latest >= UNIX_MS_FLOOR
  const nowIsUnix = wallNow >= UNIX_MS_FLOOR
  if (latestIsUnix === nowIsUnix) return Math.max(wallNow, latest)
  return latest
}

export function formatCaptureAge(
  now: number,
  then: number,
): string | undefined {
  if (!Number.isFinite(now) || !Number.isFinite(then) || now < then) {
    return undefined
  }
  if (now - then > MEANINGLESS_AGE_MS) return undefined
  return formatRecordAge(now, then)
}

export function latestRecordTime(
  records: readonly AdminRecord[],
): number | undefined {
  let latest: number | undefined
  for (const record of records) {
    const time = record.end ?? record.start
    if (latest === undefined || time > latest) latest = time
  }
  return latest
}

export function loadedRecordWindow(records: readonly AdminRecord[]): {
  start: number
  end: number
  spans: number
  logs: number
} | undefined {
  if (records.length === 0) return undefined
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  let spans = 0
  let logs = 0
  for (const record of records) {
    start = Math.min(start, record.start)
    end = Math.max(end, record.end ?? record.start)
    if (record.kind === 'log') logs += 1
    else spans += 1
  }
  return { start, end, spans, logs }
}

export function freshnessStateLabel(input: FreshnessInput): string {
  if (input.source === 'remote') {
    const window = loadedRecordWindow(input.records)
    if (window === undefined) {
      return `ClickHouse · newest ${CLICKHOUSE_FETCH_LIMIT} spans · ${CLICKHOUSE_FETCH_LIMIT} logs`
    }
    return `ClickHouse · loaded ${timeFormat.format(window.start)}–${timeFormat.format(window.end)} · ${window.spans} spans · ${window.logs} logs`
  }
  if (input.source === 'replay') return 'Replay'
  if (input.paused) {
    return input.waiting > 0
      ? `Paused · ${input.waiting} waiting`
      : 'Paused'
  }
  return 'Capturing'
}

export function freshnessAgeLabel(
  input: FreshnessInput,
  latest = latestRecordTime(input.records),
): string | undefined {
  if (input.source !== 'live' || input.paused) return undefined
  if (latest === undefined) return undefined
  const now = captureClockNow(input.records, input.now)
  const age = formatCaptureAge(now, latest)
  if (age === undefined) return undefined
  return `last record ${age}`
}

export function freshnessLabel(input: FreshnessInput): string {
  const state = freshnessStateLabel(input)
  const age = freshnessAgeLabel(input)
  return age === undefined ? state : `${state} · ${age}`
}

export function attentionItems(input: {
  olderRecordsDropped: boolean
  localValuesTrimmed: boolean
  transportQuarantined: boolean
  inProgressCount: number
  analyticsSessions: number
}): AttentionItem[] {
  const items: AttentionItem[] = []
  if (input.olderRecordsDropped) {
    items.push({
      id: 'dropped',
      text: 'Older records dropped',
      next: 'Pause capture or export before the live window fills.',
    })
  }
  if (input.localValuesTrimmed) {
    items.push({
      id: 'trimmed',
      text: 'Live values trimmed',
      next: 'Inspect a row soon after it writes, or raise the live-value cap.',
    })
  }
  if (input.transportQuarantined) {
    items.push({
      id: 'transport',
      text: 'Transport quarantined',
      next: 'Fix the exporter, then resume capture.',
    })
  }
  if (input.inProgressCount > 0) {
    items.push({
      id: 'in-progress',
      text: `${input.inProgressCount} synthetic in-progress ${input.inProgressCount === 1 ? 'bar' : 'bars'}`,
      next: 'Wait for the span to end, or inspect the open row.',
    })
  }
  if (
    input.analyticsSessions > 0 &&
    input.analyticsSessions < ANALYTICS_MIN_SHARE_SESSIONS
  ) {
    items.push({
      id: 'shares',
      text: `Shares hidden below ${ANALYTICS_MIN_SHARE_SESSIONS} sessions`,
      next: 'Collect more sessions before reading percents.',
    })
  }
  return items
}
