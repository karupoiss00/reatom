import { expect, test } from 'test'

import {
  buildCausalGraph,
  projectCausalEdges,
  type CausalEdge,
  type CausalEvent,
} from './graph'
import {
  crossingBuses,
  crossingBusSummary,
  groupCausalBuses,
  layoutCausalBuses,
  type CausalBusLayout,
} from './buses'

const edge = (
  from: string,
  to: string,
  hidden: readonly string[] = [],
  cyclic = false,
): CausalEdge => ({ key: JSON.stringify([from, to]), from, to, hidden, cyclic })
const layout = (
  order: readonly string[],
  edges: readonly CausalEdge[],
  budget = 4,
) => layoutCausalBuses(groupCausalBuses(order, edges), budget)
const assertComplete = (
  value: CausalBusLayout,
  edges: readonly CausalEdge[],
) => {
  const ownership = new Map<string, number>()
  for (const route of value.routes)
    for (const relation of route.edges)
      ownership.set(relation.key, (ownership.get(relation.key) ?? 0) + 1)
  expect(ownership.size).toBe(edges.length)
  expect([...ownership.values()].every((count) => count === 1)).toBe(true)
  for (const relation of edges)
    expect(value.edgeByKey.get(relation.key)).toBe(relation)
  expect(
    value.routes.reduce((count, route) => count + route.edges.length, 0),
  ).toBe(edges.length)
  expect(
    value.routes
      .filter((route) => route.lane === null)
      .reduce((count, route) => count + route.edges.length, 0),
  ).toBe(value.omittedRelationCount)
}

test('one thousand recorded effects share one trunk and one indexed branch per member', () => {
  const children = Array.from({ length: 1000 }, (_, index) => `effect ${index}`)
  const order = [
    'cause',
    ...children.slice(0, 500),
    'unrelated',
    ...children.slice(500),
  ]
  const edges = children.map((child) => edge('cause', child)),
    result = layout(order, edges)
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0]!.direction).toBe('effects')
  expect(result.routes[0]!.anchor).toBe('cause')
  expect(result.routes[0]!.edges).toHaveLength(1000)
  expect(result.laneCount).toBe(1)
  expect(crossingBuses(result, 501)).toHaveLength(1)
  expect(result.branchesByEvent.get('unrelated')).toBeUndefined()
  expect(result.routesByEvent.get('unrelated')).toBeUndefined()
  expect(result.branchesByEvent.get('cause')).toHaveLength(1)
  expect(result.branchesByEvent.get('cause')![0]!.count).toBe(1000)
  for (const child of children)
    expect(result.branchesByEvent.get(child)).toHaveLength(1)
  expect(
    [...result.branchesByEvent.values()].reduce(
      (count, branches) => count + branches.length,
      0,
    ),
  ).toBe(1001)
  assertComplete(result, edges)
})

test('one thousand recorded causes share one target bus without inventing causation between members', () => {
  const parents = Array.from({ length: 1000 }, (_, index) => `cause ${index}`)
  const edges = parents.map((parent) => edge(parent, 'computed')),
    result = layout([...parents, 'computed'], edges)
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0]!.direction).toBe('causes')
  expect(result.routes[0]!.anchor).toBe('computed')
  expect(result.incoming.get('computed')).toHaveLength(1000)
  expect(result.outgoing.get('cause 10')).toEqual([edges[10]])
  expect(result.branchesByEvent.get('computed')![0]).toMatchObject({
    incoming: true,
    outgoing: false,
    count: 1000,
  })
  expect(result.branchesByEvent.get('cause 10')![0]).toMatchObject({
    incoming: false,
    outgoing: true,
    count: 1,
  })
  expect(crossingBuses(result, 500, 540)).toHaveLength(1)
  assertComplete(result, edges)
})

