import { expect, test } from 'test'

import type { AdminRecord } from '../otlp/ingest'
import {
  appendCausalGraph,
  buildCausalGraph,
  causalAppendIndex,
  crossingRails,
  layoutCausalLanes,
  projectCausalEdges,
  type CausalEvent,
} from './graph'

const event = (
  key: string,
  causes: string[] = [],
  extra: Partial<AdminRecord> = {},
): CausalEvent => ({
  key,
  ordinal: Number(key) || key.charCodeAt(0),
  record: {
    id: key,
    sourceId: 'local',
    traceId: 'trace',
    spanId: key,
    kind: 'span',
    name: key,
    frameId: key,
    start: Number(key) || key.charCodeAt(0),
    end: Number(key) + 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: causes,
    ...extra,
  },
})

test('all causes converge on one effect while raw input and measured time stay untouched', () => {
  const input = [event('3', ['1', '2'], { start: 0 }), event('2'), event('1')]
  const graph = buildCausalGraph(input)
  expect(graph.order).toEqual(['1', '2', '3'])
  expect(graph.edges.map((edge) => [edge.from, edge.to])).toEqual([
    ['1', '3'],
    ['2', '3'],
  ])
  expect(graph.events.get('3')!.record.start).toBe(0)
  expect(input.map((item) => item.key)).toEqual(['3', '2', '1'])
})

test('explicit span links resolve other traces and ambiguous frame namespaces stay boundaries', () => {
  const effect = event('3', [], {
    links: [
      { traceId: 'other', spanId: 'parent', reason: 'computed.dependency' },
    ],
  })
  const parent = event('1', [], { traceId: 'other', spanId: 'parent' })
  expect(buildCausalGraph([effect, parent]).parents.get('3')).toEqual(['1'])
  const ambiguous = event('4', [], {
    traceId: 'other',
    spanId: 'parent',
    sourceId: 'remote',
  })
  const graph = buildCausalGraph([effect, parent, ambiguous])
  expect(graph.parents.get('3')).toEqual([])
  expect(graph.boundaries.get('3')).toEqual(['Ambiguous dependency parent'])
})

test('hidden diamond steps bridge with unique counts, direct relationships win, scope blocks traversal', () => {
  const graph = buildCausalGraph([
    event('1'),
    event('2', ['1']),
    event('3', ['1']),
    event('4', ['2', '3']),
  ])
  const visible = new Set(['1', '4']),
    scope = new Set(['1', '2', '3', '4'])
  const projected = projectCausalEdges(graph, visible, scope)
  expect(
    projected.edges.map((edge) => [edge.from, edge.to, edge.hidden]),
  ).toEqual([['1', '4', ['2', '3']]])
  const direct = buildCausalGraph([
    event('1'),
    event('2', ['1']),
    event('4', ['1', '2']),
  ])
  expect(projectCausalEdges(direct, visible, scope).edges[0]!.hidden).toEqual(
    [],
  )
  const blocked = projectCausalEdges(graph, visible, new Set(['1', '4']))
  expect(blocked.edges).toEqual([])
  expect(blocked.boundaries.get('4')).toEqual(['Cause outside source/scope'])
})

test('cycles, self-links, and missing endpoints retain every event and terminate projection', () => {
  const graph = buildCausalGraph([
    event('1', ['2']),
    event('2', ['1']),
    event('3', ['3', 'missing']),
    event('4', ['2']),
  ])
  expect(new Set(graph.order)).toEqual(new Set(['1', '2', '3', '4']))
  expect(graph.cyclic).toEqual(new Set(['1', '2']))
  expect(graph.edges.find((edge) => edge.to === '4')!.cyclic).toBe(false)
  expect(graph.boundaries.get('3')).toEqual([
    'Self-link',
    'Unavailable cause missing',
  ])
  expect(
    projectCausalEdges(graph, new Set(['4']), new Set(graph.order)).edges,
  ).toEqual([])
})

