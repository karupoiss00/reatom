import type { AdminRecord } from '../otlp/ingest'

export interface CausalEvent {
  key: string
  record: AdminRecord
  ordinal: number
}
export interface CausalEdge {
  key: string
  from: string
  to: string
  hidden: readonly string[]
  cyclic: boolean
}
export interface CausalGraph {
  events: ReadonlyMap<string, CausalEvent>
  parents: ReadonlyMap<string, readonly string[]>
  edges: readonly CausalEdge[]
  boundaries: ReadonlyMap<string, readonly string[]>
  order: readonly string[]
  cyclic: ReadonlySet<string>
  components: ReadonlyMap<string, number>
  identity: object
  tailOf?: object
  appended?: readonly string[]
  appendedEdges?: readonly CausalEdge[]
}

const frameKey = (source: string, trace: string, frame: string) =>
  JSON.stringify([source, trace, frame])
const spanKey = (trace: string, span: string) => JSON.stringify([trace, span])
const append = <T>(index: Map<string, T[]>, key: string, value: T) => {
  const bucket = index.get(key)
  if (bucket) bucket.push(value)
  else index.set(key, [value])
}

/** Complete-graph reference build. Times break ready-node ties, never causation. */
export function buildCausalGraph(input: readonly CausalEvent[]): CausalGraph {
  const events = new Map(input.map((event) => [event.key, event]))
  const frames = new Map<string, CausalEvent[]>(),
    spans = new Map<string, CausalEvent[]>(),
    linkedFrames = new Map<string, CausalEvent[]>()
  for (const event of input) {
    const record = event.record
    if (record.frameId !== undefined) {
      append(linkedFrames, frameKey('', record.traceId, record.frameId), event)
      append(
        frames,
        frameKey(record.sourceId, record.traceId, record.frameId),
        event,
      )
    }
    if (record.kind === 'span')
      append(spans, spanKey(record.traceId, record.spanId), event)
  }
  const parents = new Map<string, string[]>(),
    children = new Map<string, string[]>(),
    boundaries = new Map<string, string[]>()
  for (const event of input) {
    const record = event.record,
      found = new Set<string>(),
      missing = new Set<string>()
    const take = (
      candidates: readonly CausalEvent[] | undefined,
      description: string,
    ) => {
      if (candidates?.length === 1) {
        const parent = candidates[0]!
        if (parent.key === event.key) missing.add('Self-link')
        else found.add(parent.key)
      } else
        missing.add(
          candidates?.length
            ? `Ambiguous ${description}`
            : `Unavailable ${description}`,
        )
    }
    for (const id of record.causeIds) {
      const linked = record.links.find(
        (link) => link.reason === 'computed.dependency' && link.frameId === id,
      )
      if (linked) continue // The explicit link supplies the other trace's namespace.
      take(
        frames.get(frameKey(record.sourceId, record.traceId, id)),
        `cause ${id}`,
      )
    }
    for (const link of record.links) {
      if (link.reason !== 'computed.dependency') continue
      let candidates: CausalEvent[] | undefined
      if (link.frameId) {
        candidates = linkedFrames.get(frameKey('', link.traceId, link.frameId))
        // When both are supplied the span is a second identity proof.
        if (candidates && link.spanId)
          candidates = candidates.filter(
            (event) => event.record.spanId === link.spanId,
          )
      } else candidates = spans.get(spanKey(link.traceId, link.spanId))
      take(candidates, `dependency ${link.frameId ?? link.spanId}`)
    }
    parents.set(event.key, [...found])
    boundaries.set(event.key, [...missing])
    for (const parent of found) append(children, parent, event.key)
  }
  // Iterative Kosaraju avoids overflowing the JS stack on long captures.
  const visited = new Set<string>(),
    finish: string[] = []
  for (const key of events.keys()) {
    if (visited.has(key)) continue
    const stack: [string, boolean][] = [[key, false]]
    while (stack.length) {
      const [id, done] = stack.pop()!
      if (done) {
        finish.push(id)
        continue
      }
      if (visited.has(id)) continue
      visited.add(id)
      stack.push([id, true])
      for (const child of children.get(id) ?? [])
        if (!visited.has(child)) stack.push([child, false])
    }
  }
  const component = new Map<string, number>(),
    groups: string[][] = []
  for (let i = finish.length - 1; i >= 0; i--) {
    const key = finish[i]!
    if (component.has(key)) continue
    const group: string[] = [],
      id = groups.length,
      stack = [key]
    while (stack.length) {
      const node = stack.pop()!
      if (component.has(node)) continue
      component.set(node, id)
      group.push(node)
      for (const parent of parents.get(node) ?? [])
        if (!component.has(parent)) stack.push(parent)
    }
    groups.push(group)
  }
  const compare = (a: string, b: string) => {
    const left = events.get(a)!,
      right = events.get(b)!
    return (
      left.record.start - right.record.start ||
      left.ordinal - right.ordinal ||
      a.localeCompare(b)
    )
  }
  for (const group of groups) group.sort(compare)
  const indegree = new Array<number>(groups.length).fill(0),
    next = groups.map(() => new Set<number>())
  for (const [child, causes] of parents)
    for (const parent of causes) {
      const from = component.get(parent)!,
        to = component.get(child)!
      if (from !== to && !next[from]!.has(to)) {
        next[from]!.add(to)
        indegree[to] = indegree[to]! + 1
      }
    }
  // Binary heap for deterministic O(V log V) ready-set ordering.
  const heap: number[] = []
  const less = (a: number, b: number) =>
    compare(groups[a]![0]!, groups[b]![0]!) < 0
  const push = (value: number) => {
    heap.push(value)
    let i = heap.length - 1
    while (i) {
      const p = (i - 1) >> 1
      if (!less(heap[i]!, heap[p]!)) break
      ;[heap[i], heap[p]] = [heap[p]!, heap[i]!]
      i = p
    }
  }
  const pop = () => {
    const first = heap[0]!,
      tail = heap.pop()!
    if (heap.length) {
      heap[0] = tail
      let i = 0
      while (true) {
        let child = i * 2 + 1
        if (child >= heap.length) break
        if (child + 1 < heap.length && less(heap[child + 1]!, heap[child]!))
          child++
        if (!less(heap[child]!, heap[i]!)) break
        ;[heap[i], heap[child]] = [heap[child]!, heap[i]!]
        i = child
      }
    }
    return first
  }
  for (let i = 0; i < groups.length; i++) if (!indegree[i]) push(i)
  const order: string[] = [],
    cyclic = new Set<string>()
  while (heap.length) {
    const id = pop(),
      group = groups[id]!
    for (const key of group) order.push(key)
    if (group.length > 1) for (const key of group) cyclic.add(key)
    for (const child of next[id]!) {
      indegree[child] = indegree[child]! - 1
      if (indegree[child] === 0) push(child)
    }
  }
  const edges: CausalEdge[] = []
  for (const [to, causes] of parents)
    for (const from of causes)
      edges.push({
        key: JSON.stringify([from, to]),
        from,
        to,
        hidden: [],
        cyclic: component.get(from) === component.get(to) && cyclic.has(from),
      })
  return {
    events,
    parents,
    edges,
    boundaries,
    order,
    cyclic,
    components: component,
    identity: {},
  }
}

