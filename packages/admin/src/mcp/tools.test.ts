import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { wrap } from '@reatom/core'
import { expect, test, vi } from 'test'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from '../otlp/chrome.ts'
import { jsonUtf8Bytes } from './cap.ts'
import { ADMIN_MCP_MAX_BYTES, reatomOtlpMcp } from './index.ts'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../otlp/fixtures',
)

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
  'telemetry.sdk.name': '@reatom/opentelemetry',
  'telemetry.sdk.language': 'webjs',
  'telemetry.sdk.version': '1000.15.2',
}

const atomUpdate = readFixture('atom-update.json') as {
  span: unknown
  log: unknown
}

const exceptionJoin = readFixture('exception-join.json') as {
  span: {
    traceId: string
    spanId: string
    name: string
    attributes: Array<{ key: string; value: unknown }>
  }
  log: unknown
}

const explodingSpan = {
  ...exceptionJoin.span,
  attributes: [
    ...exceptionJoin.span.attributes,
    { key: 'app.scenario', value: { stringValue: 'exception-join' } },
  ],
}

function createMcp() {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })
  return { admin, mcp: reatomOtlpMcp(admin) }
}

function ingest(
  admin: ReturnType<typeof reatomOtlpAdmin>,
  records: readonly unknown[],
) {
  ADMIN_FRAME.run(() => admin.ingest(records))
}

test('summary counts traces, names, errors, and the time range', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [explodingSpan, exceptionJoin.log, atomUpdate.span, atomUpdate.log])

  const result = mcp.summary()
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.header.recordCount).toBe(4)
  expect(result.header.traceCount).toBe(2)
  expect(result.header.errorCount).toBeGreaterThan(0)
  expect(result.header.end).toBeGreaterThanOrEqual(result.header.start)
  expect(result.header.truncated).toBe(false)
  expect(result.data.sources).toEqual([{ sourceId: 'local', recordCount: 4 }])
  expect(result.data.names.some((entry) => entry.name === 'explode')).toBe(true)
  expect(result.data.errorCount).toBe(result.header.errorCount)
  expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
})

test('typed filter uses store indexes and hasError / query / kind', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [explodingSpan, exceptionJoin.log, atomUpdate.span, atomUpdate.log])

  const errors = mcp.search({ filter: { hasError: true } })
  expect(errors.ok).toBe(true)
  if (!errors.ok) return
  expect(errors.data.length).toBeGreaterThan(0)
  expect(errors.data.every((row) => row.hasError)).toBe(true)
  expect(errors.data.some((row) => row.name === 'explode')).toBe(true)

  const byName = mcp.search({ filter: { name: 'explode' } })
  expect(byName.ok).toBe(true)
  if (!byName.ok) return
  expect(byName.data).toHaveLength(1)
  expect(byName.data[0]!.traceId).toBe(exceptionJoin.span.traceId)

  const byTrace = mcp.search({
    filter: { traceId: exceptionJoin.span.traceId },
  })
  expect(byTrace.ok).toBe(true)
  if (!byTrace.ok) return
  expect(byTrace.data).toHaveLength(2)

  const spans = mcp.search({ filter: { kind: 'span', reatomKind: 'action' } })
  expect(spans.ok).toBe(true)
  if (!spans.ok) return
  expect(spans.data.every((row) => row.kind === 'span')).toBe(true)
  expect(spans.data.every((row) => row.reatomKind === 'action')).toBe(true)

  const boom = mcp.search({ filter: { query: 'boom' } })
  expect(boom.ok).toBe(true)
  if (!boom.ok) return
  expect(boom.data.some((row) => row.name === 'explode')).toBe(true)
})

test('highlight mode flags matching search rows and listTraces', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [
    explodingSpan,
    exceptionJoin.log,
    atomUpdate.span,
    atomUpdate.log,
  ])

  const searched = mcp.search({
    filter: { calculator: 'name:explode', mode: 'highlight' },
  })
  expect(searched.ok).toBe(true)
  if (!searched.ok) return
  expect(searched.data.length).toBe(4)
  const flaggedRows = searched.data.filter((row) => row.highlighted)
  expect(flaggedRows).toHaveLength(1)
  expect(flaggedRows[0]!.name).toBe('explode')
  expect(flaggedRows[0]!.highlighted).toBe(true)

  const listed = mcp.listTraces({
    filter: { calculator: 'name:explode', mode: 'highlight' },
  })
  expect(listed.ok).toBe(true)
  if (!listed.ok) return
  expect(listed.data.length).toBe(2)
  const flaggedTraces = listed.data.filter((row) => row.highlighted)
  expect(flaggedTraces).toHaveLength(1)
  expect(flaggedTraces[0]!.traceId).toBe(exceptionJoin.span.traceId)
  expect(flaggedTraces[0]!.rootName).toBe('explode')
})

