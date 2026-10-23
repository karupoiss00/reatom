import type { CausalEdge } from './graph'

export type CausalBusDirection = 'causes' | 'effects' | 'edge'

/** An exact, disjoint set of projected relationships with one shared endpoint. */
export interface CausalBusGroup {
  key: string
  anchor: string
  direction: CausalBusDirection
  edges: readonly CausalEdge[]
  start: number
  end: number
  hidden: boolean
  cyclic: boolean
  /** JSON([source of causes, source of effects]); never a model-name family. */
  sourceKey: string
  hiddenIds: readonly string[]
}
export interface CausalBusRoute extends CausalBusGroup {
  /** Null means the complete group is represented by explicit count portals. */
  lane: number | null
}
export interface CausalBusBranch {
  route: CausalBusRoute
  incoming: boolean
  outgoing: boolean
  /** Number of this route's exact projected relations incident to this event. */
  count: number
  hiddenCount: number
}
export interface CausalBusPortal {
  incoming: number
  outgoing: number
  /** Distinct omitted route groups incident to this event. */
  routes: number
}
interface IncidentGroup {
  key: string
  incoming: boolean
  outgoing: boolean
  count: number
  hiddenCount: number
}
export interface CausalBusProjection {
  ranks: ReadonlyMap<string, number>
  groups: readonly CausalBusGroup[]
  incoming: ReadonlyMap<string, readonly CausalEdge[]>
  outgoing: ReadonlyMap<string, readonly CausalEdge[]>
  edgeByKey: ReadonlyMap<string, CausalEdge>
  incidents: ReadonlyMap<string, readonly IncidentGroup[]>
  boundaries: ReadonlyMap<string, readonly string[]>
  relationCount: number
}
interface BusIntervalNode {
  route: CausalBusRoute
  max: number
  left: BusIntervalNode | null
  right: BusIntervalNode | null
}
interface OmittedIndex {
  starts: readonly number[]
  ends: readonly number[]
  startRelations: readonly number[]
  endRelations: readonly number[]
}
export interface CausalBusLayout {
  ranks: ReadonlyMap<string, number>
  routes: readonly CausalBusRoute[]
  laneCount: number
  trackBudget: number
  incoming: ReadonlyMap<string, readonly CausalEdge[]>
  outgoing: ReadonlyMap<string, readonly CausalEdge[]>
  edgeByKey: ReadonlyMap<string, CausalEdge>
  routesByEvent: ReadonlyMap<string, readonly CausalBusRoute[]>
  /** Geometry branches only. Access is O(incident route output), not degree. */
  branchesByEvent: ReadonlyMap<string, readonly CausalBusBranch[]>
  portals: ReadonlyMap<string, CausalBusPortal>
  boundaries: ReadonlyMap<string, readonly string[]>
  omittedRouteCount: number
  omittedRelationCount: number
  relationCount: number
  tree: BusIntervalNode | null
  omittedIndex: OmittedIndex
}
export interface CausalBusOptions {
  sources?: ReadonlyMap<string, string>
  boundaries?: ReadonlyMap<string, readonly string[]>
}
const append = <T>(index: Map<string, T[]>, key: string, value: T) => {
  const bucket = index.get(key)
  if (bucket) bucket.push(value)
  else index.set(key, [value])
}
const compareKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Partition before routing. Largest shared-endpoint candidates claim unassigned
 * relationships deterministically; overlap belongs to exactly one group. A
 * residual group is still an exact star, never an arbitrary representative set.
 * Edge/candidate sorting is O(E log E). Grouping and adjacency construction
 * visit each relationship and its hidden IDs; each group's unique hidden-ID
 * union is sorted separately. Dense hidden provenance retains its input cost.
 */