/**
 * Project all nearest visible causal predecessors, with exact unique hidden
 * IDs.
 */
export function projectCausalEdges(
  graph: CausalGraph,
  visible: ReadonlySet<string>,
  inScope: ReadonlySet<string>,
): { edges: CausalEdge[]; boundaries: Map<string, string[]> } {
  const edges: CausalEdge[] = [],
    boundaries = new Map<string, string[]>()
  for (const target of visible) {
    const missing = new Set(graph.boundaries.get(target) ?? [])
    const sources = new Set<string>(),
      direct = new Set<string>()
    const targetSource = graph.events.get(target)!.record.sourceId
    const visited = new Set<string>(),
      hidden = new Set<string>(),
      children = new Map<string, Set<string>>()
    const stack = (graph.parents.get(target) ?? []).map((key) => ({
      key,
      child: target,
    }))
    while (stack.length) {
      const { key, child } = stack.pop()!
      if (key === target) {
        missing.add('Cyclic cause')
        continue
      }
      if (visible.has(key)) {
        sources.add(key)
        if (child === target) direct.add(key)
        else {
          const bucket = children.get(key) ?? new Set<string>()
          bucket.add(child)
          children.set(key, bucket)
        }
        continue
      }
      const event = graph.events.get(key)
      if (
        !event ||
        !inScope.has(key) ||
        event.record.sourceId !== targetSource
      ) {
        missing.add('Cause outside source/scope')
        continue
      }
      if (child !== target) {
        const bucket = children.get(key) ?? new Set<string>()
        bucket.add(child)
        children.set(key, bucket)
      }
      if (visited.has(key)) continue
      visited.add(key)
      hidden.add(key)
      if (graph.cyclic.has(key)) missing.add('Cyclic hidden cause')
      for (const detail of graph.boundaries.get(key) ?? []) missing.add(detail)
      for (const parent of graph.parents.get(key) ?? [])
        stack.push({ key: parent, child: key })
    }
    // Materialize hidden IDs once per projected visible predecessor. A long
    // hidden chain uses linear storage, rather than copying its prefix at
    // every traversal step. Branch unions count each hidden event once.
    const descendants = (source: string, includeSource = false) => {
      const found = new Set<string>(),
        pending = includeSource ? [source] : [...(children.get(source) ?? [])]
      while (pending.length) {
        const key = pending.pop()!
        if (found.has(key)) continue
        found.add(key)
        for (const child of children.get(key) ?? []) pending.push(child)
      }
      return [...found].sort()
    }
    for (const key of hidden)
      if (!graph.parents.get(key)?.length) {
        const count = descendants(key, true).length
        missing.add(`${count} hidden cause${count === 1 ? '' : 's'}`)
      }
    for (const from of sources)
      edges.push({
        key: JSON.stringify([from, target]),
        from,
        to: target,
        hidden: direct.has(from) ? [] : descendants(from),
        cyclic:
          graph.cyclic.has(from) &&
          graph.components.get(from) === graph.components.get(target),
      })
    boundaries.set(target, [...missing])
  }
  return { edges, boundaries }
}

