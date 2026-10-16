import { MAX_RAIL_LANES } from './tokens'

export interface RailInputNode {
  id: number
  label: string
  kind: string
  timestamp: number
  parentIds: Array<number>
  hasError: boolean
}

export type RailRelation = 'cause' | 'selected' | 'effect' | 'related'

export interface RailLayoutNode extends RailInputNode {
  lane: number
  row: number
  relation: RailRelation
  isSelected: boolean
  isOnPath: boolean
}

/**
 * `straight` stays in one lane. `branch` leaves the parent lane right below the
 * parent and runs down the child lane. `merge` runs down the parent lane and
 * joins the child lane right above the child: second parents and siblings that
 * sit before the child continuing the parent lane both use it.
 */
export type RailEdgeShape = 'straight' | 'branch' | 'merge'

export interface RailLayoutEdge {
  fromId: number
  toId: number
  fromLane: number
  toLane: number
  fromRow: number
  toRow: number
  shape: RailEdgeShape
  relation: RailRelation
  isOnPath: boolean
}

export interface RailLayout {
  /** Rows go from the oldest cause at row 0 to the newest effect. */
  nodes: Array<RailLayoutNode>
  edges: Array<RailLayoutEdge>
  laneCount: number
  selectedPathIds: Array<number>
  /** Connected nodes that did not fit into `MAX_RAIL_LANES`. */
  hiddenCount: number
}

function compareRailNodes(left: RailInputNode, right: RailInputNode): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp
  }
  return left.id - right.id
}

function childrenIndex(
  nodes: Array<RailInputNode>,
  byId: Map<number, RailInputNode>,
): Map<number, Array<number>> {
  const children = new Map<number, Array<number>>()
  for (const node of nodes) {
    for (const parentId of node.parentIds) {
      if (!byId.has(parentId)) continue
      const list = children.get(parentId) ?? []
      list.push(node.id)
      children.set(parentId, list)
    }
  }
  return children
}

function walk(
  startId: number,
  next: (id: number) => Array<number>,
): Set<number> {
  const visited = new Set<number>()
  const queue = [startId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    if (visited.has(currentId)) continue
    visited.add(currentId)
    queue.push(...next(currentId))
  }
  return visited
}

/** Kahn's order: parents always come before children, then by time and id. */
function causalOrder(nodes: Array<RailInputNode>): Array<RailInputNode> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pendingParents = new Map(
    nodes.map((node) => [
      node.id,
      new Set(node.parentIds.filter((parentId) => byId.has(parentId))).size,
    ]),
  )
  const children = childrenIndex(nodes, byId)
  const ready = nodes.filter((node) => pendingParents.get(node.id) === 0)
  const ordered: Array<RailInputNode> = []
  const placedIds = new Set<number>()

  while (ready.length > 0) {
    ready.sort(compareRailNodes)
    const node = ready.shift()!
    ordered.push(node)
    placedIds.add(node.id)
    for (const childId of new Set(children.get(node.id) ?? [])) {
      const remaining = (pendingParents.get(childId) ?? 0) - 1
      pendingParents.set(childId, remaining)
      if (remaining === 0) ready.push(byId.get(childId)!)
    }
  }

  const cyclic = nodes.filter((node) => !placedIds.has(node.id))
  return [...ordered, ...cyclic.sort(compareRailNodes)]
}

function shortestPathFromRoot(
  byId: Map<number, RailInputNode>,
  selectedId: number,
): Array<number> {
  if (!byId.has(selectedId)) return []
  const childOnPath = new Map<number, number>()
  const visited = new Set<number>([selectedId])
  const queue = [selectedId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    const parentIds = byId
      .get(currentId)!
      .parentIds.filter((parentId) => byId.has(parentId))
    if (parentIds.length === 0) {
      const path = [currentId]
      let cursor = childOnPath.get(currentId)
      while (cursor !== undefined) {
        path.push(cursor)
        cursor = childOnPath.get(cursor)
      }
      return path
    }
    for (const parentId of parentIds) {
      if (visited.has(parentId)) continue
      visited.add(parentId)
      childOnPath.set(parentId, currentId)
      queue.push(parentId)
    }
  }
  return [selectedId]
}

function isParentChain(
  byId: Map<number, RailInputNode>,
  ids: Array<number>,
): boolean {
  return ids.every((id, index) => {
    const node = byId.get(id)
    if (!node) return false
    if (index === 0) return true
    return node.parentIds.includes(ids[index - 1]!)
  })
}

