import type { AdminRecord } from './ingest.ts'
import { recordValues } from './values.ts'

export const FEED_RENDER_LIMIT = 200

export type OtlpGraphDirection = 'ancestors' | 'descendants' | 'full'

export interface OtlpRailNode {
  id: number
  label: string
  kind: 'action' | 'state'
  timestamp: number
  parentIds: Array<number>
  hasError: boolean
}

export interface OtlpActivityRow {
  record: AdminRecord
  time: number
  label: string
  showActionBadge: boolean
  showErrorBadge: boolean
  value: unknown
}

export interface OtlpStateNode {
  id: string
  kind: 'group' | 'atom'
  label: string
  path: string
  atomName?: string
  sourceId?: string
  recordId?: string
  frameId?: string
  value?: unknown
  children: Array<OtlpStateNode>
}

export interface OtlpTimeBucket {
  start: number
  end: number
  entries: Array<AdminRecord>
  errorCount: number
  actionCount: number
  stateCount: number
}

export interface OtlpRecordGroup {
  timestamp: number
  records: Array<AdminRecord>
}

const UPDATE_EVENTS = new Set(['reatom.atom.update', 'reatom.computed.update'])
const STATE_KINDS = new Set(['atom', 'computed'])
const MIN_BUCKET_SIZE_MS = 50
const MAX_BUCKET_SIZE_MS = 2000
const TARGET_BURST_COUNT = 10
export const MAX_BUCKET_COUNT = 200

export function recordHasError(record: AdminRecord): boolean {
  return record.error != null || record.outcome === 'error'
}

export function recordLabel(record: AdminRecord): string {
  return record.atomName ?? record.name
}

export function recordShowsActionBadge(record: AdminRecord): boolean {
  return record.reatomKind === 'action' || record.kind === 'span'
}

export function recordValuePreview(record: AdminRecord): unknown {
  const values = recordValues(record)
  if (values.source === 'local') {
    if (values.state !== undefined) return values.state
    if (values.payload !== undefined) return values.payload
    if (values.params !== undefined) return values.params
    return record.eventName ?? record.outcome
  }
  if (record.body !== undefined) return record.body
  if (values.payload !== undefined) return values.payload
  if (values.params !== undefined) return values.params
  return record.eventName ?? record.outcome
}

export function toActivityRow(record: AdminRecord): OtlpActivityRow {
  return {
    record,
    time: record.start,
    label: recordLabel(record),
    showActionBadge: recordShowsActionBadge(record),
    showErrorBadge: recordHasError(record),
    value: recordValuePreview(record),
  }
}

export function visibleFeed(
  records: readonly AdminRecord[],
  limit: number = FEED_RENDER_LIMIT,
): AdminRecord[] {
  if (records.length <= limit) return [...records]
  return records.slice(-limit)
}

export function frameRecordKey(traceId: string, frameId: string): string {
  return `${traceId}:${frameId}`
}

export function toRailNode(record: AdminRecord): OtlpRailNode | undefined {
  if (record.frameId === undefined) return undefined
  const id = Number(record.frameId)
  if (!Number.isFinite(id)) return undefined
  const parentIds = record.causeIds
    .map((causeId) => Number(causeId))
    .filter((n) => Number.isFinite(n))
  for (const link of record.links) {
    if (link.reason === 'computed.dependency' && link.frameId) {
      const linked = Number(link.frameId)
      if (Number.isFinite(linked)) parentIds.push(linked)
    }
  }
  return {
    id,
    label: recordLabel(record),
    kind: record.reatomKind === 'action' ? 'action' : 'state',
    timestamp: record.start,
    parentIds,
    hasError: recordHasError(record),
  }
}

export function framedByFrameId(
  records: readonly AdminRecord[],
): Map<string, AdminRecord> {
  const byFrame = new Map<string, AdminRecord>()
  for (const record of records) {
    if (record.frameId === undefined) continue
    if (!toRailNode(record)) continue
    const key = frameRecordKey(record.traceId, record.frameId)
    const existing = byFrame.get(key)
    if (!existing || (existing.kind === 'log' && record.kind === 'span')) {
      byFrame.set(key, record)
    }
  }
  return byFrame
}

