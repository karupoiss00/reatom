import { afterEach, beforeEach, expect, test } from 'test'

import { wrap } from '@reatom/core'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from '../otlp/chrome.ts'
import {
  ADMIN_MCP_CALL_LOG_LIMIT,
  ADMIN_MCP_TOOL_NAMES,
  mcpCallLog,
  mcpFilterToCalculatorDraft,
  reatomOtlpMcp,
  resetMcpCallLog,
} from './index.ts'

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
}

beforeEach(() => {
  resetMcpCallLog()
})

afterEach(() => {
  resetMcpCallLog()
})

function createMcp() {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })
  return { admin, mcp: reatomOtlpMcp(admin) }
}

test('a search call is logged with the headline and does not ingest a frame', () => {
  const { admin, mcp } = createMcp()
  ADMIN_FRAME.run(() =>
    admin.ingest([
      {
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: 'bbbbbbbbbbbbbbbb',
        name: 'explode',
        startTimeUnixNano: '1761000000123000000',
        endTimeUnixNano: '1761000000124000000',
        attributes: {
          'reatom.name': 'explode',
          'reatom.kind': 'action',
          'reatom.outcome': 'error',
          'exception.type': 'TypeError',
          'exception.message': 'boom',
        },
      },
    ]),
  )
  const before = ADMIN_FRAME.run(() => admin.records().length)
  const searched = mcp.search({ filter: { hasError: true } })
  expect(searched.ok).toBe(true)
  if (!searched.ok) return
  expect(ADMIN_FRAME.run(() => admin.records().length)).toBe(before)

  const log = mcpCallLog()
  expect(log.entries()).toHaveLength(1)
  expect(log.entries()[0]!.tool).toBe('search')
  expect(log.entries()[0]!.ok).toBe(true)
  expect(log.entries()[0]!.headline).toBe(searched.headline)
  expect(log.entries()[0]!.headline).toMatch(/error/)
  expect(log.entries()[0]!.filter).toEqual({ hasError: true })
  expect(log.writeCount()).toBe(0)
})

test('clear increments the write count and applyThisFilter fills the draft only', () => {
  const { admin, mcp } = createMcp()
  mcp.search({ filter: { calculator: 'kind:action', name: 'explode' } })
  mcp.clear()
  const log = mcpCallLog()
  expect(log.writeCount()).toBe(1)
  expect(log.entries().some((entry) => entry.tool === 'clear')).toBe(true)
  const searchEntry = log.entries().find((entry) => entry.tool === 'search')
  expect(searchEntry).toBeDefined()
  log.applyThisFilter(searchEntry!)
  expect(ADMIN_FRAME.run(() => log.pendingCalculatorDraft())).toBe('kind:action')
  expect(ADMIN_FRAME.run(() => admin.filterCalculator())).toBe('')
})

test('connectRemote passwords are redacted in the buffer', async () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'clickhouse',
    resource: INSTANCE_RESOURCE,
    fetch: async () =>
      new Response(JSON.stringify({ error: 'denied' }), { status: 401 }),
  })
  const mcp = reatomOtlpMcp(admin)
  await ADMIN_FRAME.run(async () => {
    await wrap(mcp.connectRemote({ password: 'super-secret' }))
  })
  const entry = mcpCallLog()
    .entries()
    .find((item) => item.tool === 'connectRemote')
  expect(entry).toBeDefined()
  expect(JSON.stringify(entry!.args).includes('super-secret')).toBe(false)
  expect(entry!.args).toEqual({ password: '***' })
  expect(mcpCallLog().writeCount()).toBe(1)
})

test('the ring drops the oldest entries after 50 calls', () => {
  const { mcp } = createMcp()
  for (let index = 0; index < ADMIN_MCP_CALL_LOG_LIMIT + 3; index += 1) {
    mcp.summary()
  }
  const log = mcpCallLog()
  expect(log.entries()).toHaveLength(ADMIN_MCP_CALL_LOG_LIMIT)
  expect(log.entries()[0]!.tool).toBe('summary')
})

test('showOnTimeline selects a still-loaded record from the call', () => {
  const { admin, mcp } = createMcp()
  ADMIN_FRAME.run(() =>
    admin.ingest([
      {
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: 'bbbbbbbbbbbbbbbb',
        name: 'submit',
        startTimeUnixNano: '1761000000123000000',
        endTimeUnixNano: '1761000000124000000',
        attributes: {
          'reatom.name': 'submit',
          'reatom.kind': 'action',
          'reatom.outcome': 'ok',
        },
      },
    ]),
  )
  const searched = mcp.search({})
  expect(searched.ok).toBe(true)
  if (!searched.ok) return
  const entry = mcpCallLog().entries()[0]!
  mcpCallLog().showOnTimeline(admin, entry)
  expect(ADMIN_FRAME.run(() => admin.selectedRecordId())).toBe(
    searched.data[0]!.id,
  )
  expect(ADMIN_FRAME.run(() => admin.view())).toBe('timeline')
})

test('mcpFilterToCalculatorDraft prefers the calculator source', () => {
  expect(
    mcpFilterToCalculatorDraft({
      calculator: 'duration>16ms',
      hasError: true,
    }),
  ).toBe('duration>16ms')
  expect(mcpFilterToCalculatorDraft({ hasError: true, name: 'submit' })).toBe(
    'name:submit errors:true',
  )
})

test('exported tool names stay aligned with the bag', () => {
  const { mcp } = createMcp()
  expect(Object.keys(mcp)).toEqual([...ADMIN_MCP_TOOL_NAMES])
})