test('lane queries include offscreen endpoints, retain valid assignments, and never collide in interiors', () => {
  const graph = buildCausalGraph(
    Array.from({ length: 20 }, (_, index) =>
      event(String(index + 1), index > 9 ? [String(20 - index)] : []),
    ),
  )
  const lanes = layoutCausalLanes(graph.order, graph.edges)
  expect(lanes.laneCount).toBeGreaterThan(5)
  const crossing = crossingRails(lanes, 9, 10)
  const brute = lanes.intervals.filter(
    (edge) => edge.start <= 10 && edge.end >= 9,
  )
  expect(new Set(crossing.map((edge) => edge.key))).toEqual(
    new Set(brute.map((edge) => edge.key)),
  )
  for (const edge of lanes.intervals)
    for (const other of lanes.intervals)
      if (edge !== other && edge.lane === other.lane)
        expect(
          Math.max(edge.start, other.start) >= Math.min(edge.end, other.end),
        ).toBe(true)
  expect(
    layoutCausalLanes(graph.order, graph.edges, lanes).intervals.map((edge) => [
      edge.key,
      edge.lane,
    ]),
  ).toEqual(lanes.intervals.map((edge) => [edge.key, edge.lane]))
})

test('certified append agrees with complete graph and rejects late resolutions or skew', () => {
  const graph = buildCausalGraph([event('1'), event('2', ['1'])])
  const appended = appendCausalGraph(
    graph,
    [event('3', ['1', '2'])],
    causalAppendIndex(graph),
  )!
  const oracle = buildCausalGraph([
    event('1'),
    event('2', ['1']),
    event('3', ['1', '2']),
  ])
  expect(appended.order).toEqual(oracle.order)
  expect(appended.edges).toEqual(oracle.edges)
  expect(graph.order).toEqual(['1', '2'])
  expect(
    appendCausalGraph(
      graph,
      [event('4', [], { start: 0 })],
      causalAppendIndex(graph),
    ),
  ).toBe(null)
  const pending = buildCausalGraph([event('3', ['1'])])
  expect(
    appendCausalGraph(pending, [event('1')], causalAppendIndex(pending)),
  ).toBe(null)
})

test('tail lane insertion retains old immutable geometry and agrees with brute-force crossings', async () => {
  const { appendCausalLanes } = await import('./graph')
  const before = buildCausalGraph([
    event('1'),
    event('2', ['1']),
    event('3', ['1']),
  ])
  const lanes = layoutCausalLanes(before.order, before.edges)
  const snapshot = JSON.stringify(lanes)
  const after = buildCausalGraph([
    event('1'),
    event('2', ['1']),
    event('3', ['1']),
    event('4', ['1', '2', '3']),
  ])
  const next = appendCausalLanes(
    lanes,
    ['4'],
    after.edges.filter((edge) => edge.to === '4'),
  )
  expect(JSON.stringify(lanes)).toBe(snapshot)
  for (let row = 0; row < 4; row++)
    expect(new Set(crossingRails(next, row).map((edge) => edge.key))).toEqual(
      new Set(
        next.intervals
          .filter((edge) => edge.start <= row && edge.end >= row)
          .map((edge) => edge.key),
      ),
    )
  expect(next.intervals.slice(0, lanes.intervals.length)).toEqual(
    lanes.intervals,
  )
})

test('a large hidden gap projects once without copying a growing path at every step', () => {
  const graph = buildCausalGraph(
    Array.from({ length: 10000 }, (_, index) =>
      event(String(index + 1), index ? [String(index)] : []),
    ),
  )
  const projected = projectCausalEdges(
    graph,
    new Set(['1', '10000']),
    new Set(graph.order),
  )
  expect(projected.edges).toHaveLength(1)
  expect(projected.edges[0]!.hidden).toHaveLength(9998)
  expect(new Set(projected.edges[0]!.hidden).size).toBe(9998)
})
