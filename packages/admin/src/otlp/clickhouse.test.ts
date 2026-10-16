import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { wrap } from '@reatom/core'
import { expect, test, vi } from 'test'

import { ADMIN_FRAME } from '../root'
import { recordHasError } from './bind.ts'
import { reatomOtlpAdmin } from './chrome.ts'
import {
  CLICKHOUSE_LOG_SQL,
  CLICKHOUSE_LOG_SQL_NO_EVENT,
  CLICKHOUSE_SPAN_SQL,
  clickhouseExportToOtlp,
  fetchClickHouseExport,
} from './clickhouse.ts'
import { reatomOtlpStore } from './ingest.ts'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const clickhouseExport = JSON.parse(
  readFileSync(join(fixturesDir, 'clickhouse-export.json'), 'utf8'),
) as {
  spans: { data: unknown[] }
  logs: { data: unknown[] }
}

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockClickHouseFetch(exportJson = clickhouseExport, status = 200) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (status !== 200) return jsonResponse({ error: 'denied' }, status)
    const sql = String(init?.body ?? '')
    if (sql.includes('FROM otel_traces')) return jsonResponse(exportJson.spans)
    if (sql.includes('FROM otel_logs')) return jsonResponse(exportJson.logs)
    return jsonResponse({ error: 'unknown query' }, 400)
  })
}

test('ClickHouse exporter rows convert to ingestible OTLP with cause ids', () => {
  const records = clickhouseExportToOtlp(
    clickhouseExport.spans,
    clickhouseExport.logs,
  ) as Array<{
    name?: string
    eventName?: string
    attributes: Record<string, unknown>
    resource?: Record<string, unknown>
    status?: { code?: number; message?: string }
    startTimeUnixNano?: string
    timeUnixNano?: string
  }>
  expect(records).toHaveLength(7)
  expect(records.some((record) => record.name === 'tree#.toggle')).toBe(true)
  const checked = records.find(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(checked?.attributes['reatom.name']).toBe('tree.checked')
  expect(checked?.attributes['reatom.cause.ids']).toEqual(['1'])
  const diamond = records.find((record) => record.name === 'cart.total')
  expect(diamond?.attributes['reatom.cause.ids']).toEqual(['3', '5'])
  const explode = records.find((record) => record.name === 'explode')
  expect(explode?.status).toEqual({ code: 2, message: 'boom' })
  expect(explode?.resource).toEqual({ 'service.name': 'reatom-admin-story' })
  const nanos = records.map((record) =>
    BigInt(record.startTimeUnixNano ?? record.timeUnixNano ?? '0'),
  )
  expect(nanos).toEqual(
    [...nanos].sort((left, right) => (left < right ? -1 : 1)),
  )
  expect(records[0]?.name).toBe('explode')
})

test('connectRemote pulls ClickHouse JSON into Activity records', async () => {
  const fetchMock = mockClickHouseFetch()
  const admin = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    fetch: fetchMock,
  })

  await ADMIN_FRAME.run(async () => {
    admin.remoteForm.fields.password.change('e2e-secret')
    const result = await wrap(admin.connectRemote())
    expect(result).toEqual({ recordCount: 7 })
    expect(admin.source()).toBe('remote')
    expect(admin.records()).toHaveLength(7)
    expect(
      admin.records().some((record) => record.atomName === 'tree.checked'),
    ).toBe(true)
    expect(admin.records().some((record) => record.name === 'explode')).toBe(
      true,
    )
    const checked = admin
      .records()
      .find((record) => record.atomName === 'tree.checked')
    expect(checked?.causeIds).toEqual(['1'])
    admin.selectRecord(checked!)
    expect(admin.selectedTraceId()).toBe(checked!.traceId)
    expect(admin.railNodes().map((node) => node.label)).toEqual([
      'tree#12.toggle',
      'tree.checked',
    ])
    expect(admin.records().map((record) => record.start)).toEqual(
      [...admin.records()].map((record) => record.start).sort((a, b) => a - b),
    )
  })

  expect(fetchMock).toHaveBeenCalled()
  const spanCall = fetchMock.mock.calls.find((call) =>
    String(call[1]?.body ?? '').includes('FROM otel_traces'),
  )
  expect(spanCall).toBeDefined()
  const headers = new Headers(spanCall![1]?.headers)
  expect(headers.get('X-ClickHouse-User')).toBe('default')
  expect(headers.get('X-ClickHouse-Key')).toBe('e2e-secret')
  expect(headers.get('X-ClickHouse-Format')).toBe('JSON')
  expect(String(spanCall![1]?.body)).toContain(CLICKHOUSE_SPAN_SQL.slice(0, 40))
  expect(
    fetchMock.mock.calls.some((call) =>
      String(call[1]?.body ?? '').includes('FROM otel_logs'),
    ),
  ).toBe(true)
  expect(CLICKHOUSE_LOG_SQL).toContain('otel_logs')
})