test('listTraces pages matching traces and keeps domain attributes on search', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [explodingSpan, exceptionJoin.log, atomUpdate.span, atomUpdate.log])

  const listed = mcp.listTraces({
    filter: { hasError: true },
    page: 1,
    pageSize: 10,
  })
  expect(listed.ok).toBe(true)
  if (!listed.ok) return
  expect(listed.data).toHaveLength(1)
  expect(listed.data[0]!.traceId).toBe(exceptionJoin.span.traceId)
  expect(listed.data[0]!.rootName).toBe('explode')
  expect(listed.data[0]!.errorCount).toBeGreaterThan(0)

  const found = mcp.search({ filter: { name: 'explode' } })
  expect(found.ok).toBe(true)
  if (!found.ok) return
  const attrs = found.data[0]!.attributes
  expect(attrs['reatom.name']).toBe('explode')
  expect(attrs['reatom.kind']).toBe('action')
  expect(attrs['reatom.outcome']).toBe('error')
  expect(attrs['app.scenario']).toBe('exception-join')
})

test('missing trace, record, and state path return a structured miss', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [atomUpdate.log])

  const missingTrace = mcp.getTrace({ traceId: 'missing-trace' })
  expect(missingTrace.ok).toBe(false)
  if (missingTrace.ok) return
  expect(missingTrace.missing).toBe('trace')
  expect(missingTrace.id).toBe('missing-trace')
  expect(missingTrace.header.recordCount).toBe(1)

  const emptyTrace = mcp.getTrace({})
  expect(emptyTrace.ok).toBe(false)
  if (emptyTrace.ok) return
  expect(emptyTrace.missing).toBe('trace')

  const missingRecord = mcp.getRecord({ id: 'no-such-record' })
  expect(missingRecord.ok).toBe(false)
  if (missingRecord.ok) return
  expect(missingRecord.missing).toBe('record')
  expect(missingRecord.id).toBe('no-such-record')

  const emptyRecord = mcp.getRecord({})
  expect(emptyRecord.ok).toBe(false)
  if (emptyRecord.ok) return
  expect(emptyRecord.missing).toBe('record')

  const missingState = mcp.getState({ path: 'no.such.atom' })
  expect(missingState.ok).toBe(false)
  if (missingState.ok) return
  expect(missingState.missing).toBe('state')
  expect(missingState.path).toBe('no.such.atom')
})

test('getRecord resolves cause ids to names and keeps reatom.* / app.*', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [explodingSpan, exceptionJoin.log, atomUpdate.span, atomUpdate.log])

  const checked = mcp.search({ filter: { query: 'tree.checked' } })
  expect(checked.ok).toBe(true)
  if (!checked.ok) return
  const logRow = checked.data.find((row) => row.atomName === 'tree.checked')
  expect(logRow).toBeDefined()

  const record = mcp.getRecord({ id: logRow!.id })
  expect(record.ok).toBe(true)
  if (!record.ok) return
  expect(record.data.causes).toEqual([{ id: '1', name: 'tree#12.toggle' }])
  expect(record.data.record.attributes['reatom.name']).toBe('tree.checked')
  expect(record.data.record.attributes['reatom.kind']).toBe('atom')
  expect(record.data.record.attributes['reatom.cause.ids']).toEqual(['1'])

  const explode = mcp.search({ filter: { name: 'explode' } })
  expect(explode.ok).toBe(true)
  if (!explode.ok) return
  const full = mcp.getRecord({ id: explode.data[0]!.id })
  expect(full.ok).toBe(true)
  if (!full.ok) return
  expect(full.data.record.attributes['reatom.outcome']).toBe('error')
  expect(full.data.record.attributes['app.scenario']).toBe('exception-join')
  expect(full.data.record.error).toEqual({
    type: 'TypeError',
    message: 'boom',
    stack: 'TypeError: boom\n    at explode',
  })
})

