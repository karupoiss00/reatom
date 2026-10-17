import { expect, test } from 'test'

import type { AdminRecord } from '../otlp/ingest'
import {
  previousWriteById,
  sourceIndexBySourceId,
  turnSectionByRootId,
} from './rowIndexes'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: patch.id ?? 'row',
    sourceId: patch.sourceId ?? 'local',
    kind: patch.kind ?? 'span',
    traceId: patch.traceId ?? 'trace',
    spanId: patch.spanId ?? 'span',
    name: patch.name ?? 'makeMove',
    start: patch.start ?? 0,
    end: patch.end ?? 40,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('sourceIndexBySourceId assigns first-seen order once', () => {
  const records = [
    record({ id: 'a', sourceId: 'one' }),
    record({ id: 'b', sourceId: 'two' }),
    record({ id: 'c', sourceId: 'one' }),
    record({ id: 'd', sourceId: 'three' }),
  ]
  const index = sourceIndexBySourceId(records)
  expect(index.get('one')).toBe(0)
  expect(index.get('two')).toBe(1)
  expect(index.get('three')).toBe(2)
  expect(index.size).toBe(3)
})

test('previousWriteById maps the nearest earlier write, not the latest', () => {
  const first = record({
    id: 'w1',
    kind: 'log',
    atomName: 'count',
    start: 1,
  })
  const middle = record({
    id: 'w2',
    kind: 'log',
    atomName: 'count',
    start: 2,
  })
  const last = record({
    id: 'w3',
    kind: 'log',
    atomName: 'count',
    start: 3,
  })
  const other = record({
    id: 'other',
    kind: 'log',
    atomName: 'name',
    start: 4,
  })
  const byId = previousWriteById([last, first, other, middle])
  expect(byId.get('w1')).toBeUndefined()
  expect(byId.get('w2')).toBe(first)
  expect(byId.get('w3')).toBe(middle)
  expect(byId.get('other')).toBeUndefined()
})

test('turnSectionByRootId keys sections by root id', () => {
  const root = record({
    id: 'root',
    parentSpanId: undefined,
    start: 0,
    end: 80,
  })
  const child = record({
    id: 'child',
    parentSpanId: 'span',
    start: 10,
    end: 20,
  })
  const sections = turnSectionByRootId([child, root])
  expect(sections.get('root')?.turn).toBe(1)
  expect(sections.get('child')).toBeUndefined()
})

