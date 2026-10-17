import {
  framedByFrameId,
  frameRecordKey,
  recordHasError,
  recordLabel,
  toRailNode,
  type OtlpRailNode,
} from './bind.ts'
import type { AdminRecord } from './ingest.ts'

export type CauseThread = {
  ancestorFrameIds: string[]
  ancestorRecordIds: string[]
  diamondFrameIds: string[]
  errorAncestorFrameId: string | undefined
  errorAncestorRecordId: string | undefined
  pathIds: number[]
}

export type CauseListRow = {
  record: AdminRecord
  name: string
  durationMs: number | undefined
  outcome: string
}

export type TimeNeighbor = CauseListRow & {
  offsetMs: number
  selected: boolean
}

function parentKeys(record: AdminRecord): string[] {
  const node = toRailNode(record)
  if (!node) return []
  return node.parentIds.map((parentId) =>
    frameRecordKey(record.traceId, String(parentId)),
  )
}

function childrenIndex(
  byFrame: Map<string, AdminRecord>,
): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const [key, record] of byFrame) {
    for (const parentKey of parentKeys(record)) {
      const list = children.get(parentKey)
      if (list) list.push(key)
      else children.set(parentKey, [key])
    }
  }
  return children
}

function rootKeyOf(
  record: AdminRecord,
  byFrame: Map<string, AdminRecord>,
): string | undefined {
  if (record.frameId === undefined) return undefined
  const key = frameRecordKey(record.traceId, record.frameId)
  return byFrame.has(key) ? key : undefined
}

export function collectAncestorRecords(
  record: AdminRecord,
  records: readonly AdminRecord[],
): AdminRecord[] {
  const scoped = records.filter((entry) => entry.traceId === record.traceId)
  const byFrame = framedByFrameId(scoped)
  const rootKey = rootKeyOf(record, byFrame)
  if (rootKey === undefined) return []
  const visited = new Set<string>()
  const found: AdminRecord[] = []
  const queue = parentKeys(record)
  while (queue.length > 0) {
    const key = queue.shift()!
    if (visited.has(key)) continue
    visited.add(key)
    const ancestor = byFrame.get(key)
    if (!ancestor) continue
    found.push(ancestor)
    queue.push(...parentKeys(ancestor))
  }
  return found
}

export function selectedCauseThread(
  records: readonly AdminRecord[],
  selected: AdminRecord | null,
): CauseThread {
  if (selected === null || selected.frameId === undefined) {
    return {
      ancestorFrameIds: [],
      ancestorRecordIds: [],
      diamondFrameIds: [],
      errorAncestorFrameId: undefined,
      errorAncestorRecordId: undefined,
      pathIds: [],
    }
  }
  const ancestors = collectAncestorRecords(selected, records)
  const ancestorFrameIds = ancestors.flatMap((entry) =>
    entry.frameId === undefined ? [] : [entry.frameId],
  )
  const ancestorRecordIds = ancestors.map((entry) => entry.id)
  const diamondFrameIds: string[] = []
  const selectedNode = toRailNode(selected)
  if (selectedNode !== undefined && selectedNode.parentIds.length > 1) {
    diamondFrameIds.push(selected.frameId)
  }
  for (const ancestor of ancestors) {
    const node = toRailNode(ancestor)
    if (ancestor.frameId && node && node.parentIds.length > 1) {
      diamondFrameIds.push(ancestor.frameId)
    }
  }
  let errorAncestorFrameId: string | undefined
  let errorAncestorRecordId: string | undefined
  if (recordHasError(selected) || selected.outcome === 'error') {
    const errorAncestors = ancestors.filter((entry) => recordHasError(entry))
    const earliest = errorAncestors.at(-1)
    errorAncestorFrameId = earliest?.frameId ?? selected.frameId
    errorAncestorRecordId = earliest?.id ?? selected.id
  }
  const pathIds = [
    ...ancestors
      .map((entry) => Number(entry.frameId))
      .filter((id) => Number.isFinite(id))
      .reverse(),
    Number(selected.frameId),
  ]
  return {
    ancestorFrameIds,
    ancestorRecordIds,
    diamondFrameIds,
    errorAncestorFrameId,
    errorAncestorRecordId,
    pathIds,
  }
}