test('getTrace returns the error span with domain attributes and events', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [explodingSpan, exceptionJoin.log])

  const trace = mcp.getTrace({ traceId: exceptionJoin.span.traceId })
  expect(trace.ok).toBe(true)
  if (!trace.ok) return
  expect(trace.data.traceId).toBe(exceptionJoin.span.traceId)
  expect(trace.data.rootName).toBe('explode')
  expect(trace.data.nodes).toHaveLength(1)
  const root = trace.data.nodes[0]!
  expect(root.hasError).toBe(true)
  expect(root.attributes['reatom.name']).toBe('explode')
  expect(root.attributes['app.scenario']).toBe('exception-join')
  expect(root.events.some((event) => event.eventName === 'exception')).toBe(
    true,
  )
})

test('getState returns the last-write subtree for a path', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [atomUpdate.span, atomUpdate.log])

  const tree = mcp.getState({ path: 'tree.checked' })
  expect(tree.ok).toBe(true)
  if (!tree.ok) return
  expect(tree.data.path).toBe('tree.checked')
  expect(tree.data.nodes.length).toBeGreaterThan(0)
  const labels = JSON.stringify(tree.data.nodes)
  expect(labels).toContain('checked')
})

test('a large synthetic batch truncates with nextCursor and the next page continues', () => {
  const { admin, mcp } = createMcp()
  const batch = Array.from({ length: 120 }, (_, index) => ({
    traceId: `t${index.toString().padStart(31, '0')}`,
    spanId: `s${index.toString().padStart(15, '0')}`,
    name: `synth.action.${index}`,
    startTimeUnixNano: String(1761000000000000000n + BigInt(index) * 1_000_000n),
    endTimeUnixNano: String(1761000000001000000n + BigInt(index) * 1_000_000n),
    attributes: {
      'reatom.name': `synth.action.${index}`,
      'reatom.kind': 'action',
      'reatom.outcome': 'ok',
      'reatom.frame.id': String(index + 1),
      'reatom.params': JSON.stringify({ index, pad: 'x'.repeat(40) }),
      'app.scenario': 'cap',
      'app.index': String(index),
    },
  }))
  ingest(admin, batch)

  const first = mcp.search({})
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.header.truncated).toBe(true)
  expect(first.nextCursor).toEqual(expect.any(String))
  expect(first.data.length).toBeGreaterThan(0)
  expect(first.data.length).toBeLessThan(120)
  expect(jsonUtf8Bytes(first)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  for (const row of first.data) {
    expect(row.attributes['reatom.name']).toEqual(expect.any(String))
    expect(row.attributes['reatom.kind']).toBe('action')
    expect(row.attributes['app.scenario']).toBe('cap')
    expect(row.attributes['app.index']).toEqual(expect.any(String))
  }

  const second = mcp.search({ cursor: first.nextCursor })
  expect(second.ok).toBe(true)
  if (!second.ok) return
  expect(second.data.length).toBeGreaterThan(0)
  const firstIds = new Set(first.data.map((row) => row.id))
  expect(second.data.every((row) => !firstIds.has(row.id))).toBe(true)
  expect(second.data[0]!.attributes['reatom.name']).toEqual(expect.any(String))
  expect(second.data[0]!.attributes['app.scenario']).toBe('cap')
  expect(jsonUtf8Bytes(second)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)

  const listed = mcp.listTraces({ page: 1, pageSize: 8 })
  expect(listed.ok).toBe(true)
  if (!listed.ok) return
  expect(listed.data.length).toBeLessThanOrEqual(8)
  expect(listed.nextCursor).toBeDefined()
  const listedNext = mcp.listTraces({ cursor: listed.nextCursor, pageSize: 8 })
  expect(listedNext.ok).toBe(true)
  if (!listedNext.ok) return
  const listedIds = new Set(listed.data.map((row) => row.traceId))
  expect(listedNext.data.every((row) => !listedIds.has(row.traceId))).toBe(true)
})

function attributeKeys(attributes: Record<string, unknown>): string[] {
  if (attributes.truncated === true && Array.isArray(attributes.keys)) {
    return attributes.keys as string[]
  }
  return Object.keys(attributes)
}