export function groupCausalBuses(
  order: readonly string[],
  edges: readonly CausalEdge[],
  options: CausalBusOptions = {},
): CausalBusProjection {
  const ranks = new Map(order.map((key, rank) => [key, rank]))
  if (ranks.size !== order.length)
    throw new Error('Causal bus order contains duplicate events')
  const incoming = new Map<string, CausalEdge[]>(),
    outgoing = new Map<string, CausalEdge[]>(),
    edgeByKey = new Map<string, CausalEdge>()
  const candidates = new Map<
    string,
    {
      anchor: string
      direction: 'causes' | 'effects'
      signature: string
      edges: CausalEdge[]
    }
  >()
  const signatureOf = (edge: CausalEdge) =>
    JSON.stringify([
      options.sources?.get(edge.from) ?? '',
      options.sources?.get(edge.to) ?? '',
      edge.hidden.length > 0,
      edge.cyclic,
    ])
  const sortedEdges = [...edges].sort((a, b) => compareKey(a.key, b.key))
  for (const edge of sortedEdges) {
    if (!ranks.has(edge.from) || !ranks.has(edge.to))
      throw new Error(`Causal bus endpoint is not visible: ${edge.key}`)
    if (edgeByKey.has(edge.key))
      throw new Error(`Duplicate projected relationship: ${edge.key}`)
    if (edge.from === edge.to)
      throw new Error(
        `Self relationship must remain a diagnostic boundary: ${edge.key}`,
      )
    edgeByKey.set(edge.key, edge)
    append(incoming, edge.to, edge)
    append(outgoing, edge.from, edge)
    const signature = signatureOf(edge)
    for (const direction of ['causes', 'effects'] as const) {
      const anchor = direction === 'causes' ? edge.to : edge.from,
        key = JSON.stringify([anchor, direction, signature])
      const group = candidates.get(key)
      if (group) group.edges.push(edge)
      else candidates.set(key, { anchor, direction, signature, edges: [edge] })
    }
  }
  const assigned = new Set<string>(),
    groups: CausalBusGroup[] = [],
    incidents = new Map<string, IncidentGroup[]>()
  const addGroup = (
    anchor: string,
    direction: CausalBusDirection,
    members: readonly CausalEdge[],
    signature: string,
  ) => {
    const first = members[0]!,
      hidden = new Set<string>()
    let start = ranks.get(anchor)!,
      end = start
    const local = new Map<
      string,
      {
        incoming: boolean
        outgoing: boolean
        count: number
        hidden: Set<string>
      }
    >()
    const incident = (event: string, incoming: boolean, edge: CausalEdge) => {
      const entry = local.get(event) ?? {
        incoming: false,
        outgoing: false,
        count: 0,
        hidden: new Set<string>(),
      }
      if (incoming) entry.incoming = true
      else entry.outgoing = true
      entry.count++
      for (const id of edge.hidden) entry.hidden.add(id)
      local.set(event, entry)
    }
    for (const edge of members) {
      assigned.add(edge.key)
      start = Math.min(start, ranks.get(edge.from)!, ranks.get(edge.to)!)
      end = Math.max(end, ranks.get(edge.from)!, ranks.get(edge.to)!)
      for (const id of edge.hidden) hidden.add(id)
      incident(edge.from, false, edge)
      incident(edge.to, true, edge)
    }
    const group: CausalBusGroup = {
      key:
        direction === 'edge'
          ? JSON.stringify(['edge', first.key])
          : JSON.stringify(['bus', anchor, direction, signature]),
      anchor,
      direction,
      edges: members,
      start,
      end,
      hidden: first.hidden.length > 0,
      cyclic: first.cyclic,
      sourceKey: JSON.stringify([
        options.sources?.get(first.from) ?? '',
        options.sources?.get(first.to) ?? '',
      ]),
      hiddenIds: [...hidden].sort(compareKey),
    }
    groups.push(group)
    for (const [event, entry] of local)
      append(incidents, event, {
        key: group.key,
        incoming: entry.incoming,
        outgoing: entry.outgoing,
        count: entry.count,
        hiddenCount: entry.hidden.size,
      })
  }
  const ranked = [...candidates.values()]
    .filter((group) => group.edges.length > 1)
    .sort(
      (a, b) =>
        b.edges.length - a.edges.length ||
        ranks.get(a.anchor)! - ranks.get(b.anchor)! ||
        compareKey(a.anchor, b.anchor) ||
        compareKey(a.direction, b.direction) ||
        compareKey(a.signature, b.signature),
    )
  for (const group of ranked) {
    const members = group.edges.filter((edge) => !assigned.has(edge.key))
    if (members.length > 1)
      addGroup(group.anchor, group.direction, members, group.signature)
  }
  for (const edge of sortedEdges)
    if (!assigned.has(edge.key))
      addGroup(edge.from, 'edge', [edge], signatureOf(edge))
  groups.sort(
    (a, b) =>
      a.start - b.start ||
      b.edges.length - a.edges.length ||
      a.end - b.end ||
      compareKey(a.key, b.key),
  )
  return {
    ranks,
    groups,
    incoming,
    outgoing,
    edgeByKey,
    incidents,
    boundaries: options.boundaries ?? new Map(),
    relationCount: edges.length,
  }
}

const intervalTree = (
  routes: readonly CausalBusRoute[],
  start = 0,
  end = routes.length,
): BusIntervalNode | null => {
  if (start >= end) return null
  const middle = (start + end) >> 1,
    route = routes[middle]!,
    left = intervalTree(routes, start, middle),
    right = intervalTree(routes, middle + 1, end)
  return {
    route,
    left,
    right,
    max: Math.max(route.end, left?.max ?? -1, right?.max ?? -1),
  }
}