function errorPathRecordIds(
  selected: AdminRecord,
  records: readonly AdminRecord[],
  errorAncestorRecordId: string | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (errorAncestorRecordId === undefined) return ids
  if (selected.id === errorAncestorRecordId) {
    ids.add(selected.id)
    return ids
  }
  const scoped = records.filter((entry) => entry.traceId === selected.traceId)
  const byFrame = framedByFrameId(scoped)
  const parentOf = new Map<string, string | null>()
  parentOf.set(selected.id, null)
  const queue = [selected]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const key of parentKeys(current)) {
      const parent = byFrame.get(key)
      if (!parent || parentOf.has(parent.id)) continue
      parentOf.set(parent.id, current.id)
      if (parent.id === errorAncestorRecordId) {
        let hop: string | null = parent.id
        while (hop !== null) {
          ids.add(hop)
          hop = parentOf.get(hop) ?? null
        }
        return ids
      }
      queue.push(parent)
    }
  }
  ids.add(selected.id)
  return ids
}

function listRow(record: AdminRecord): CauseListRow {
  return {
    record,
    name: recordLabel(record),
    durationMs:
      record.end === undefined ? undefined : Math.max(0, record.end - record.start),
    outcome: record.outcome ?? 'ok',
  }
}

export function causeReads(
  record: AdminRecord,
  records: readonly AdminRecord[],
): CauseListRow[] {
  const byFrame = framedByFrameId(
    records.filter((entry) => entry.traceId === record.traceId),
  )
  const rows: CauseListRow[] = []
  const seen = new Set<string>()
  for (const link of record.links) {
    if (link.reason !== 'computed.dependency' || !link.frameId) continue
    if (seen.has(link.frameId)) continue
    seen.add(link.frameId)
    const match = byFrame.get(frameRecordKey(record.traceId, link.frameId))
    if (match) rows.push(listRow(match))
  }
  return rows
}

export function causeTriggers(
  record: AdminRecord,
  records: readonly AdminRecord[],
): CauseListRow[] {
  if (record.frameId === undefined) return []
  const scoped = records.filter((entry) => entry.traceId === record.traceId)
  const byFrame = framedByFrameId(scoped)
  const children = childrenIndex(byFrame)
  const key = frameRecordKey(record.traceId, record.frameId)
  const rows: CauseListRow[] = []
  for (const childKey of children.get(key) ?? []) {
    const child = byFrame.get(childKey)
    if (child) rows.push(listRow(child))
  }
  return rows
}

export function timeNeighbors(
  record: AdminRecord,
  records: readonly AdminRecord[],
  limit = 5,
): TimeNeighbor[] {
  const trace = records
    .filter((entry) => entry.traceId === record.traceId)
    .slice()
    .sort((left, right) =>
      left.start === right.start
        ? left.id.localeCompare(right.id)
        : left.start - right.start,
    )
  const index = trace.findIndex((entry) => entry.id === record.id)
  if (index < 0) return []
  const start = Math.max(0, index - Math.floor(limit / 2))
  const window = trace.slice(start, start + limit)
  if (window.length < limit && start > 0) {
    return timeNeighborsWindow(record, trace.slice(Math.max(0, trace.length - limit)))
  }
  return timeNeighborsWindow(record, window)
}

function timeNeighborsWindow(
  record: AdminRecord,
  window: readonly AdminRecord[],
): TimeNeighbor[] {
  return window.map((entry) => ({
    ...listRow(entry),
    offsetMs: entry.start - record.start,
    selected: entry.id === record.id,
  }))
}

export function findCausePathIds(
  records: readonly AdminRecord[],
  fromFrameId: string,
  toFrameId: string,
  traceId?: string | null,
): number[] | null {
  if (traceId == null || traceId === '') return null
  const scoped = records.filter((entry) => entry.traceId === traceId)
  const byFrame = framedByFrameId(scoped)
  const children = childrenIndex(byFrame)
  const startKey = frameRecordKey(traceId, fromFrameId)
  const endKey = frameRecordKey(traceId, toFrameId)
  if (!byFrame.has(startKey) || !byFrame.has(endKey)) return null
  if (startKey === endKey) return [Number(fromFrameId)]

  const cameFrom = new Map<string, string | null>()
  cameFrom.set(startKey, null)
  const queue = [startKey]
  let head = 0
  while (head < queue.length) {
    const key = queue[head++]!
    const record = byFrame.get(key)
    if (!record) continue
    const nextKeys = [...parentKeys(record), ...(children.get(key) ?? [])]
    for (const nextKey of nextKeys) {
      if (cameFrom.has(nextKey) || !byFrame.has(nextKey)) continue
      cameFrom.set(nextKey, key)
      if (nextKey === endKey) {
        const path: number[] = []
        let current: string | null = endKey
        while (current !== null) {
          const node = byFrame.get(current)
          if (node?.frameId !== undefined) path.push(Number(node.frameId))
          current = cameFrom.get(current) ?? null
        }
        path.reverse()
        return path
      }
      queue.push(nextKey)
    }
  }
  return null
}

