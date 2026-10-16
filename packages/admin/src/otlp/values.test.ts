import { expect, test } from 'test'

import { recordValuePreview } from './bind.ts'
import { LOCAL_VALUES, type AdminRecord } from './ingest.ts'
import { recordValues, recordValuesText } from './values.ts'

function record(overrides: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: 'id',
    sourceId: 'local',
    kind: 'log',
    traceId: 'aa',
    spanId: 'bb',
    name: 'score',
    start: 0,
    attributes: {
      'reatom.params': '[1]',
      'reatom.payload': '{"ok":true}',
    },
    body: { masked: true },
    resource: {},
    links: [],
    causeIds: [],
    eventName: 'reatom.atom.update',
    ...overrides,
  }
}

test('recordValues reads local references or masked OTLP fields', () => {
  const live = {
    params: [1, { nested: true }],
    payload: { token: 'live' },
    state: { n: 2 },
    error: new Error('boom'),
  }
  const local = record({ [LOCAL_VALUES]: live, body: '***' })
  expect(recordValues(local)).toEqual({ ...live, source: 'local' })
  expect(recordValuePreview(local)).toEqual({ n: 2 })

  const payloadOnly = record({
    [LOCAL_VALUES]: { payload: 'live-payload' },
    body: '***',
  })
  expect(recordValuePreview(payloadOnly)).toBe('live-payload')

  const otlp = record()
  expect(recordValues(otlp)).toEqual({
    params: [1],
    payload: { ok: true },
    state: { masked: true },
    error: undefined,
    source: 'otlp',
  })
  expect(recordValuePreview(otlp)).toEqual({ masked: true })

  const broken = record({
    kind: 'span',
    body: 'span-body',
    attributes: {
      'reatom.params': 'not-json',
      'reatom.payload': '{',
    },
    eventName: undefined,
    outcome: 'ok',
  })
  expect(recordValues(broken)).toMatchObject({
    params: 'not-json',
    payload: '{',
    state: undefined,
    source: 'otlp',
  })
  expect(recordValuePreview(broken)).toBe('span-body')
})

test('recordValuesText is bounded, cached, and safe on cycles and exotic values', () => {
  const cyclic: { self?: unknown; token: string } = { token: 'cycle-token' }
  cyclic.self = cyclic
  const secretFn = function secretFn() {}
  const values = {
    params: [
      cyclic,
      9007199254740993n,
      Symbol('symbol-secret'),
      secretFn,
      new Map([['map-secret', 1]]),
      new Set(['set-secret']),
    ],
    state: 'x'.repeat(80_000),
    payload: {
      get boom() {
        throw new Error('getter')
      },
      ok: 'safe-token',
    },
  }
  const entry = record({ [LOCAL_VALUES]: values })
  const text = recordValuesText(entry)
  expect(text.length).toBeLessThanOrEqual(64 * 1024)
  expect(text).toContain('cycle-token')
  expect(text).toContain('9007199254740993')
  expect(text).toContain('symbol-secret')
  expect(text).toContain('secretFn')
  expect(text).toContain('map-secret')
  expect(text).toContain('set-secret')
  expect(text).toContain('safe-token')
  expect(recordValuesText(entry)).toBe(text)

  delete entry[LOCAL_VALUES]
  expect(recordValuesText(entry)).toBe('')
})