export interface RailInterval extends CausalEdge {
  lane: number
  start: number
  end: number
}
interface IntervalNode {
  edge: RailInterval
  max: number
  height: number
  left: IntervalNode | null
  right: IntervalNode | null
}
export interface CausalLanes {
  intervals: readonly RailInterval[]
  tree: IntervalNode | null
  laneCount: number
  ranks: ReadonlyMap<string, number>
  occupancy: readonly (LaneNode | null)[]
}
const intervalTree = (
  edges: RailInterval[],
  start = 0,
  end = edges.length,
): IntervalNode | null => {
  if (start >= end) return null
  const middle = (start + end) >> 1,
    left = intervalTree(edges, start, middle),
    right = intervalTree(edges, middle + 1, end),
    edge = edges[middle]!
  return {
    edge,
    left,
    right,
    max: Math.max(edge.end, left?.max ?? -1, right?.max ?? -1),
    height: 1 + Math.max(left?.height ?? 0, right?.height ?? 0),
  }
}
interface LaneNode {
  edge: RailInterval
  left: LaneNode | null
  right: LaneNode | null
  height: number
}
const height = (node: LaneNode | null) => node?.height ?? 0
const refresh = (node: LaneNode) => {
  node.height = 1 + Math.max(height(node.left), height(node.right))
  return node
}
const rotateLeft = (node: LaneNode) => {
  const root = { ...node.right! }
  node.right = root.left
  root.left = refresh(node)
  return refresh(root)
}
const rotateRight = (node: LaneNode) => {
  const root = { ...node.left! }
  node.left = root.right
  root.right = refresh(node)
  return refresh(root)
}
function insertLane(node: LaneNode | null, edge: RailInterval): LaneNode {
  if (!node) return { edge, left: null, right: null, height: 1 }
  node = { ...node }
  if (edge.start < node.edge.start) node.left = insertLane(node.left, edge)
  else node.right = insertLane(node.right, edge)
  refresh(node)
  if (height(node.left) - height(node.right) > 1) {
    if (edge.start >= node.left!.edge.start) node.left = rotateLeft(node.left!)
    return rotateRight(node)
  }
  if (height(node.right) - height(node.left) > 1) {
    if (edge.start < node.right!.edge.start)
      node.right = rotateRight(node.right!)
    return rotateLeft(node)
  }
  return node
}
function laneOverlaps(
  node: LaneNode | null,
  start: number,
  end: number,
): boolean {
  while (node) {
    if (start < node.edge.end && end > node.edge.start) return true
    node = end <= node.edge.start ? node.left : node.right
  }
  return false
}
/** Preserve valid edge lanes; reallocate only conflicts after a reorder/filter. */
export function layoutCausalLanes(
  order: readonly string[],
  edges: readonly CausalEdge[],
  previous?: CausalLanes,
): CausalLanes {
  const ranks = new Map(order.map((key, index) => [key, index]))
  const old = new Map(
    previous?.intervals.map((edge) => [edge.key, edge.lane]) ?? [],
  )
  const occupied: Array<LaneNode | null> = [],
    intervals: RailInterval[] = []
  for (const edge of [...edges].sort(
    (a, b) =>
      (old.has(b.key) ? 1 : 0) - (old.has(a.key) ? 1 : 0) ||
      a.key.localeCompare(b.key),
  )) {
    const a = ranks.get(edge.from),
      b = ranks.get(edge.to)
    if (a === undefined || b === undefined || a === b) continue
    const start = Math.min(a, b),
      end = Math.max(a, b)
    const fits = (lane: number) =>
      !laneOverlaps(occupied[lane] ?? null, start, end)
    let lane = old.get(edge.key) ?? 0
    if (!fits(lane)) {
      lane = 0
      while (!fits(lane)) lane++
    }
    const interval = { ...edge, start, end, lane }
    occupied[lane] = insertLane(occupied[lane] ?? null, interval)
    intervals.push(interval)
  }
  const sorted = [...intervals].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key),
  )
  return {
    intervals,
    tree: intervalTree(sorted),
    laneCount: Math.max(1, occupied.length),
    ranks,
    occupancy: occupied,
  }
}
/**
 * O(log E + returned geometry) interval query, including two offscreen
 * endpoints.
 */