test('ClickHouse 401 is permission denied and does not ingest', async () => {
  const fetchMock = mockClickHouseFetch(clickhouseExport, 401)
  const admin = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    fetch: fetchMock,
  })

  await ADMIN_FRAME.run(async () => {
    await wrap(admin.connectRemote().catch(() => undefined))
    expect(admin.connectRemote.error()?.message).toMatch(/^ClickHouse 401/)
    expect(admin.records()).toEqual([])
    expect(admin.source()).toBe('live')
  })
})

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

test('credentials stay in memory; clear and a new instance forget them', async () => {
  const fetchMock = mockClickHouseFetch()
  const password = 'e2e-session-only'
  const local = memoryStorage()
  const session = memoryStorage()
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('sessionStorage', session)
  try {
    const admin = reatomOtlpAdmin({
      sourceId: 'clickhouse',
      resource: INSTANCE_RESOURCE,
      fetch: fetchMock,
    })

    await ADMIN_FRAME.run(async () => {
      admin.remoteForm.fields.password.change(password)
      await wrap(admin.connectRemote())
      expect(admin.records()).toHaveLength(7)
      expect(admin.remoteForm.fields.password.value()).toBe(password)
      expect([...local.map.values()].join('\n')).not.toContain(password)
      expect([...session.map.values()].join('\n')).not.toContain(password)
      expect(local.map.size).toBe(0)
      expect(session.map.size).toBe(0)

      admin.clear()
      expect(admin.records()).toEqual([])
      expect(admin.source()).toBe('live')
      expect(admin.remoteForm.fields.password.value()).toBe('')
      expect(admin.remoteForm.fields.url.value()).toBe('http://127.0.0.1:8123')
    })

    const reloaded = reatomOtlpAdmin({
      sourceId: 'clickhouse',
      resource: INSTANCE_RESOURCE,
      fetch: fetchMock,
    })
    ADMIN_FRAME.run(() => {
      expect(reloaded.records()).toEqual([])
      expect(reloaded.source()).toBe('live')
      expect(reloaded.remoteForm.fields.password.value()).toBe('')
    })
  } finally {
    vi.unstubAllGlobals()
  }
})

const CREDENTIALS = {
  url: 'http://127.0.0.1:8123',
  database: 'otel',
  user: 'default',
  password: 'secret',
}

