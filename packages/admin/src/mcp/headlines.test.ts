import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from '../otlp/chrome.ts'
import { jsonUtf8Bytes } from './cap.ts'
import { describeMcpFilter } from './filterSentence.ts'
import { ADMIN_MCP_MAX_BYTES, ADMIN_MCP_TOOL_NAMES, reatomOtlpMcp } from './index.ts'

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
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

const exploding = {
  traceId: '5b8efff798038103d269b633813fc60c',
  spanId: 'eee19b7ec3c1b174',
  name: 'explode',
  startTimeUnixNano: '1761000000123000000',
  endTimeUnixNano: '1761000000124000000',
  attributes: {
    'reatom.name': 'explode',
    'reatom.kind': 'action',
    'reatom.outcome': 'error',
    'reatom.params': '[]',
    'reatom.frame.id': '1',
    'exception.type': 'TypeError',
    'exception.message': 'boom',
    'exception.stacktrace': 'TypeError: boom\n    at explode',
  },
  status: { code: 2, message: 'boom' },
}

const okSlow = {
  traceId: '5b8efff798038103d269b633813fc60c',
  spanId: 'aaa19b7ec3c1b174',
  parentSpanId: 'eee19b7ec3c1b174',
  name: 'submit',
  startTimeUnixNano: '1761000000123000000',
  endTimeUnixNano: '1761000000963000000',
  attributes: {
    'reatom.name': 'submit',
    'reatom.kind': 'action',
    'reatom.outcome': 'ok',
    'reatom.frame.id': '2',
  },
}

test('MCP tool names stay the ten exported functions', () => {
  const { mcp } = createMcp()
  expect(Object.keys(mcp).sort()).toEqual([...ADMIN_MCP_TOOL_NAMES].sort())
})

test('search and getTrace headlines mention errors and order error spans first', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [exploding, okSlow])

  const searched = mcp.search({})
  expect(searched.ok).toBe(true)
  if (!searched.ok) return
  expect(searched.headline).toMatch(/error/)
  expect(searched.data[0]!.hasError).toBe(true)
  expect(searched.data[0]!.name).toBe('explode')

  const trace = mcp.getTrace({ traceId: exploding.traceId })
  expect(trace.ok).toBe(true)
  if (!trace.ok) return
  expect(trace.headline).toMatch(/error/)
  expect(trace.data.nodes[0]!.hasError).toBe(true)
  expect(trace.data.nodes[0]!.name).toBe('explode')
  expect(trace.data.nodes.map((node) => node.name)).toEqual(['explode', 'submit'])
})

test('search headline includes the plain-language filter sentence', () => {
  const { admin, mcp } = createMcp()
  ingest(admin, [exploding, okSlow])

  expect(describeMcpFilter({ calculator: 'kind:action duration>100ms' })).toBe(
    'actions slower than 100ms',
  )
  expect(describeMcpFilter({ calculator: 'cause>submit' })).toContain('submit')

  const searched = mcp.search({
    filter: { calculator: 'kind:action duration>100ms' },
  })
  expect(searched.ok).toBe(true)
  if (!searched.ok) return
  expect(searched.headline).toContain('actions slower than 100ms')
})

test('summary groups matching errors and says so when there are none', () => {
  const { admin, mcp } = createMcp()
  const second = {
    ...exploding,
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: 'bbbbbbbbbbbbbbbb',
    startTimeUnixNano: '1761000000223000000',
    endTimeUnixNano: '1761000000224000000',
    attributes: {
      ...exploding.attributes,
      'reatom.frame.id': '3',
    },
  }
  const otherMessage = {
    ...exploding,
    traceId: 'cccccccccccccccccccccccccccccccc',
    spanId: 'dddddddddddddddd',
    startTimeUnixNano: '1761000000323000000',
    endTimeUnixNano: '1761000000324000000',
    attributes: {
      ...exploding.attributes,
      'exception.message': 'boom\nextra line is ignored',
      'reatom.frame.id': '4',
    },
  }
  ingest(admin, [exploding, second, otherMessage, okSlow])

  const result = mcp.summary()
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.headline).toMatch(/error/)
  expect(result.data.errors).toHaveLength(1)
  expect(result.data.errors[0]!.count).toBe(3)
  expect(result.data.errors[0]!.reatomName).toBe('explode')
  expect(result.data.errors[0]!.type).toBe('TypeError')
  expect(result.data.errors[0]!.message).toBe('boom')
  expect(result.data.errors[0]!.traceIds.length).toBeLessThanOrEqual(5)
  expect(result.data.errors[0]!.traceIds).toHaveLength(3)
  expect(result.data.errors[0]!.culprit).toBe('explode')

  const emptyAdmin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })
  const empty = reatomOtlpMcp(emptyAdmin).summary()
  expect(empty.ok).toBe(true)
  if (!empty.ok) return
  expect(empty.data.errors).toEqual([])
  expect(empty.headline).toMatch(/no errors/)
})

