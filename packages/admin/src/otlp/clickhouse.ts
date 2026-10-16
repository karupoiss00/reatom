export interface ClickHouseCredentials {
  url: string
  database: string
  user: string
  password: string
}

export interface ClickHouseJsonResult {
  data?: unknown[]
}

export const CLICKHOUSE_SPAN_SQL = `SELECT
  toUnixTimestamp64Nano(Timestamp) AS startTimeUnixNano,
  TraceId,
  SpanId,
  ParentSpanId,
  SpanName,
  SpanKind,
  Duration,
  StatusCode,
  StatusMessage,
  ServiceName,
  SpanAttributes,
  ResourceAttributes
FROM otel_traces
ORDER BY Timestamp DESC
LIMIT 500`

export const CLICKHOUSE_LOG_SQL = `SELECT
  toUnixTimestamp64Nano(Timestamp) AS timeUnixNano,
  TraceId,
  SpanId,
  SeverityNumber,
  SeverityText,
  Body,
  EventName,
  ServiceName,
  LogAttributes,
  ResourceAttributes
FROM otel_logs
ORDER BY Timestamp DESC
LIMIT 500`

export const CLICKHOUSE_LOG_SQL_NO_EVENT = `SELECT
  toUnixTimestamp64Nano(Timestamp) AS timeUnixNano,
  TraceId,
  SpanId,
  SeverityNumber,
  SeverityText,
  Body,
  LogAttributes['event.name'] AS EventName,
  ServiceName,
  LogAttributes,
  ResourceAttributes
FROM otel_logs
ORDER BY Timestamp DESC
LIMIT 500`

function nanoString(value: unknown): string {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  return '0'
}

function asMap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return { ...(raw as Record<string, unknown>) }
}

function mapToAttributes(raw: unknown): Record<string, unknown> {
  const attributes: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asMap(raw))) {
    if (key === 'reatom.cause.ids' && typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value)
        attributes[key] = Array.isArray(parsed) ? parsed : value
      } catch {
        attributes[key] = value
      }
    } else {
      attributes[key] = value
    }
  }
  return attributes
}

function resourceFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const resource = mapToAttributes(row.ResourceAttributes)
  if (typeof row.ServiceName === 'string' && row.ServiceName !== '') {
    resource['service.name'] = row.ServiceName
  }
  return resource
}

function statusCodeFromRow(row: Record<string, unknown>): number {
  const raw = row.StatusCode
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw !== '') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function clickhouseSpanToOtlp(row: Record<string, unknown>): unknown {
  const start = nanoString(row.startTimeUnixNano)
  const durationRaw = row.Duration
  const duration =
    typeof durationRaw === 'string' || typeof durationRaw === 'number'
      ? BigInt(durationRaw)
      : 0n
  const parentSpanId =
    typeof row.ParentSpanId === 'string' && row.ParentSpanId !== ''
      ? row.ParentSpanId
      : undefined
  return {
    traceId: String(row.TraceId ?? ''),
    spanId: String(row.SpanId ?? ''),
    ...(parentSpanId === undefined ? {} : { parentSpanId }),
    name: String(row.SpanName ?? ''),
    kind: row.SpanKind,
    startTimeUnixNano: start,
    endTimeUnixNano: String(BigInt(start) + duration),
    attributes: mapToAttributes(row.SpanAttributes),
    resource: resourceFromRow(row),
    status: {
      code: statusCodeFromRow(row),
      message: String(row.StatusMessage ?? ''),
    },
  }
}

function clickhouseLogToOtlp(row: Record<string, unknown>): unknown {
  const attributes = mapToAttributes(row.LogAttributes)
  const eventFromAttr = attributes['event.name']
  const eventName =
    typeof row.EventName === 'string' && row.EventName !== ''
      ? row.EventName
      : typeof eventFromAttr === 'string'
        ? eventFromAttr
        : ''
  return {
    eventName,
    traceId: String(row.TraceId ?? ''),
    spanId: String(row.SpanId ?? ''),
    timeUnixNano: nanoString(row.timeUnixNano),
    severityNumber: row.SeverityNumber,
    body: row.Body,
    attributes,
    resource: resourceFromRow(row),
  }
}

function itemUnixNano(item: unknown): bigint {
  if (!item || typeof item !== 'object') return 0n
  const record = item as Record<string, unknown>
  const raw = record.startTimeUnixNano ?? record.timeUnixNano ?? '0'
  try {
    if (typeof raw === 'bigint') return raw
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return BigInt(Math.trunc(raw))
    }
    if (typeof raw === 'string' && raw !== '') return BigInt(raw)
  } catch {
    return 0n
  }
  return 0n
}

export function clickhouseExportToOtlp(
  spans: ClickHouseJsonResult,
  logs: ClickHouseJsonResult,
): unknown[] {
  const records: unknown[] = []
  for (const row of spans.data ?? []) {
    if (!row || typeof row !== 'object') continue
    records.push(clickhouseSpanToOtlp(row as Record<string, unknown>))
  }
  for (const row of logs.data ?? []) {
    if (!row || typeof row !== 'object') continue
    records.push(clickhouseLogToOtlp(row as Record<string, unknown>))
  }
  records.sort((left, right) => {
    const delta = itemUnixNano(left) - itemUnixNano(right)
    return delta < 0n ? -1 : delta > 0n ? 1 : 0
  })
  return records
}

export async function postClickHouseQuery(
  credentials: ClickHouseCredentials,
  sql: string,
  options: { fetch: typeof fetch; signal: AbortSignal },
): Promise<ClickHouseJsonResult> {
  const url = new URL(credentials.url)
  url.searchParams.set('database', credentials.database)
  const response = await options.fetch(url, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': credentials.user,
      'X-ClickHouse-Key': credentials.password,
      'X-ClickHouse-Format': 'JSON',
    },
    body: sql,
    signal: options.signal,
  })
  const text = await response.text()
  if (!response.ok) {
    const snippet = text.trim().slice(0, 300)
    throw new Error(
      snippet === ''
        ? `ClickHouse ${response.status}`
        : `ClickHouse ${response.status}: ${snippet}`,
    )
  }
  return JSON.parse(text) as ClickHouseJsonResult
}

function isMissingEventNameColumn(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (error instanceof Error && error.name === 'AbortError') return false
  const message = error instanceof Error ? error.message : String(error)
  if (/ClickHouse 401\b/.test(message) || /ClickHouse 403\b/.test(message)) {
    return false
  }
  return /UNKNOWN_IDENTIFIER|Unknown identifier|no such column.*EventName|Missing columns?:.*EventName/i.test(
    message,
  )
}

/** Pull recent `otel_traces` / `otel_logs` rows and map them to T-063 ingest items. */
export async function fetchClickHouseExport(
  credentials: ClickHouseCredentials,
  options: { fetch: typeof fetch; signal: AbortSignal },
): Promise<unknown[]> {
  const spans = await postClickHouseQuery(
    credentials,
    CLICKHOUSE_SPAN_SQL,
    options,
  )
  let logs: ClickHouseJsonResult
  try {
    logs = await postClickHouseQuery(credentials, CLICKHOUSE_LOG_SQL, options)
  } catch (error) {
    if (!isMissingEventNameColumn(error)) throw error
    logs = await postClickHouseQuery(
      credentials,
      CLICKHOUSE_LOG_SQL_NO_EVENT,
      options,
    )
  }
  return clickhouseExportToOtlp(spans, logs)
}