test('StatusCode 2 without reatom.outcome is an error; services stay distinct', () => {
  const explodeRow = structuredClone(
    (clickhouseExport.spans.data as Array<Record<string, unknown>>).find(
      (row) => row.SpanName === 'explode',
    ),
  ) as Record<string, unknown>
  const attributes = explodeRow.SpanAttributes as Record<string, unknown>
  delete attributes['reatom.outcome']
  const pingRow = structuredClone(
    (clickhouseExport.spans.data as Array<Record<string, unknown>>)[0]!,
  )
  pingRow.ServiceName = 'svc-a'
  pingRow.ResourceAttributes = { 'service.name': 'svc-a' }
  const toggleRow = structuredClone(
    (clickhouseExport.spans.data as Array<Record<string, unknown>>)[1]!,
  )
  toggleRow.ServiceName = 'svc-b'
  toggleRow.ResourceAttributes = { 'service.name': 'svc-b' }

  const [statusOnly] = clickhouseExportToOtlp(
    { data: [explodeRow] },
    { data: [] },
  ) as Array<{
    status?: { code?: number }
    attributes: Record<string, unknown>
  }>
  expect(statusOnly?.status?.code).toBe(2)
  expect(statusOnly?.attributes['reatom.outcome']).toBeUndefined()

  const converted = clickhouseExportToOtlp(
    { data: [pingRow, toggleRow, explodeRow] },
    { data: [] },
  )
  const store = ADMIN_FRAME.run(() =>
    reatomOtlpStore({
      sourceId: 'clickhouse',
      resource: INSTANCE_RESOURCE,
    }),
  )
  ADMIN_FRAME.run(() => store.ingest(converted))
  const records = ADMIN_FRAME.run(() => store.records())
  const errorOnly = records.find((record) => record.name === 'explode')
  expect(errorOnly?.outcome).toBe('error')
  expect(recordHasError(errorOnly!)).toBe(true)
  expect(
    records.find((record) => record.name === 'devtools.ping')?.sourceId,
  ).toBe('clickhouse:svc-a')
  expect(
    records.find((record) => record.name === 'tree#.toggle')?.sourceId,
  ).toBe('clickhouse:svc-b')
})

test('logs EventName fallback retries only on a missing column', async () => {
  const missingColumn = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sql = String(init?.body ?? '')
      if (sql.includes('FROM otel_traces'))
        return jsonResponse(clickhouseExport.spans)
      if (sql.includes("LogAttributes['event.name']")) {
        return jsonResponse(clickhouseExport.logs)
      }
      if (sql.includes('FROM otel_logs')) {
        return new Response('Code: 47. Unknown identifier EventName', {
          status: 404,
        })
      }
      return jsonResponse({ error: 'unknown query' }, 400)
    },
  )

  const records = await fetchClickHouseExport(CREDENTIALS, {
    fetch: missingColumn,
    signal: new AbortController().signal,
  })
  expect(records).toHaveLength(7)
  expect(
    missingColumn.mock.calls.some((call) =>
      String(call[1]?.body ?? '').includes("LogAttributes['event.name']"),
    ),
  ).toBe(true)
  expect(CLICKHOUSE_LOG_SQL_NO_EVENT).toContain("LogAttributes['event.name']")

  const deniedLogs = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sql = String(init?.body ?? '')
      if (sql.includes('FROM otel_traces'))
        return jsonResponse(clickhouseExport.spans)
      if (sql.includes('FROM otel_logs'))
        return jsonResponse({ error: 'denied' }, 401)
      return jsonResponse({ error: 'unknown query' }, 400)
    },
  )
  await expect(
    fetchClickHouseExport(CREDENTIALS, {
      fetch: deniedLogs,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/ClickHouse 401/)
  expect(
    deniedLogs.mock.calls.some((call) =>
      String(call[1]?.body ?? '').includes("LogAttributes['event.name']"),
    ),
  ).toBe(false)

  const abortedLogs = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sql = String(init?.body ?? '')
      if (sql.includes('FROM otel_traces'))
        return jsonResponse(clickhouseExport.spans)
      const error = new Error('Aborted')
      error.name = 'AbortError'
      throw error
    },
  )
  await expect(
    fetchClickHouseExport(CREDENTIALS, {
      fetch: abortedLogs,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(abortedLogs).toHaveBeenCalledTimes(2)
})

test('remote clear does not wipe the host app via onClear', async () => {
  const onClear = vi.fn()
  const fetchMock = mockClickHouseFetch()
  const admin = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    fetch: fetchMock,
    onClear,
  })

  await ADMIN_FRAME.run(async () => {
    await wrap(admin.connectRemote())
    expect(admin.records()).toHaveLength(7)
    admin.clear()
    expect(admin.records()).toEqual([])
    expect(admin.source()).toBe('live')
    expect(onClear).not.toHaveBeenCalled()
  })

  const live = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    onClear,
  })
  ADMIN_FRAME.run(() => {
    live.clear()
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