/**
 * Admit whole route groups to a fixed readable track budget, never per-edge
 * lanes. Selection and pixel widths are deliberately absent. Admission is O(R *
 * budget), incident indexes O(E), and the omitted-group prefix index O(R log
 * R). Every relation remains represented; a star has one trunk and W member
 * branches in a W-row window.
 */
export function layoutCausalBuses(
  projection: CausalBusProjection,
  trackBudget = 4,
): CausalBusLayout {
  if (!Number.isFinite(trackBudget) || trackBudget < 0)
    throw new Error(
      'Causal bus track budget must be a finite nonnegative number',
    )
  trackBudget = Math.floor(trackBudget)
  const ends = new Array<number>(trackBudget).fill(-Infinity),
    routes: CausalBusRoute[] = [],
    routeByKey = new Map<string, CausalBusRoute>()
  let laneCount = 0,
    omittedRouteCount = 0,
    omittedRelationCount = 0
  for (const group of projection.groups) {
    // Endpoints occupy their event row too. Reusing a touching route's track
    // would merge its incoming and outgoing taps into one apparent bus.
    const free = ends.findIndex((end) => end < group.start),
      lane = free < 0 ? null : free
    if (lane === null) {
      omittedRouteCount++
      omittedRelationCount += group.edges.length
    } else {
      ends[lane] = group.end
      laneCount = Math.max(laneCount, lane + 1)
    }
    const route = { ...group, lane }
    routes.push(route)
    routeByKey.set(route.key, route)
  }
  const routesByEvent = new Map<string, CausalBusRoute[]>(),
    branchesByEvent = new Map<string, CausalBusBranch[]>(),
    portals = new Map<string, CausalBusPortal>()
  for (const [event, entries] of projection.incidents)
    for (const entry of entries) {
      const route = routeByKey.get(entry.key)!
      append(routesByEvent, event, route)
      if (route.lane !== null)
        append(branchesByEvent, event, {
          route,
          incoming: entry.incoming,
          outgoing: entry.outgoing,
          count: entry.count,
          hiddenCount: entry.hiddenCount,
        })
      else {
        const portal = portals.get(event) ?? {
          incoming: 0,
          outgoing: 0,
          routes: 0,
        }
        if (entry.incoming) portal.incoming += entry.count
        if (entry.outgoing) portal.outgoing += entry.count
        portal.routes++
        portals.set(event, portal)
      }
    }
  const omitted = routes.filter((route) => route.lane === null),
    byEnd = [...omitted].sort(
      (a, b) => a.end - b.end || compareKey(a.key, b.key),
    )
  const prefix = (input: readonly CausalBusRoute[]) => {
    const sums = [0]
    for (const route of input) sums.push(sums.at(-1)! + route.edges.length)
    return sums
  }
  return {
    ranks: projection.ranks,
    routes,
    laneCount,
    trackBudget,
    incoming: projection.incoming,
    outgoing: projection.outgoing,
    edgeByKey: projection.edgeByKey,
    routesByEvent,
    branchesByEvent,
    portals,
    boundaries: projection.boundaries,
    omittedRouteCount,
    omittedRelationCount,
    relationCount: projection.relationCount,
    tree: intervalTree(routes.filter((route) => route.lane !== null)),
    omittedIndex: {
      starts: omitted.map((route) => route.start),
      ends: byEnd.map((route) => route.end),
      startRelations: prefix(omitted),
      endRelations: prefix(byEnd),
    },
  }
}

/** O(log R + returned trunks), including a window with both ends offscreen. */
export function crossingBuses(
  layout: CausalBusLayout,
  start: number,
  end = start,
): CausalBusRoute[] {
  const result: CausalBusRoute[] = [],
    stack = [layout.tree]
  while (stack.length) {
    const node = stack.pop()
    if (!node || node.max < start) continue
    if (node.left) stack.push(node.left)
    if (node.route.start <= end && node.route.end >= start)
      result.push(node.route)
    if (node.route.start <= end && node.right) stack.push(node.right)
  }
  return result
}
const upperBound = (
  values: readonly number[],
  value: number,
  inclusive: boolean,
) => {
  let low = 0,
    high = values.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (values[middle]! < value || (inclusive && values[middle] === value))
      low = middle + 1
    else high = middle
  }
  return low
}
/** Exact counts for omitted passing groups; relations count whole group members. */
export function crossingBusSummary(layout: CausalBusLayout, rank: number) {
  const index = layout.omittedIndex,
    starts = upperBound(index.starts, rank, true),
    ends = upperBound(index.ends, rank, false)
  return {
    routes: starts - ends,
    relations: index.startRelations[starts]! - index.endRelations[ends]!,
  }
}
