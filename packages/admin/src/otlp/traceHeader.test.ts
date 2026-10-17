import { expect, test } from 'test'

import type { AdminRecord } from './ingest.ts'
import {
  singleTraceId,
  TRACE_TRIAGE_MIN_SPANS,
  traceHeaderStats,
  traceTriageStats,
  triageNameFilter,
} from './traceHeader.ts'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: patch.id ?? 'id',
    sourceId: 'local',
    kind: 'span',
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: patch.spanId ?? 'span',
    name: 'root',
    start: 0,
    end: 100,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    reatomKind: 'action',
    ...patch,
  }
}

test('trace header is absent when records span more than one trace', () => {
  expect(
    traceHeaderStats([
      record({ traceId: 'aa' }),
      record({ id: 'b', traceId: 'bb' }),
    ]),
  ).toBeUndefined()
  expect(singleTraceId([record(), record({ id: 'b' })])).toBe(
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  )
})

test('trace header names the root, counts kinds, and shares ended span time', () => {
  const stats = traceHeaderStats([
    record({
      id: 'root',
      spanId: 'root',
      name: 'checkout',
      start: 0,
      end: 400,
      reatomKind: 'action',
    }),
    record({
      id: 'child',
      spanId: 'child',
      parentSpanId: 'root',
      name: 'price',
      start: 10,
      end: 110,
      reatomKind: 'computed',
    }),
    record({
      id: 'write',
      kind: 'log',
      spanId: 'child',
      name: 'cart',
      start: 20,
      end: 20,
      reatomKind: 'atom',
    }),
    record({
      id: 'open',
      spanId: 'open',
      parentSpanId: 'root',
      name: 'pay',
      start: 50,
      end: undefined,
      reatomKind: 'effect',
      outcome: 'pending',
    }),
  ])
  expect(stats?.rootName).toBe('checkout')
  expect(stats?.durationMs).toBe(400)
  expect(stats?.spanCount).toBe(3)
  expect(stats?.logCount).toBe(1)
  expect(stats?.atomCount).toBe(1)
  expect(stats?.outcome).toBe('pending')
  expect(stats?.kindShare.map((share) => share.kind)).toEqual([
    'action',
    'computed',
  ])
  expect(stats?.kindShare[0]?.durationMs).toBe(300)
  expect(stats?.kindShare[1]?.durationMs).toBe(100)
  const shareSum = stats!.kindShare.reduce((sum, share) => sum + share.share, 0)
  expect(shareSum).toBeCloseTo(1)
})

test('trace header outcome is error when any record failed', () => {
  const stats = traceHeaderStats([
    record({ name: 'pay' }),
    record({
      id: 'fail',
      parentSpanId: 'span',
      name: 'charge',
      outcome: 'error',
    }),
  ])
  expect(stats?.outcome).toBe('error')
})

test('triage line hides below eight spans and matches hand counts', () => {
  const few = Array.from({ length: TRACE_TRIAGE_MIN_SPANS - 1 }, (_, index) =>
    record({ id: `s${index}`, name: 'click' }),
  )
  expect(traceTriageStats(few)).toBeUndefined()

  const records = [
    ...Array.from({ length: 5 }, (_, index) =>
      record({
        id: `busy${index}`,
        name: 'render',
        start: index * 10,
        end: index * 10 + 20,
      }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      record({
        id: `err${index}`,
        name: 'save',
        start: 100 + index,
        end: 140 + index,
        outcome: 'error',
      }),
    ),
    record({
      id: 'slow',
      name: 'fetch',
      start: 0,
      end: 900,
    }),
  ]
  expect(records.filter((entry) => entry.kind === 'span')).toHaveLength(9)
  const triage = traceTriageStats(records)
  expect(triage?.segments.map((segment) => segment.id)).toEqual([
    'busiest',
    'errors',
    'slowest',
  ])
  expect(triage?.segments[0]).toMatchObject({
    name: 'render',
    value: '5×',
  })
  expect(triage?.segments[1]).toMatchObject({
    name: 'save',
    value: '3',
    tone: 'error',
  })
  expect(triage?.segments[2]).toMatchObject({
    name: 'fetch',
    value: '900ms',
    tone: 'default',
  })
})

test('triage omits the error segment when no span failed', () => {
  const records = Array.from({ length: 8 }, (_, index) =>
    record({ id: `ok${index}`, name: 'tick', end: 10 }),
  )
  const triage = traceTriageStats(records)
  expect(triage?.segments.map((segment) => segment.id)).toEqual([
    'busiest',
    'slowest',
  ])
})

test('triage name filter quotes calculator values', () => {
  expect(triageNameFilter('makeMove')).toBe('name=makeMove')
  expect(triageNameFilter('user session')).toBe('name="user session"')
})

test('trace header counts every record of a single trace, not a 200 window', () => {
  const records = Array.from({ length: 201 }, (_, index) =>
    record({
      id: `r${index}`,
      spanId: `s${index}`,
      parentSpanId: index === 0 ? undefined : 's0',
      name: index === 0 ? 'checkout' : 'child',
      start: index,
      end: index + 1,
    }),
  )
  const stats = traceHeaderStats(records)
  expect(stats?.rootName).toBe('checkout')
  expect(stats?.spanCount).toBe(201)
})