export function railNodesFromRecords(
  records: readonly AdminRecord[],
): OtlpRailNode[] {
  const nodes: OtlpRailNode[] = []
  for (const record of framedByFrameId(records).values()) {
    const node = toRailNode(record)
    if (node) nodes.push(node)
  }
  return nodes.sort((left, right) =>
    left.timestamp === right.timestamp
      ? left.id - right.id
      : left.timestamp - right.timestamp,
  )
}

function parentKeysOf(record: AdminRecord): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  const push = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    keys.push(key)
  }
  for (const causeId of record.causeIds) {
    if (!Number.isFinite(Number(causeId))) continue
    push(frameRecordKey(record.traceId, causeId))
  }
  for (const link of record.links) {
    if (link.reason !== 'computed.dependency' || !link.frameId) continue
    if (!Number.isFinite(Number(link.frameId))) continue
    push(frameRecordKey(link.traceId, link.frameId))
  }
  return keys
}

function childrenIndex(
  byFrame: Map<string, AdminRecord>,
): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const [key, record] of byFrame) {
    for (const parentKey of parentKeysOf(record)) {
      const list = children.get(parentKey)
      if (list) list.push(key)
      else children.set(parentKey, [key])
    }
  }
  return children
}

function collectAncestors(
  rootKey: string,
  byFrame: Map<string, AdminRecord>,
): Set<string> {
  const visited = new Set<string>()
  const queue = [rootKey]
  while (queue.length > 0) {
    const key = queue.shift()!
    if (visited.has(key)) continue
    visited.add(key)
    const record = byFrame.get(key)
    if (!record) continue
    for (const parentKey of parentKeysOf(record)) {
      if (!visited.has(parentKey)) queue.push(parentKey)
    }
  }
  return visited
}

function collectDescendants(
  rootKey: string,
  byFrame: Map<string, AdminRecord>,
): Set<string> {
  const children = childrenIndex(byFrame)
  const visited = new Set<string>()
  const queue = [rootKey]
  while (queue.length > 0) {
    const key = queue.shift()!
    if (visited.has(key)) continue
    visited.add(key)
    for (const childKey of children.get(key) ?? []) {
      if (!visited.has(childKey)) queue.push(childKey)
    }
  }
  return visited
}

function resolveRootKey(
  byFrame: Map<string, AdminRecord>,
  rootFrameId: string,
  rootTraceId?: string | null,
): string | undefined {
  if (rootTraceId) {
    const key = frameRecordKey(rootTraceId, rootFrameId)
    return byFrame.has(key) ? key : undefined
  }
  const suffix = `:${rootFrameId}`
  for (const key of byFrame.keys()) {
    if (key.endsWith(suffix)) return key
  }
  return undefined
}

/**
 * Rail nodes around `rootFrameId`. Cause ids stay in the record's own trace;
 * `computed.dependency` links may pull in a parent from another trace.
 * `rootTraceId` picks the root when frame ids collide.
 */
export function causeRailNodes(
  records: readonly AdminRecord[],
  rootFrameId: string | null,
  direction: OtlpGraphDirection,
  rootTraceId?: string | null,
  visibleFrameKeys?: ReadonlySet<string>,
): OtlpRailNode[] {
  if (rootFrameId === null) return []
  const rootId = Number(rootFrameId)
  if (!Number.isFinite(rootId)) return []
  const byFrame = framedByFrameId(records)
  const rootKey = resolveRootKey(byFrame, rootFrameId, rootTraceId)
  if (rootKey === undefined) return []

  const keys =
    direction === 'ancestors'
      ? collectAncestors(rootKey, byFrame)
      : direction === 'descendants'
        ? collectDescendants(rootKey, byFrame)
        : new Set([
            ...collectAncestors(rootKey, byFrame),
            ...collectDescendants(rootKey, byFrame),
          ])

  const nodes: OtlpRailNode[] = []
  for (const key of keys) {
    const record = byFrame.get(key)
    if (!record || (visibleFrameKeys && !visibleFrameKeys.has(key))) continue
    const node = toRailNode(record)
    if (node) nodes.push(node)
  }
  return nodes.sort((left, right) =>
    left.timestamp === right.timestamp
      ? left.id - right.id
      : left.timestamp - right.timestamp,
  )
}