export type CauseThreadRowSpan = {
  lo: number
  hi: number
  errorLo: number
  errorHi: number
  threadIds: Set<string>
  errorPathIds: Set<string>
  diamondIds: Set<string>
  errorMarkId: string | undefined
  errorAncestorFrameId: string | undefined
  indexById: Map<string, number>
}

export function causeThreadRowSpan(
  rows: readonly AdminRecord[],
  selected: AdminRecord | null,
  thread: CauseThread,
  records: readonly AdminRecord[] = rows,
): CauseThreadRowSpan | null {
  if (selected === null || selected.frameId === undefined) return null
  const indexById = new Map<string, number>()
  for (let index = 0; index < rows.length; index++) {
    indexById.set(rows[index]!.id, index)
  }
  const threadIds = new Set<string>([selected.id, ...thread.ancestorRecordIds])
  const marks = [...threadIds]
    .map((id) => indexById.get(id) ?? -1)
    .filter((index) => index >= 0)
  if (marks.length === 0 && thread.diamondFrameIds.length === 0) return null
  const lo = marks.length === 0 ? -1 : Math.min(...marks)
  const hi = marks.length === 0 ? -1 : Math.max(...marks)
  const errorPathIds = errorPathRecordIds(
    selected,
    records,
    thread.errorAncestorRecordId,
  )
  const errorMarks = [...errorPathIds]
    .map((id) => indexById.get(id) ?? -1)
    .filter((index) => index >= 0)
  return {
    lo,
    hi,
    errorLo: errorMarks.length === 0 ? -1 : Math.min(...errorMarks),
    errorHi: errorMarks.length === 0 ? -1 : Math.max(...errorMarks),
    threadIds,
    errorPathIds,
    diamondIds: new Set(thread.diamondFrameIds),
    errorMarkId: thread.errorAncestorRecordId,
    errorAncestorFrameId: thread.errorAncestorFrameId,
    indexById,
  }
}

export function hopSet(
  nodes: readonly Pick<OtlpRailNode, 'id' | 'parentIds'>[],
  selectedId: number,
  hops: number,
): Set<number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<number, number[]>()
  for (const node of nodes) {
    for (const parentId of node.parentIds) {
      const list = children.get(parentId)
      if (list) list.push(node.id)
      else children.set(parentId, [node.id])
    }
  }
  const kept = new Set<number>([selectedId])
  let frontier = [selectedId]
  for (let depth = 0; depth < hops; depth += 1) {
    const next: number[] = []
    for (const id of frontier) {
      const node = byId.get(id)
      for (const parentId of node?.parentIds ?? []) {
        if (kept.has(parentId) || !byId.has(parentId)) continue
        kept.add(parentId)
        next.push(parentId)
      }
      for (const childId of children.get(id) ?? []) {
        if (kept.has(childId) || !byId.has(childId)) continue
        kept.add(childId)
        next.push(childId)
      }
    }
    frontier = next
  }
  return kept
}

export function focusKeepIds(
  nodes: readonly Pick<OtlpRailNode, 'id' | 'parentIds'>[],
  selectedId: number,
): Set<number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<number, number[]>()
  for (const node of nodes) {
    for (const parentId of node.parentIds) {
      const list = children.get(parentId)
      if (list) list.push(node.id)
      else children.set(parentId, [node.id])
    }
  }
  const walk = (start: number, next: (id: number) => number[]) => {
    const visited = new Set<number>()
    const queue = [start]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      for (const linked of next(id)) {
        if (byId.has(linked)) queue.push(linked)
      }
    }
    return visited
  }
  return new Set([
    ...walk(selectedId, (id) => byId.get(id)?.parentIds ?? []),
    ...walk(selectedId, (id) => children.get(id) ?? []),
  ])
}

export function writtenBySelection(
  records: readonly AdminRecord[],
  selected: AdminRecord | null,
): Set<string> {
  const names = new Set<string>()
  if (selected === null) return names
  const causeIds = new Set(selected.causeIds)
  if (selected.frameId) causeIds.add(selected.frameId)
  for (const record of records) {
    if (record.atomName === undefined) continue
    if (record.frameId !== undefined && causeIds.has(record.frameId)) {
      names.add(`${record.sourceId}:${record.atomName}`)
    }
  }
  return names
}
