import { expect, test } from 'test'

import { reatomOtlpStore } from '../otlp/ingest'
import { adminRecordTiming } from './records'
import { reatomGantt } from './reatomGantt'

const msToNano = (ms: number) => String(BigInt(ms) * 1_000_000n)

const otlpSpan = (
  name: string,
  spanId: string,
  startMs: number,
  endMs: number,
  parentSpanId?: string,
) => ({
  traceId: 'trace-1',
  spanId,
  parentSpanId,
  name,
  startTimeUnixNano: msToNano(startMs),
  endTimeUnixNano: msToNano(endMs),
})

const otlpLog = (eventName: string, spanId: string, timeMs: number) => ({
  traceId: 'trace-1',
  spanId,
  eventName,
  timeUnixNano: msToNano(timeMs),
})

const setup = () => {
  const store = reatomOtlpStore({ sourceId: 'local', resource: {} })
  const gantt = reatomGantt(store.records, adminRecordTiming, 'recordGantt')
  const names = () => gantt.rows().map(({ name }) => name)
  return { store, gantt, names }
}

test('spans arriving child first form a tree with logs under their span', () => {
  const { store, gantt, names } = setup()
  store.ingest([
    otlpSpan('child', 'c', 1010, 1020, 'p'),
    otlpLog('child.log', 'c', 1015),
    otlpSpan('parent', 'p', 1000, 1050),
    otlpSpan('next', 'n', 1100, 1110),
  ])

  expect(names()).toEqual(['parent', 'next'])
  gantt.expandAll()
  expect(names()).toEqual(['parent', 'child', 'child.log', 'next'])
  expect(gantt.rows().map(gantt.depth)).toEqual([0, 1, 2, 0])

  gantt.mode.set('log')
  expect(names()).toEqual(['parent', 'child', 'child.log', 'next'])

  expect(gantt.range()).toEqual({ start: 1000, end: 1110 })
  const parent = gantt.rows()[0]!
  expect(gantt.bar(parent)).toEqual({ left: 0, width: 50 / 110 })
  expect(gantt.rows()).toContain(store.records()[0])
})

test('clearing the store empties the window', () => {
  const { store, gantt } = setup()
  store.ingest([otlpSpan('only', 's', 0, 10)])
  expect(gantt.virtual().size).toBe(1)
  store.clear()
  expect(gantt.virtual()).toEqual({ items: [], offset: 0, size: 0 })
  expect(gantt.virtual.padding()).toEqual({ before: 0, after: 0 })
})