test('incoming and outgoing stars use separate tracks at their shared event row', () => {
  const order = ['parent', 'sibling', 'selected', 'a', 'b', 'c']
  const incoming = [edge('parent', 'selected'), edge('parent', 'sibling')],
    outgoing = ['a', 'b', 'c'].map((effect) => edge('selected', effect)),
    edges = [...incoming, ...outgoing]
  const projection = groupCausalBuses(order, edges),
    result = layoutCausalBuses(projection, 2)
  const parentRoute = result.routes.find((route) => route.anchor === 'parent')!,
    selectedRoute = result.routes.find((route) => route.anchor === 'selected')!
  expect(result.routes).toHaveLength(2)
  expect(parentRoute.end).toBe(selectedRoute.start)
  expect(parentRoute.lane === null).toBe(false)
  expect(selectedRoute.lane === null).toBe(false)
  expect(parentRoute.lane === selectedRoute.lane).toBe(false)
  expect(result.laneCount).toBe(2)
  expect(new Set(parentRoute.edges)).toEqual(new Set(incoming))
  expect(new Set(selectedRoute.edges)).toEqual(new Set(outgoing))
  expect(result.incoming.get('selected')).toEqual([incoming[0]])
  expect(new Set(result.outgoing.get('selected'))).toEqual(new Set(outgoing))
  expect(new Set(result.branchesByEvent.get('selected'))).toEqual(
    new Set([
      {
        route: parentRoute,
        incoming: true,
        outgoing: false,
        count: 1,
        hiddenCount: 0,
      },
      {
        route: selectedRoute,
        incoming: false,
        outgoing: true,
        count: 3,
        hiddenCount: 0,
      },
    ]),
  )
  expect(result.omittedRelationCount).toBe(0)
  expect(result.relationCount).toBe(5)
  assertComplete(result, edges)

  const narrow = layoutCausalBuses(projection, 1)
  expect(
    narrow.routes.find((route) => route.anchor === 'selected')!.lane,
  ).toBeNull()
  expect(narrow.omittedRouteCount).toBe(1)
  expect(narrow.omittedRelationCount).toBe(3)
  expect(narrow.portals.get('selected')).toEqual({
    incoming: 0,
    outgoing: 3,
    routes: 1,
  })
  for (const effect of ['a', 'b', 'c'])
    expect(narrow.portals.get(effect)).toEqual({
      incoming: 1,
      outgoing: 0,
      routes: 1,
    })
  expect(crossingBusSummary(narrow, narrow.ranks.get('selected')!)).toEqual({
    routes: 1,
    relations: 3,
  })
  assertComplete(narrow, edges)
})

test('diamond and overlapping hubs partition each relationship once with deterministic ownership', () => {
  const order = ['root', 'left', 'right', 'join', 'a', 'b', 'c', 'd']
  const edges = [
    edge('root', 'left'),
    edge('root', 'right'),
    edge('left', 'join'),
    edge('right', 'join'),
    edge('root', 'a'),
    edge('root', 'b'),
    edge('left', 'a'),
    edge('left', 'b'),
    edge('right', 'a'),
    edge('right', 'b'),
    edge('a', 'c'),
    edge('b', 'c'),
    edge('c', 'd'),
  ]
  const result = layout(order, edges),
    reversed = layout(order, [...edges].reverse())
  assertComplete(result, edges)
  expect(
    result.routes.map((route) => [
      route.key,
      route.lane,
      route.edges.map((member) => member.key),
    ]),
  ).toEqual(
    reversed.routes.map((route) => [
      route.key,
      route.lane,
      route.edges.map((member) => member.key),
    ]),
  )
  for (const route of result.routes) {
    if (route.direction === 'causes')
      expect(route.edges.every((member) => member.to === route.anchor)).toBe(
        true,
      )
    if (route.direction === 'effects')
      expect(route.edges.every((member) => member.from === route.anchor)).toBe(
        true,
      )
  }
  for (const event of order) {
    expect(result.incoming.get(event)?.length ?? 0).toBe(
      edges.filter((relation) => relation.to === event).length,
    )
    expect(result.outgoing.get(event)?.length ?? 0).toBe(
      edges.filter((relation) => relation.from === event).length,
    )
  }
})

test('unrelated overlapping routes beyond the track budget retain exact endpoint portals and passing summaries', () => {
  const sources = Array.from({ length: 8 }, (_, index) => `source ${index}`),
    targets = sources.map((_, index) => `target ${index}`)
  const edges = sources.map((source, index) => edge(source, targets[index]!)),
    result = layout([...sources, ...targets], edges)
  expect(result.routes).toHaveLength(8)
  expect(result.laneCount).toBe(4)
  expect(result.omittedRouteCount).toBe(4)
  expect(result.omittedRelationCount).toBe(4)
  expect(crossingBuses(result, 7)).toHaveLength(4)
  expect(crossingBusSummary(result, 7)).toEqual({ routes: 4, relations: 4 })
  for (const route of result.routes) {
    if (route.lane === null) {
      expect(result.portals.get(route.edges[0]!.from)).toEqual({
        incoming: 0,
        outgoing: 1,
        routes: 1,
      })
      expect(result.portals.get(route.edges[0]!.to)).toEqual({
        incoming: 1,
        outgoing: 0,
        routes: 1,
      })
    }
  }
  assertComplete(result, edges)
})

test('an overflowing shared group is wholly summarized rather than sampled into available tracks', () => {
  const hubs = ['a', 'b', 'c', 'd', 'e'],
    children = hubs.flatMap((hub) =>
      Array.from({ length: 10 }, (_, index) => `${hub}:${index}`),
    )
  const edges = hubs.flatMap((hub) =>
    children
      .filter((child) => child.startsWith(`${hub}:`))
      .map((child) => edge(hub, child)),
  )
  const result = layout([...hubs, ...children], edges)
  expect(result.routes).toHaveLength(5)
  expect(result.omittedRouteCount).toBe(1)
  expect(result.omittedRelationCount).toBe(10)
  const omitted = result.routes.find((route) => route.lane === null)!
  expect(omitted.edges).toHaveLength(10)
  expect(result.portals.get(omitted.anchor)).toEqual({
    incoming: 0,
    outgoing: 10,
    routes: 1,
  })
  expect(result.branchesByEvent.get(omitted.anchor)).toBeUndefined()
  assertComplete(result, edges)
})