function ingestManyAppKeys(count: number) {
  const { admin, mcp } = createMcp()
  const attributes: Record<string, string> = {
    'reatom.name': 'many.keys',
    'reatom.kind': 'action',
    'reatom.outcome': 'ok',
    'reatom.frame.id': '1',
  }
  for (let index = 0; index < count; index += 1) {
    attributes[`app.k${index}`] = `v${index}`
  }
  const traceId = 'd'.repeat(32)
  const spanId = 'e'.repeat(16)
  ingest(admin, [
    {
      traceId,
      spanId,
      name: 'many.keys',
      startTimeUnixNano: '1761000000000000000',
      endTimeUnixNano: '1761000000001000000',
      attributes,
    },
  ])
  const stored = ADMIN_FRAME.run(() => admin.records()[0]!)
  return { admin, mcp, stored, traceId, spanId, count }
}

test('getRecord caps a 60 KB reatom.payload and keeps id and domain keys', () => {
  const { admin, mcp } = createMcp()
  const payload = 'P'.repeat(60 * 1024)
  ingest(admin, [
    {
      traceId: 'b'.repeat(32),
      spanId: 'c'.repeat(16),
      name: 'fat.payload',
      startTimeUnixNano: '1761000000000000000',
      endTimeUnixNano: '1761000000001000000',
      attributes: {
        'reatom.name': 'fat.payload',
        'reatom.kind': 'action',
        'reatom.outcome': 'ok',
        'reatom.payload': payload,
        'reatom.frame.id': '1',
        'app.scenario': 'cap-payload',
      },
    },
  ])

  const stored = ADMIN_FRAME.run(() => admin.records()[0]!)
  const result = mcp.getRecord({ id: stored.id })
  expect(jsonUtf8Bytes(result)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.data.record.id).toBe(stored.id)
  expect(result.data.record.id).not.toMatch(/…/)
  expect(result.data.record.traceId).toBe(stored.traceId)
  expect(result.header.valuesTruncated).toBe(true)
  expect(result.header.truncated).toBe(false)
  const keys = attributeKeys(result.data.record.attributes)
  expect(keys).toContain('reatom.payload')
  expect(keys).toContain('reatom.name')
  expect(keys).toContain('app.scenario')
  expect(result.data.record.attributes['reatom.name']).toBe('fat.payload')
  expect(result.data.record.attributes['app.scenario']).toBe('cap-payload')
})

