import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from '../otlp/chrome.ts'
import { reatomOtlpMcp } from './index.ts'

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

test('AD-7 journey: find the failing trace through tools only, then clear', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })
  const mcp = reatomOtlpMcp(admin)
  ADMIN_FRAME.run(() =>
    admin.ingest([
      explodingSpan,
      exceptionJoin.log,
      atomUpdate.span,
      atomUpdate.log,
    ]),
  )

  const summary = mcp.summary()
  expect(summary.ok).toBe(true)
  if (!summary.ok) return
  expect(summary.header.recordCount).toBe(4)
  expect(summary.header.errorCount).toBeGreaterThan(0)

  const errors = mcp.search({ filter: { hasError: true } })
  expect(errors.ok).toBe(true)
  if (!errors.ok) return
  const failing = errors.data.find((row) => row.name === 'explode')
  expect(failing).toBeDefined()
  expect(failing!.traceId).toBe(exceptionJoin.span.traceId)
  expect(failing!.attributes['reatom.outcome']).toBe('error')
  expect(failing!.attributes['app.scenario']).toBe('exception-join')

  const listed = mcp.listTraces({ filter: { hasError: true } })
  expect(listed.ok).toBe(true)
  if (!listed.ok) return
  expect(listed.data.map((row) => row.traceId)).toContain(failing!.traceId)

  const trace = mcp.getTrace({ traceId: failing!.traceId })
  expect(trace.ok).toBe(true)
  if (!trace.ok) return
  expect(trace.data.rootName).toBe('explode')
  expect(trace.data.nodes[0]!.hasError).toBe(true)
  expect(trace.data.nodes[0]!.attributes['reatom.name']).toBe('explode')
  expect(trace.data.nodes[0]!.attributes['app.scenario']).toBe('exception-join')

  const explodeRecord = mcp.getRecord({ id: failing!.id })
  expect(explodeRecord.ok).toBe(true)
  if (!explodeRecord.ok) return
  expect(explodeRecord.data.record.attributes['reatom.kind']).toBe('action')
  expect(explodeRecord.data.record.attributes['app.scenario']).toBe(
    'exception-join',
  )
  expect(explodeRecord.data.record.error?.message).toBe('boom')

  const causeSearch = mcp.search({ filter: { query: 'tree.checked' } })
  expect(causeSearch.ok).toBe(true)
  if (!causeSearch.ok) return
  const checked = causeSearch.data.find((row) => row.atomName === 'tree.checked')
  expect(checked).toBeDefined()
  expect(checked!.attributes['reatom.name']).toBe('tree.checked')

  const checkedRecord = mcp.getRecord({ id: checked!.id })
  expect(checkedRecord.ok).toBe(true)
  if (!checkedRecord.ok) return
  expect(checkedRecord.data.causes).toEqual([
    { id: '1', name: 'tree#12.toggle' },
  ])
  expect(checkedRecord.data.record.attributes['reatom.cause.ids']).toEqual(['1'])

  const state = mcp.getState({ path: 'tree.checked' })
  expect(state.ok).toBe(true)
  if (!state.ok) return
  expect(JSON.stringify(state.data.nodes)).toContain('checked')

  const cleared = mcp.clear()
  expect(cleared.ok).toBe(true)
  if (!cleared.ok) return
  expect(cleared.data.cleared).toBe(true)

  const afterSummary = mcp.summary()
  expect(afterSummary.ok).toBe(true)
  if (!afterSummary.ok) return
  expect(afterSummary.header.recordCount).toBe(0)
  expect(afterSummary.data.names).toEqual([])

  const afterSearch = mcp.search({ filter: { hasError: true } })
  expect(afterSearch.ok).toBe(true)
  if (!afterSearch.ok) return
  expect(afterSearch.data).toEqual([])
  expect(afterSearch.header.recordCount).toBe(0)

  const afterList = mcp.listTraces({})
  expect(afterList.ok).toBe(true)
  if (!afterList.ok) return
  expect(afterList.data).toEqual([])
})