interface LanePlacement {
  laneById: Map<number, number>
  primaryParentById: Map<number, number>
  branchIds: Set<number>
  overflowIds: Array<number>
}

function placeLanes(
  ordered: Array<RailInputNode>,
  trunkIds: Array<number>,
): LanePlacement {
  const byId = new Map(ordered.map((node) => [node.id, node]))
  const rowById = new Map(ordered.map((node, row) => [node.id, row]))
  const children = childrenIndex(ordered, byId)
  const trunkNextById = new Map(
    trunkIds.slice(1).map((id, index) => [trunkIds[index]!, id]),
  )
  const trunkSet = new Set(trunkIds)

  const primaryParentById = new Map<number, number>()
  for (const node of ordered) {
    const parentIds = node.parentIds.filter((parentId) => byId.has(parentId))
    if (parentIds.length === 0) continue
    const trunkIndex = trunkIds.indexOf(node.id)
    const trunkParent = trunkIndex > 0 ? trunkIds[trunkIndex - 1] : undefined
    const latestParent = parentIds.reduce((latest, parentId) =>
      rowById.get(parentId)! > rowById.get(latest)! ? parentId : latest,
    )
    primaryParentById.set(node.id, trunkParent ?? latestParent)
  }

  const heirById = new Map<number, number>()
  const reservedEndById = new Map<number, number>()
  for (const node of ordered) {
    const row = rowById.get(node.id)!
    const childIds = children.get(node.id) ?? []
    const primaryChildIds = childIds.filter(
      (childId) => primaryParentById.get(childId) === node.id,
    )
    const heirId =
      trunkNextById.get(node.id) ??
      primaryChildIds
        .filter((childId) => !trunkSet.has(childId))
        .sort((left, right) => rowById.get(right)! - rowById.get(left)!)[0]
    if (heirId !== undefined) heirById.set(node.id, heirId)

    const mergeRows = childIds
      .filter((childId) => primaryParentById.get(childId) !== node.id)
      .map((childId) => rowById.get(childId)!)
    const heirRow = heirId === undefined ? row : rowById.get(heirId)!
    reservedEndById.set(node.id, Math.max(row, heirRow, ...mergeRows))
  }

  const trunkStartRow =
    trunkIds.length > 0 ? rowById.get(trunkIds[0]!)! : Number.POSITIVE_INFINITY
  const laneEnd: Array<number> = []
  const laneTip: Array<number> = []
  const laneById = new Map<number, number>()
  const branchIds = new Set<number>()
  const overflowIds: Array<number> = []

  const claim = (lane: number, nodeId: number) => {
    laneById.set(nodeId, lane)
    laneTip[lane] = nodeId
    laneEnd[lane] = reservedEndById.get(nodeId)!
  }

  for (const node of ordered) {
    const row = rowById.get(node.id)!
    const primaryParentId = primaryParentById.get(node.id)
    const parentLane =
      primaryParentId === undefined ? undefined : laneById.get(primaryParentId)

    if (
      primaryParentId !== undefined &&
      parentLane !== undefined &&
      heirById.get(primaryParentId) === node.id &&
      laneTip[parentLane] === primaryParentId
    ) {
      claim(parentLane, node.id)
      continue
    }

    if (node.id === trunkIds[0]) {
      claim(0, node.id)
      continue
    }

    const hasPlacedParent = parentLane !== undefined
    const heirId =
      primaryParentId === undefined ? undefined : heirById.get(primaryParentId)
    const peelsOffParentLane =
      hasPlacedParent && heirId !== undefined && row < rowById.get(heirId)!
    const startRow = !hasPlacedParent
      ? row
      : peelsOffParentLane
        ? row - 1
        : rowById.get(primaryParentId!)!
    if (hasPlacedParent && !peelsOffParentLane) branchIds.add(node.id)
    const endRow = reservedEndById.get(node.id)!
    let freeLane = -1
    for (let lane = 0; lane < MAX_RAIL_LANES; lane++) {
      const previousEnd = laneEnd[lane] ?? Number.NEGATIVE_INFINITY
      const isFree = hasPlacedParent
        ? previousEnd <= startRow
        : previousEnd < startRow
      const blocksTrunk =
        lane === 0 && row < trunkStartRow && endRow >= trunkStartRow
      if (isFree && !blocksTrunk) {
        freeLane = lane
        break
      }
    }
    if (freeLane < 0) {
      overflowIds.push(node.id)
      continue
    }
    claim(freeLane, node.id)
  }

  return { laneById, primaryParentById, branchIds, overflowIds }
}