export function crossingRails(
  lanes: CausalLanes,
  start: number,
  end = start,
): RailInterval[] {
  const result: RailInterval[] = [],
    stack = [lanes.tree]
  while (stack.length) {
    const node = stack.pop()
    if (!node || node.max < start) continue
    if (node.left) stack.push(node.left)
    if (node.edge.start <= end && node.edge.end >= start) result.push(node.edge)
    if (node.edge.start <= end && node.right) stack.push(node.right)
  }
  return result
}

/** Identity indexes retained between chunks; used only to certify safe appends. */
export function causalAppendIndex(graph: CausalGraph) {
  const frames = new Map<string, CausalEvent[]>(),
    linkedFrames = new Map<string, CausalEvent[]>(),
    spans = new Map<string, CausalEvent[]>()
  for (const event of graph.events.values()) {
    const r = event.record
    if (r.frameId !== undefined) {
      append(frames, frameKey(r.sourceId, r.traceId, r.frameId), event)
      append(linkedFrames, frameKey('', r.traceId, r.frameId), event)
    }
    if (r.kind === 'span') append(spans, spanKey(r.traceId, r.spanId), event)
  }
  return {
    frames,
    linkedFrames,
    spans,
    unresolved: [...graph.boundaries.values()].some(
      (items) => items.length > 0,
    ),
  }
}
export type CausalAppendIndex = ReturnType<typeof causalAppendIndex>

