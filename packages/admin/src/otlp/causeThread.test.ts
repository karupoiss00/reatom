import { expect, test } from 'test'

import { selectedAncestorFrameIds } from '../cause-graph/otlpThread.ts'
import type { AdminRecord } from './ingest.ts'
import {
  causeReads,
  causeThreadRowSpan,
  causeTriggers,
  findCausePathIds,
  focusKeepIds,
  hopSet,
  selectedCauseThread,
  timeNeighbors,
  writtenBySelection,
} from './causeThread.ts'

function record(patch: Partial<AdminRecord>): AdminRecord {
  return {
    id: patch.frameId ?? 'r',
    sourceId: 'local',
    kind: 'span',
    traceId: 'trace',
    spanId: patch.frameId ?? 'span',
    name: 'n',
    start: 1,
    end: 4,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('selectedCauseThread walks ancestors, diamonds, and the earliest error', () => {
  const route = record({
    id: 'route',
    frameId: '1',
    name: 'route checkout',
    atomName: 'checkout',
    reatomKind: 'route',
    start: 1,
  })
  const cart = record({
    id: 'cart',
    frameId: '2',
    name: 'cartAtom',
    atomName: 'cartAtom',
    reatomKind: 'atom',
    start: 2,
  })
  const purchase = record({
    id: 'purchase',
    frameId: '3',
    name: 'checkout.purchase',
    atomName: 'checkout.purchase',
    reatomKind: 'action',
    causeIds: ['1'],
    start: 3,
    outcome: 'error',
  })
  const total = record({
    id: 'total',
    frameId: '4',
    name: 'total',
    atomName: 'total',
    reatomKind: 'computed',
    causeIds: ['3', '2'],
    links: [
      {
        traceId: 'trace',
        spanId: 's',
        reason: 'computed.dependency',
        frameId: '2',
      },
    ],
    start: 5,
    outcome: 'error',
  })
  const records = [route, cart, purchase, total]
  const thread = selectedCauseThread(records, total)
  expect(thread.ancestorFrameIds).toEqual(expect.arrayContaining(['1', '2', '3']))
  expect(thread.diamondFrameIds).toContain('4')
  expect(thread.errorAncestorFrameId).toBe('3')
  expect(selectedAncestorFrameIds(records, total)).toEqual(thread.ancestorFrameIds)
  expect(selectedCauseThread(records, null).ancestorFrameIds).toEqual([])

  expect(causeReads(total, records).map((row) => row.name)).toEqual(['cartAtom'])
  expect(causeTriggers(purchase, records).map((row) => row.name)).toEqual(['total'])
  expect(causeTriggers(purchase, records)).toHaveLength(1)

  const neighbors = timeNeighbors(purchase, records, 3)
  expect(neighbors.some((row) => row.selected)).toBe(true)
  expect(neighbors.find((row) => row.record.id === 'total')?.offsetMs).toBe(2)

  expect(findCausePathIds(records, '1', '4', 'trace')).toEqual([1, 3, 4])
  expect(findCausePathIds(records, '1', '4')).toBeNull()
  expect(writtenBySelection(records, purchase).has('local:checkout.purchase')).toBe(
    true,
  )
})

test('hopSet is 1-hop parents and children; focus keeps the cone', () => {
  const nodes = [
    { id: 1, label: 'a', kind: 'action' as const, timestamp: 1, parentIds: [], hasError: false },
    { id: 2, label: 'b', kind: 'state' as const, timestamp: 2, parentIds: [1], hasError: false },
    { id: 3, label: 'c', kind: 'state' as const, timestamp: 3, parentIds: [2], hasError: false },
    { id: 4, label: 'd', kind: 'state' as const, timestamp: 4, parentIds: [3], hasError: false },
  ]
  expect([...hopSet(nodes, 2, 1)].sort((a, b) => a - b)).toEqual([1, 2, 3])
  expect(focusKeepIds(nodes, 2).has(4)).toBe(true)
  expect(focusKeepIds(nodes, 2).has(1)).toBe(true)
})

test('causeThreadRowSpan maps rows by id so later selection only compares indexes', () => {
  const parent = record({ id: 'parent', frameId: '1', start: 1 })
  const child = record({
    id: 'child',
    frameId: '2',
    start: 2,
    causeIds: ['1'],
  })
  const other = record({ id: 'other', frameId: '9', start: 3 })
  const thread = selectedCauseThread([parent, child, other], child)
  const span = causeThreadRowSpan([parent, child, other], child, thread)
  expect(span).not.toBeNull()
  expect(span!.indexById.get('parent')).toBe(0)
  expect(span!.indexById.get('child')).toBe(1)
  expect(span!.lo).toBe(0)
  expect(span!.hi).toBe(1)
  expect(causeThreadRowSpan([parent, child, other], null, thread)).toBeNull()
})
