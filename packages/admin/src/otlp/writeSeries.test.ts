import { expect, test } from 'test'

import type { AdminRecord } from './ingest.ts'
import {
  atomWriteSeries,
  formatWriteChangeText,
  groupWriteCounts,
  writeCountByAtom,
  writeSeriesHeader,
} from './writeSeries.ts'

function record(patch: Partial<AdminRecord>): AdminRecord {
  return {
    id: 'r',
    sourceId: 'local',
    kind: 'log',
    traceId: 'trace',
    spanId: 'span',
    name: 'count',
    start: 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    atomName: 'count',
    eventName: 'reatom.atom.update',
    reatomKind: 'atom',
    ...patch,
  }
}

test('atomWriteSeries is chronological and flags error-caused writes', () => {
  const action: AdminRecord = {
    ...record({
      id: 'a',
      kind: 'span',
      name: 'save',
      atomName: 'save',
      eventName: undefined,
      reatomKind: 'action',
      frameId: '1',
      start: 1,
      outcome: 'error',
    }),
  }
  const first = record({
    id: 'w1',
    body: 1,
    start: 10,
    frameId: '2',
    causeIds: ['1'],
  })
  const second = record({
    id: 'w2',
    body: 3,
    start: 20,
    frameId: '3',
    causeIds: [],
  })
  const boolWrite = record({
    id: 'w3',
    atomName: 'on',
    name: 'on',
    body: true,
    start: 30,
    frameId: '4',
  })
  const series = atomWriteSeries([action, first, second, boolWrite], 'count', 'local')
  expect(series.map((point) => point.record.id)).toEqual(['w1', 'w2'])
  expect(series[0]?.numeric).toBe(1)
  expect(series[0]?.hasErrorCause).toBe(true)
  expect(series[1]?.hasErrorCause).toBe(false)
  expect(writeSeriesHeader(series)).toEqual({
    first: 10,
    last: 20,
    count: 2,
  })
  expect(writeCountByAtom([first, second, boolWrite]).get('local:count')).toBe(2)
  expect(atomWriteSeries([boolWrite], 'on', 'local')[0]?.numeric).toBe(1)
})

test('groupWriteCounts match the history list by cause and outcome', () => {
  const save = record({
    id: 'save',
    kind: 'span',
    name: 'save',
    atomName: 'save',
    eventName: undefined,
    reatomKind: 'action',
    frameId: '1',
    start: 1,
  })
  const writes = [
    record({ id: 'w1', body: 1, start: 10, frameId: '2', causeIds: ['1'], outcome: 'ok' }),
    record({ id: 'w2', body: 2, start: 20, frameId: '3', causeIds: ['1'], outcome: 'error' }),
    record({ id: 'w3', body: 3, start: 30, frameId: '4', causeIds: [], outcome: 'ok' }),
  ]
  const records = [save, ...writes]
  const points = atomWriteSeries(records, 'count', 'local')
  expect(groupWriteCounts(points, 'cause', records)).toEqual([
    { label: 'save', count: 2 },
    { label: '(none)', count: 1 },
  ])
  expect(groupWriteCounts(points, 'outcome', records)).toEqual([
    { label: 'ok', count: 2 },
    { label: 'error', count: 1 },
  ])
})

test('formatWriteChangeText is prev → next for scalar writes', () => {
  const previous = record({ id: 'w1', body: 1, start: 10 })
  const next = record({ id: 'w2', body: 3, start: 20 })
  expect(formatWriteChangeText(next, [previous, next])).toBe('1 → 3')
  expect(formatWriteChangeText(record({ id: 'm', body: '***' }), [])).toBe(
    'masked',
  )
})