test('summary traceIds never exceed five', () => {
  const { admin, mcp } = createMcp()
  const batch = Array.from({ length: 8 }, (_, index) => ({
    ...exploding,
    traceId: index.toString(16).padStart(32, 'c'),
    spanId: index.toString(16).padStart(16, 'd'),
    attributes: {
      ...exploding.attributes,
      'reatom.frame.id': String(index + 1),
    },
  }))
  ingest(admin, batch)
  const result = mcp.summary()
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.data.errors[0]!.count).toBe(8)
  expect(result.data.errors[0]!.traceIds).toHaveLength(5)
})

test('truncated search includes header.truncated and a next-call hint', () => {
  const { admin, mcp } = createMcp()
  const batch = Array.from({ length: 120 }, (_, index) => ({
    traceId: `t${index.toString().padStart(31, '0')}`,
    spanId: `s${index.toString().padStart(15, '0')}`,
    name: `synth.action.${index}`,
    startTimeUnixNano: String(
      1761000000000000000n + BigInt(index) * 1_000_000n,
    ),
    endTimeUnixNano: String(1761000000001000000n + BigInt(index) * 1_000_000n),
    attributes: {
      'reatom.name': `synth.action.${index}`,
      'reatom.kind': 'action',
      'reatom.outcome': 'ok',
      'reatom.frame.id': String(index + 1),
      'reatom.params': JSON.stringify({ index, pad: 'x'.repeat(40) }),
    },
  }))
  ingest(admin, batch)
  const first = mcp.search({})
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.header.truncated).toBe(true)
  expect(first.headline).toMatch(/record/)
  expect(first.hints?.some((hint) => hint.includes('search'))).toBe(true)
  expect(first.hints?.some((hint) => hint.includes('cursor'))).toBe(true)
})

test('shrink keeps the error path under the 20 KB cap', () => {
  const { admin, mcp } = createMcp()
  const blob = 'B'.repeat(40 * 1024)
  ingest(admin, [
    {
      ...exploding,
      attributes: {
        ...exploding.attributes,
        'app.blob': blob,
        'reatom.params': JSON.stringify({ id: 7, pad: 'p'.repeat(200) }),
      },
    },
    {
      ...okSlow,
      attributes: {
        ...okSlow.attributes,
        'app.blob': blob,
      },
    },
  ])

  const trace = mcp.getTrace({ traceId: exploding.traceId })
  expect(jsonUtf8Bytes(trace)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(trace.ok).toBe(true)
  if (!trace.ok) return
  expect(trace.header.valuesTruncated).toBe(true)
  const errorNode = trace.data.nodes.find((node) => node.hasError)
  expect(errorNode).toBeDefined()
  expect(errorNode!.attributes['exception.type']).toBe('TypeError')
  expect(String(errorNode!.attributes['exception.message'])).toContain('boom')
  expect(errorNode!.attributes['reatom.outcome']).toBe('error')
  expect(errorNode!.id.includes('…')).toBe(false)
  expect(JSON.stringify(trace).includes('live-secret')).toBe(false)

  const record = mcp.getRecord({ id: errorNode!.id })
  expect(jsonUtf8Bytes(record)).toBeLessThanOrEqual(ADMIN_MCP_MAX_BYTES)
  expect(record.ok).toBe(true)
  if (!record.ok) return
  expect(record.header.valuesTruncated).toBe(true)
  expect(record.data.record.attributes['exception.type']).toBe('TypeError')
  expect(String(record.data.record.attributes['exception.message'])).toContain(
    'boom',
  )
  expect(record.data.record.attributes['reatom.outcome']).toBe('error')
  expect(record.data.record.attributes['reatom.params']).toBeDefined()
  expect(record.hints?.some((hint) => hint.includes('getRecord'))).toBe(true)
})