function connectedIds(
  nodes: Array<RailInputNode>,
  selectedId: number,
): Set<number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (!byId.has(selectedId)) return new Set()
  const children = childrenIndex(nodes, byId)
  return walk(selectedId, (id) => [
    ...byId.get(id)!.parentIds.filter((parentId) => byId.has(parentId)),
    ...(children.get(id) ?? []),
  ])
}

function edgeRelation(from: RailRelation, to: RailRelation): RailRelation {
  if (from === 'cause' && (to === 'cause' || to === 'selected')) return 'cause'
  if ((from === 'selected' || from === 'effect') && to === 'effect') {
    return 'effect'
  }
  return 'related'
}

export function layoutRailGraph(
  nodes: Array<RailInputNode>,
  selectedId: number,
  pathIds?: Array<number>,
): RailLayout {
  const connected = connectedIds(nodes, selectedId)
  const uniqueNodes = new Map<number, RailInputNode>()
  for (const node of nodes) {
    if (connected.has(node.id) && !uniqueNodes.has(node.id)) {
      uniqueNodes.set(node.id, node)
    }
  }
  const allNodes = [...uniqueNodes.values()]
  const byId = new Map(allNodes.map((node) => [node.id, node]))
  const children = childrenIndex(allNodes, byId)
  const causeIds = walk(selectedId, (id) =>
    (byId.get(id)?.parentIds ?? []).filter((parentId) => byId.has(parentId)),
  )
  const effectIds = walk(selectedId, (id) => children.get(id) ?? [])

  const callerPath =
    pathIds && pathIds.length > 0 && isParentChain(byId, pathIds)
      ? pathIds
      : undefined
  const selectedPathIds = callerPath ?? shortestPathFromRoot(byId, selectedId)

  let visibleNodes = allNodes
  let placement = placeLanes(causalOrder(visibleNodes), selectedPathIds)
  while (placement.overflowIds.length > 0) {
    const overflow = new Set(placement.overflowIds)
    visibleNodes = visibleNodes.filter((node) => !overflow.has(node.id))
    placement = placeLanes(causalOrder(visibleNodes), selectedPathIds)
  }

  const ordered = causalOrder(visibleNodes)
  const pathSet = new Set(selectedPathIds)
  const layoutNodes: Array<RailLayoutNode> = ordered.map((node, row) => ({
    ...node,
    lane: placement.laneById.get(node.id) ?? 0,
    row,
    relation:
      node.id === selectedId
        ? 'selected'
        : causeIds.has(node.id)
          ? 'cause'
          : effectIds.has(node.id)
            ? 'effect'
            : 'related',
    isSelected: node.id === selectedId,
    isOnPath: pathSet.has(node.id),
  }))

  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]))
  const pathEdgeKeys = new Set(
    selectedPathIds
      .slice(1)
      .map((id, index) => `${selectedPathIds[index]}>${id}`),
  )
  const edges: Array<RailLayoutEdge> = []
  for (const child of layoutNodes) {
    for (const parentId of new Set(child.parentIds)) {
      const parent = layoutById.get(parentId)
      if (!parent) continue
      const isPrimary = placement.primaryParentById.get(child.id) === parentId
      const branchesAtParent = isPrimary && placement.branchIds.has(child.id)
      const shape: RailEdgeShape =
        parent.lane === child.lane
          ? 'straight'
          : branchesAtParent
            ? 'branch'
            : 'merge'
      edges.push({
        fromId: parent.id,
        toId: child.id,
        fromLane: parent.lane,
        toLane: child.lane,
        fromRow: parent.row,
        toRow: child.row,
        shape,
        relation: edgeRelation(parent.relation, child.relation),
        isOnPath: pathEdgeKeys.has(`${parent.id}>${child.id}`),
      })
    }
  }

  const laneCount = Math.max(1, ...layoutNodes.map((node) => node.lane + 1))

  return {
    nodes: layoutNodes,
    edges,
    laneCount,
    selectedPathIds,
    hiddenCount: allNodes.length - visibleNodes.length,
  }
}
