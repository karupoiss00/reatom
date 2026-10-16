import clickhouseExport from '../../otlp/fixtures/clickhouse-export.json'

export function clickhouseMockFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const sql = String(init?.body ?? '')
  const payload = sql.includes('FROM otel_traces')
    ? clickhouseExport.spans
    : sql.includes('FROM otel_logs')
      ? clickhouseExport.logs
      : null
  if (payload === null) {
    return Promise.resolve(new Response('unknown query', { status: 400 }))
  }
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

export function clickhouseDeniedFetch(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ error: 'denied' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}