/**
 * Certify timestamp-monotone, unambiguous DAG tails. Late identities, pending
 * endpoints, edits and skew use the complete reconciliation instead. Semantic
 * snapshot maps/arrays are copied, so this avoids graph traversal/SCC/sorting,
 * not O(V+E) snapshot publication costs.
 */
export function appendCausalGraph(
  graph: CausalGraph,
  input: readonly CausalEvent[],
  index: CausalAppendIndex,
): CausalGraph | null {
  if (graph.cyclic.size || index.unresolved) return null
  const extraFrames = new Map<string, CausalEvent[]>(),
    extraLinked = new Map<string, CausalEvent[]>(),
    extraSpans = new Map<string, CausalEvent[]>()
  let last = graph.order.length
    ? graph.events.get(graph.order.at(-1)!)
    : undefined
  const parents = new Map<string, string[]>(),
    edges: CausalEdge[] = []
  const resolve = (
    base: Map<string, CausalEvent[]>,
    extra: Map<string, CausalEvent[]>,
    key: string,
  ) => [...(base.get(key) ?? []), ...(extra.get(key) ?? [])]
  for (const event of input) {
    const r = event.record
    if (
      graph.events.has(event.key) ||
      (last &&
        (r.start < last.record.start ||
          (r.start === last.record.start && event.ordinal < last.ordinal)))
    )
      return null
    const found = new Set<string>()
    for (const id of r.causeIds) {
      if (
        r.links.some(
          (link) =>
            link.reason === 'computed.dependency' && link.frameId === id,
        )
      )
        continue
      const candidates = resolve(
        index.frames,
        extraFrames,
        frameKey(r.sourceId, r.traceId, id),
      )
      if (candidates.length !== 1) return null
      found.add(candidates[0]!.key)
    }
    for (const link of r.links) {
      if (link.reason !== 'computed.dependency') continue
      let candidates = link.frameId
        ? resolve(
            index.linkedFrames,
            extraLinked,
            frameKey('', link.traceId, link.frameId),
          )
        : resolve(index.spans, extraSpans, spanKey(link.traceId, link.spanId))
      if (link.frameId && link.spanId)
        candidates = candidates.filter((e) => e.record.spanId === link.spanId)
      if (candidates.length !== 1) return null
      found.add(candidates[0]!.key)
    }
    if (r.frameId !== undefined) {
      const key = frameKey(r.sourceId, r.traceId, r.frameId),
        linked = frameKey('', r.traceId, r.frameId)
      // A new duplicate could invalidate an earlier endpoint resolution.
      if (
        index.frames.has(key) ||
        extraFrames.has(key) ||
        index.linkedFrames.has(linked) ||
        extraLinked.has(linked)
      )
        return null
      append(extraFrames, key, event)
      append(extraLinked, linked, event)
    }
    if (r.kind === 'span') {
      const key = spanKey(r.traceId, r.spanId)
      if (index.spans.has(key) || extraSpans.has(key)) return null
      append(extraSpans, key, event)
    }
    parents.set(event.key, [...found])
    for (const from of found)
      edges.push({
        key: JSON.stringify([from, event.key]),
        from,
        to: event.key,
        hidden: [],
        cyclic: false,
      })
    last = event
  }
  for (const [key, bucket] of extraFrames) index.frames.set(key, bucket)
  for (const [key, bucket] of extraLinked) index.linkedFrames.set(key, bucket)
  for (const [key, bucket] of extraSpans) index.spans.set(key, bucket)
  return {
    events: new Map([
      ...graph.events,
      ...input.map((event) => [event.key, event] as const),
    ]),
    parents: new Map([...graph.parents, ...parents]),
    boundaries: new Map([
      ...graph.boundaries,
      ...input.map((event) => [event.key, []] as const),
    ]),
    edges: [...graph.edges, ...edges],
    order: [...graph.order, ...input.map((event) => event.key)],
    cyclic: graph.cyclic,
    components: new Map([
      ...graph.components,
      ...input.map(
        (event, offset) => [event.key, graph.events.size + offset] as const,
      ),
    ]),
    identity: {},
    tailOf: graph.identity,
    appended: input.map((event) => event.key),
    appendedEdges: edges,
  }
}