test('getState pages a large tree as flat rows under the byte cap', () => {
  const { admin, mcp } = createMcp()
  const logs = Array.from({ length: 400 }, (_, index) => ({
    eventName: 'reatom.atom.update',
    traceId: 'a'.repeat(32),
    spanId: index.toString(16).padStart(16, '0'),
    timeUnixNano: String(1761000000000000000n + BigInt(index)),
    body: { n: index, pad: 'y'.repeat(80) },
    attributes: {
      'event.name': 'reatom.atom.update',
      'reatom.name': `group.atom${index}`,
      'reatom.kind': 'atom',
      'reatom.frame.id': String(index + 1),
      'reatom.cause.ids': [],
    },
  }))
  ingest(admin, logs)

  const first = mcp.getState({})
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(jsonUtf8Bytes(first)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(first.data.nodes.length).toBeGreaterThan(1)
  expect(first.header.truncated).toBe(true)
  expect(first.nextCursor).toEqual(expect.any(String))
  for (const node of first.data.nodes) {
    expect(node).not.toHaveProperty('children')
    expect(node.childCount).toEqual(expect.any(Number))
    expect(node.path).toEqual(expect.any(String))
  }
  const pageJson = JSON.stringify(first.data.nodes)
  expect(pageJson).not.toContain('"children"')
  const pagePaths = first.data.nodes.map((node) => node.path)
  expect(new Set(pagePaths).size).toBe(pagePaths.length)

  const allPaths = [...pagePaths]
  let cursor = first.nextCursor
  let pages = 1
  while (cursor) {
    const page = mcp.getState({ cursor })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(jsonUtf8Bytes(page)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
    for (const node of page.data.nodes) {
      expect(node).not.toHaveProperty('children')
      allPaths.push(node.path)
    }
    cursor = page.nextCursor
    pages += 1
    expect(pages).toBeLessThan(80)
  }
  expect(pages).toBeGreaterThan(1)
  expect(allPaths.length).toBe(401)
  expect(new Set(allPaths).size).toBe(401)
})

test('many app.* keys stay present under the byte cap with ids intact', () => {
  const { mcp, stored, traceId, spanId, count } = ingestManyAppKeys(1500)
  expect(stored.id.startsWith('local:')).toBe(true)

  const assertIdentity = (id: string, foundTraceId: string, foundSpanId: string) => {
    expect(id).toBe(stored.id)
    expect(id).not.toMatch(/…/)
    expect(foundTraceId).toBe(traceId)
    expect(foundSpanId).toBe(spanId)
  }

  const assertDomainKeys = (attrs: Record<string, unknown>) => {
    const keys = attributeKeys(attrs)
    expect(keys).toContain('reatom.name')
    expect(keys).toContain('reatom.kind')
    for (let index = 0; index < count; index += 1) {
      expect(keys).toContain(`app.k${index}`)
    }
  }

  const searched = mcp.search({ filter: { name: 'many.keys' } })
  expect(jsonUtf8Bytes(searched)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(searched.ok).toBe(true)
  if (!searched.ok) return
  expect(searched.data).toHaveLength(1)
  assertIdentity(
    searched.data[0]!.id,
    searched.data[0]!.traceId,
    searched.data[0]!.spanId,
  )
  expect(searched.data[0]!.name).toBe('many.keys')
  assertDomainKeys(searched.data[0]!.attributes)
  expect(searched.header.valuesTruncated).toBe(true)

  const record = mcp.getRecord({ id: stored.id })
  expect(jsonUtf8Bytes(record)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(record.ok).toBe(true)
  if (!record.ok) return
  assertIdentity(
    record.data.record.id,
    record.data.record.traceId,
    record.data.record.spanId,
  )
  expect(record.data.record.name).toBe('many.keys')
  assertDomainKeys(record.data.record.attributes)
  expect(record.header.valuesTruncated).toBe(true)
  expect(record.header.truncated).toBe(false)

  const trace = mcp.getTrace({ traceId })
  expect(jsonUtf8Bytes(trace)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(trace.ok).toBe(true)
  if (!trace.ok) return
  expect(trace.data.traceId).toBe(traceId)
  expect(trace.data.rootName).toBe('many.keys')
  expect(trace.data.nodes[0]!.id).toBe(stored.id)
  expect(trace.data.nodes[0]!.id).not.toMatch(/…/)
  expect(trace.data.nodes[0]!.spanId).toBe(spanId)
  expect(trace.data.nodes[0]!.name).toBe('many.keys')
  assertDomainKeys(trace.data.nodes[0]!.attributes)
  expect(trace.header.valuesTruncated).toBe(true)
})

test('too many app.* keys return a too-large miss with ids intact', () => {
  const { mcp, stored, traceId } = ingestManyAppKeys(3000)

  const searched = mcp.search({ filter: { name: 'many.keys' } })
  expect(jsonUtf8Bytes(searched)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(searched.ok).toBe(false)
  if (searched.ok) return
  expect(searched.missing).toBe('too-large')
  expect(searched.id).toBe(stored.id)

  const record = mcp.getRecord({ id: stored.id })
  expect(jsonUtf8Bytes(record)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(record.ok).toBe(false)
  if (record.ok) return
  expect(record.missing).toBe('too-large')
  expect(record.id).toBe(stored.id)

  const trace = mcp.getTrace({ traceId })
  expect(jsonUtf8Bytes(trace)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(trace.ok).toBe(false)
  if (trace.ok) return
  expect(trace.missing).toBe('too-large')
  expect(trace.id).toBe(traceId)
})

test('getState keeps path and atomName for a large number-array atom', () => {
  const { admin, mcp } = createMcp()
  const atomPath = 'someFeature.collection.largeNumericSeriesValues'
  ingest(admin, [
    {
      eventName: 'reatom.atom.update',
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      timeUnixNano: '1761000000000000000',
      body: Array.from({ length: 5000 }, (_, index) => index),
      attributes: {
        'event.name': 'reatom.atom.update',
        'reatom.name': atomPath,
        'reatom.kind': 'atom',
        'reatom.frame.id': '1',
        'reatom.cause.ids': [],
      },
    },
  ])

  const first = mcp.getState({ path: atomPath })
  expect(jsonUtf8Bytes(first)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  if (!first.ok) {
    expect(first.missing).toBe('too-large')
    expect(first.path).toBe(atomPath)
    return
  }
  expect(first.data.path).toBe(atomPath)
  const row = first.data.nodes.find((node) => node.kind === 'atom')
  expect(row).toBeDefined()
  expect(row!.path).toBe(atomPath)
  expect(row!.atomName).toBe(atomPath)
  expect(row!.path).not.toMatch(/…/)
  expect(row!.atomName).not.toMatch(/…/)
  expect(first.header.valuesTruncated).toBe(true)

  const again = mcp.getState({ path: row!.path })
  expect(jsonUtf8Bytes(again)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(again.ok).toBe(true)
  if (!again.ok) return
  expect(again.data.path).toBe(atomPath)
  expect(again.data.nodes.some((node) => node.atomName === atomPath)).toBe(true)
})

const clickhouseExport = JSON.parse(
  readFileSync(join(fixturesDir, 'clickhouse-export.json'), 'utf8'),
) as {
  spans: { data: unknown[] }
  logs: { data: unknown[] }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockClickHouseFetch(status = 200) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (status !== 200) return jsonResponse({ error: 'denied' }, status)
    const sql = String(init?.body ?? '')
    if (sql.includes('FROM otel_traces')) {
      return jsonResponse(clickhouseExport.spans)
    }
    if (sql.includes('FROM otel_logs')) {
      return jsonResponse(clickhouseExport.logs)
    }
    return jsonResponse({ error: 'unknown query' }, 400)
  })
}

test('connectRemote MCP tool ingests ClickHouse JSON', async () => {
  const fetchMock = mockClickHouseFetch()
  const admin = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    fetch: fetchMock,
  })
  const mcp = reatomOtlpMcp(admin)

  await ADMIN_FRAME.run(async () => {
    const result = await wrap(mcp.connectRemote({ password: 'e2e-secret' }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.recordCount).toBe(7)
    expect(admin.source()).toBe('remote')
    expect(admin.records()).toHaveLength(7)
    expect(admin.records().some((record) => record.name === 'explode')).toBe(
      true,
    )
  })
})

test('connectRemote MCP tool 401 is a remote miss and does not ingest', async () => {
  const fetchMock = mockClickHouseFetch(401)
  const admin = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    fetch: fetchMock,
  })
  const mcp = reatomOtlpMcp(admin)

  await ADMIN_FRAME.run(async () => {
    const result = await wrap(mcp.connectRemote({ password: 'wrong' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toBe('remote')
    expect(result.id).toMatch(/^ClickHouse 401/)
    expect(admin.records()).toEqual([])
    expect(admin.source()).toBe('live')
  })
})

test('MCP output does not include live local values', () => {
  const { admin, mcp } = createMcp()
  const secret = 'live-secret-token-9f3a'
  const raw = {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: 'bbbbbbbbbbbbbbbb',
    eventName: 'reatom.atom.update',
    timeUnixNano: '1791352144731000000',
    body: '***',
    attributes: {
      'event.name': 'reatom.atom.update',
      'reatom.name': 'cart.secret',
      'reatom.kind': 'atom',
      'reatom.frame.id': '9',
      'reatom.params': '["***"]',
      'reatom.payload': '"***"',
    },
  }
  ADMIN_FRAME.run(() => {
    admin.setLocalValues((item) =>
      item === raw
        ? {
            params: [secret],
            payload: { secret },
            state: { secret },
          }
        : undefined,
    )
    admin.ingest([raw])
  })
  const stored = ADMIN_FRAME.run(() => admin.records()[0]!)
  expect(stored).toBeDefined()
  const exported = JSON.stringify(ADMIN_FRAME.run(() => admin.records()))
  expect(exported).toContain('***')
  expect(exported).not.toContain(secret)
  expect(JSON.stringify(mcp.getRecord({ id: stored.id }))).not.toContain(secret)
  expect(JSON.stringify(mcp.search())).not.toContain(secret)
  expect(JSON.stringify(mcp.getState())).not.toContain(secret)
})