test('direct, bridged, cyclic and source namespaces never share a misleading normal bus', () => {
  const order = ['hub', 'a', 'b', 'c', 'd', 'e', 'f']
  const edges = [
    edge('hub', 'a'),
    edge('hub', 'b', ['h1']),
    edge('hub', 'c', ['h1', 'h2']),
    edge('hub', 'd', [], true),
    edge('hub', 'e'),
    edge('hub', 'f'),
  ]
  const sources = new Map(
    order.map((key) => [key, key === 'e' || key === 'f' ? 'remote' : 'local']),
  )
  const result = layoutCausalBuses(groupCausalBuses(order, edges, { sources }))
  expect(result.routes).toHaveLength(4)
  const bridge = result.routes.find((route) => route.hidden)!
  expect(bridge.edges).toHaveLength(2)
  expect(bridge.hiddenIds).toEqual(['h1', 'h2'])
  expect(
    result.branchesByEvent
      .get('hub')!
      .find((branch) => branch.route === bridge)!.hiddenCount,
  ).toBe(2)
  expect(result.branchesByEvent.get('b')![0]!.hiddenCount).toBe(1)
  expect(result.routes.find((route) => route.cyclic)!.edges).toEqual([edges[3]])
  expect(
    result.routes.find((route) => route.sourceKey === '["local","remote"]')!
      .edges,
  ).toHaveLength(2)
  assertComplete(result, edges)
})

test('hidden bridge unions and unresolved boundaries retain their canonical projection provenance', () => {
  const event = (key: string, causes: string[] = []): CausalEvent => ({
    key,
    ordinal: Number(key),
    record: {
      id: key,
      sourceId: 'local',
      traceId: 'trace',
      spanId: key,
      frameId: key,
      kind: 'span',
      name: key,
      start: Number(key),
      attributes: {},
      resource: {},
      links: [],
      causeIds: causes,
    },
  })
  const raw = buildCausalGraph([
    event('1'),
    event('2', ['1']),
    event('3', ['2']),
    event('4', ['1']),
    event('5', ['4']),
    event('6', ['missing']),
  ])
  const visible = new Set(['1', '3', '5', '6']),
    projected = projectCausalEdges(raw, visible, new Set(raw.order))
  const result = layoutCausalBuses(
    groupCausalBuses(
      raw.order.filter((key) => visible.has(key)),
      projected.edges,
      { boundaries: projected.boundaries },
    ),
  )
  expect(result.routes).toHaveLength(1)
  expect(result.routes[0]!.hiddenIds).toEqual(['2', '4'])
  expect(result.boundaries).toBe(projected.boundaries)
  expect(result.boundaries.get('6')).toEqual(['Unavailable cause missing'])
  for (const relation of projected.edges)
    expect(result.edgeByKey.get(relation.key)).toBe(relation)
})

test('crossing queries match complete route scans at endpoints and across offscreen windows', () => {
  const order = Array.from({ length: 100 }, (_, rank) => String(rank)),
    edges = Array.from({ length: 30 }, (_, index) =>
      edge(String(index), String(99 - index)),
    )
  const result = layout(order, edges, 3)
  for (let rank = -1; rank <= 100; rank++) {
    expect(
      new Set(crossingBuses(result, rank).map((route) => route.key)),
    ).toEqual(
      new Set(
        result.routes
          .filter(
            (route) =>
              route.lane !== null && route.start <= rank && route.end >= rank,
          )
          .map((route) => route.key),
      ),
    )
    const omitted = result.routes.filter(
      (route) =>
        route.lane === null && route.start <= rank && route.end >= rank,
    )
    expect(crossingBusSummary(result, rank)).toEqual({
      routes: omitted.length,
      relations: omitted.reduce((sum, route) => sum + route.edges.length, 0),
    })
  }
  expect(crossingBuses(result, 45, 55)).toHaveLength(3)
  expect(result.branchesByEvent.get('50')).toBeUndefined()
})

test('budget changes preserve groups and complete membership while retaining immutable prior layouts', () => {
  const order = ['a', 'b', 'c', 'd', 'e', 'f'],
    edges = [edge('a', 'd'), edge('b', 'e'), edge('c', 'f')]
  const projection = groupCausalBuses(order, edges),
    wide = layoutCausalBuses(projection, 4),
    before = JSON.stringify(wide)
  const narrow = layoutCausalBuses(projection, 1),
    portals = layoutCausalBuses(projection, 0)
  expect(JSON.stringify(wide)).toBe(before)
  expect(narrow.routes.map((route) => route.key)).toEqual(
    wide.routes.map((route) => route.key),
  )
  for (let index = 0; index < wide.routes.length; index++)
    expect(narrow.routes[index]!.edges).toBe(wide.routes[index]!.edges)
  expect(narrow.omittedRelationCount).toBe(2)
  expect(portals.laneCount).toBe(0)
  expect(portals.omittedRelationCount).toBe(edges.length)
  assertComplete(narrow, edges)
  assertComplete(portals, edges)
})