// Copy-on-write augmented AVL paths retain prior semantic lane snapshots.
const refreshInterval = (node: IntervalNode): IntervalNode => ({
  ...node,
  height: 1 + Math.max(node.left?.height ?? 0, node.right?.height ?? 0),
  max: Math.max(node.edge.end, node.left?.max ?? -1, node.right?.max ?? -1),
})
const rotateIntervalLeft = (node: IntervalNode): IntervalNode => {
  const root = node.right!
  return refreshInterval({
    ...root,
    left: refreshInterval({ ...node, right: root.left }),
  })
}
const rotateIntervalRight = (node: IntervalNode): IntervalNode => {
  const root = node.left!
  return refreshInterval({
    ...root,
    right: refreshInterval({ ...node, left: root.right }),
  })
}
const compareInterval = (a: RailInterval, b: RailInterval) =>
  a.start - b.start || a.end - b.end || a.key.localeCompare(b.key)
function insertInterval(
  node: IntervalNode | null,
  edge: RailInterval,
): IntervalNode {
  if (!node) return { edge, left: null, right: null, max: edge.end, height: 1 }
  let result = refreshInterval(
    compareInterval(edge, node.edge) < 0
      ? { ...node, left: insertInterval(node.left, edge) }
      : { ...node, right: insertInterval(node.right, edge) },
  )
  if ((result.left?.height ?? 0) - (result.right?.height ?? 0) > 1) {
    if (compareInterval(edge, result.left!.edge) >= 0)
      result = { ...result, left: rotateIntervalLeft(result.left!) }
    return rotateIntervalRight(result)
  }
  if ((result.right?.height ?? 0) - (result.left?.height ?? 0) > 1) {
    if (compareInterval(edge, result.right!.edge) < 0)
      result = { ...result, right: rotateIntervalRight(result.right!) }
    return rotateIntervalLeft(result)
  }
  return result
}

/** Certified tail geometry: retain existing lanes and index only new edges. */
export function appendCausalLanes(
  previous: CausalLanes,
  keys: readonly string[],
  edges: readonly CausalEdge[],
): CausalLanes {
  const ranks = new Map(previous.ranks),
    occupancy = [...previous.occupancy],
    added: RailInterval[] = []
  for (const key of keys) ranks.set(key, ranks.size)
  let tree = previous.tree
  for (const edge of [...edges].sort((a, b) => a.key.localeCompare(b.key))) {
    const a = ranks.get(edge.from),
      b = ranks.get(edge.to)
    if (a === undefined || b === undefined || a === b) continue
    const start = Math.min(a, b),
      end = Math.max(a, b)
    let lane = 0
    while (laneOverlaps(occupancy[lane] ?? null, start, end)) lane++
    const interval = { ...edge, start, end, lane }
    occupancy[lane] = insertLane(occupancy[lane] ?? null, interval)
    tree = insertInterval(tree, interval)
    added.push(interval)
  }
  return {
    ranks,
    occupancy,
    tree,
    intervals: [...previous.intervals, ...added],
    laneCount: Math.max(1, occupancy.length),
  }
}