export function isStateWrite(record: AdminRecord): boolean {
  if (record.atomName === undefined) return false
  if (record.eventName !== undefined && UPDATE_EVENTS.has(record.eventName)) {
    return true
  }
  return (
    record.kind === 'span' &&
    record.reatomKind !== undefined &&
    STATE_KINDS.has(record.reatomKind)
  )
}

export function lastWriteByAtom(
  records: readonly AdminRecord[],
): Map<string, AdminRecord> {
  const last = new Map<string, AdminRecord>()
  for (const record of records) {
    if (!isStateWrite(record) || record.atomName === undefined) continue
    last.set(`${record.sourceId}:${record.atomName}`, record)
  }
  return last
}

function splitAtomPath(name: string): Array<string> {
  return name.split(/[.#]/g).filter((part) => part.length > 0)
}

function sortStateTree(nodes: Array<OtlpStateNode>): Array<OtlpStateNode> {
  return [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === 'group' ? -1 : 1
      return left.label.localeCompare(right.label, undefined, {
        numeric: true,
      })
    })
    .map((node) => ({
      ...node,
      children: sortStateTree(node.children),
    }))
}

interface StateTreeGroupNode extends OtlpStateNode {
  kind: 'group'
}

function isGroupNode(node: OtlpStateNode): node is StateTreeGroupNode {
  return node.kind === 'group'
}

function getOrCreateGroup(
  groups: Map<string, StateTreeGroupNode>,
  key: string,
  label: string,
  path: string,
): StateTreeGroupNode {
  const existing = groups.get(key)
  if (existing) return existing
  const created: StateTreeGroupNode = {
    id: `group:${path}`,
    kind: 'group',
    label,
    path,
    children: [],
  }
  groups.set(key, created)
  return created
}

function appendLeafToGroup(
  group: StateTreeGroupNode,
  leafNode: OtlpStateNode,
): void {
  group.children = group.children
    .filter((child) => child.id !== leafNode.id)
    .concat(leafNode)
}

export function buildLastWriteStateTree(
  records: readonly AdminRecord[],
): OtlpStateNode[] {
  const latest = lastWriteByAtom(records)
  const rootGroups = new Map<string, StateTreeGroupNode>()

  for (const record of latest.values()) {
    const atomName = record.atomName
    if (atomName === undefined) continue
    const pathParts = splitAtomPath(atomName)
    if (pathParts.length === 0) continue

    let currentGroups = rootGroups
    let parentNode: StateTreeGroupNode | null = null
    const parentPathParts: Array<string> = []

    for (const segment of pathParts.slice(0, -1)) {
      parentPathParts.push(segment)
      const groupPath = parentPathParts.join('.')
      const groupNode = getOrCreateGroup(
        currentGroups,
        groupPath,
        segment,
        groupPath,
      )
      if (
        parentNode &&
        !parentNode.children.some((child) => child.id === groupNode.id)
      ) {
        parentNode.children.push(groupNode)
      }
      parentNode = groupNode
      const childGroups = new Map<string, StateTreeGroupNode>()
      for (const child of groupNode.children) {
        if (isGroupNode(child)) childGroups.set(child.path, child)
      }
      currentGroups = childGroups
    }

    const label = pathParts[pathParts.length - 1] ?? atomName
    const path = pathParts.join('.')
    const leafNode: OtlpStateNode = {
      id: `atom:${record.sourceId}:${atomName}`,
      kind: 'atom',
      label,
      path,
      atomName,
      sourceId: record.sourceId,
      recordId: record.id,
      frameId: record.frameId,
      value: recordValuePreview(record),
      children: [],
    }

    const group = parentNode ?? getOrCreateGroup(rootGroups, path, label, path)
    appendLeafToGroup(group, leafNode)
  }

  const rootNodes = Array.from(rootGroups.values()).map((node) => {
    if (
      node.children.length === 1 &&
      node.children[0]?.kind === 'atom' &&
      node.label === node.children[0].label
    ) {
      return node.children[0]
    }
    return node
  })

  return sortStateTree(rootNodes)
}

export function timelineRole(
  record: AdminRecord,
): 'action' | 'state' | 'other' {
  if (record.reatomKind !== undefined && STATE_KINDS.has(record.reatomKind)) {
    return 'state'
  }
  if (record.eventName !== undefined && UPDATE_EVENTS.has(record.eventName)) {
    return 'state'
  }
  if (record.reatomKind === 'action' || record.kind === 'span') return 'action'
  return 'other'
}

export function recordTimeRange(
  records: readonly AdminRecord[],
): { min: number; max: number } | null {
  if (records.length === 0) return null
  let min = records[0]!.start
  let max = min
  for (let index = 1; index < records.length; index += 1) {
    const start = records[index]!.start
    if (start < min) min = start
    if (start > max) max = start
  }
  return { min, max }
}

export function suggestedBucketSize(
  records: readonly AdminRecord[],
  range: { min: number; max: number } | null = recordTimeRange(records),
): number {
  if (!range) return 100
  const durationMs = Math.max(range.max - range.min, 1)
  return Math.min(
    MAX_BUCKET_SIZE_MS,
    Math.max(MIN_BUCKET_SIZE_MS, Math.ceil(durationMs / TARGET_BURST_COUNT)),
  )
}

export function buildRecordBuckets(
  records: readonly AdminRecord[],
  windowSizeMs: number,
  range: { min: number; max: number } | null = recordTimeRange(records),
): OtlpTimeBucket[] {
  if (!range || records.length === 0) return []
  const size = Math.max(windowSizeMs, 1)
  const span = Math.max(range.max - range.min, 1)
  const effectiveSize = Math.max(size, Math.ceil(span / MAX_BUCKET_COUNT))
  const numBuckets = Math.min(
    MAX_BUCKET_COUNT,
    Math.max(1, Math.ceil(span / effectiveSize)),
  )
  const buckets: OtlpTimeBucket[] = []
  for (let index = 0; index < numBuckets; index += 1) {
    const start = range.min + index * effectiveSize
    buckets.push({
      start,
      end: start + effectiveSize,
      entries: [],
      errorCount: 0,
      actionCount: 0,
      stateCount: 0,
    })
  }

  for (const record of records) {
    let index = Math.floor((record.start - range.min) / effectiveSize)
    if (index < 0) index = 0
    if (index >= numBuckets) index = numBuckets - 1
    const bucket = buckets[index]
    if (!bucket) continue
    bucket.entries.push(record)
    if (recordHasError(record)) bucket.errorCount += 1
    const role = timelineRole(record)
    if (role === 'action') bucket.actionCount += 1
    else if (role === 'state') bucket.stateCount += 1
  }

  return buckets
}

export function groupRecordsByStart(
  records: readonly AdminRecord[],
): OtlpRecordGroup[] {
  const byTimestamp = new Map<number, AdminRecord[]>()
  for (const record of records) {
    const group = byTimestamp.get(record.start) ?? []
    group.push(record)
    byTimestamp.set(record.start, group)
  }
  return Array.from(byTimestamp.entries())
    .map(([timestamp, grouped]) => ({ timestamp, records: grouped }))
    .sort((left, right) => left.timestamp - right.timestamp)
}

export function recordHistory(
  records: readonly AdminRecord[],
  record: AdminRecord,
  limit: number = 8,
): AdminRecord[] {
  if (record.atomName === undefined) return []
  return records
    .filter(
      (entry) =>
        entry.atomName === record.atomName &&
        entry.sourceId === record.sourceId &&
        entry.id !== record.id,
    )
    .slice(-limit)
    .reverse()
}
