import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import {
  buildLastWriteStateTree,
  buildRecordBuckets,
  causeRailNodes,
  FEED_RENDER_LIMIT,
  lastWriteByAtom,
  MAX_BUCKET_COUNT,
  railNodesFromRecords,
  recordHasError,
  recordTimeRange,
  timelineRole,
  toActivityRow,
  toRailNode,
  visibleFeed,
  type OtlpStateNode,
} from './bind.ts'
import { reatomOtlpAdmin } from './chrome.ts'
import { reatomOtlpStore } from './ingest.ts'
import type { AdminRecord } from './ingest.ts'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
  'telemetry.sdk.name': '@reatom/opentelemetry',
  'telemetry.sdk.language': 'webjs',
  'telemetry.sdk.version': '1000.15.2',
}

const successSpan = readFixture('success-span.json')
const atomUpdate = readFixture('atom-update.json') as {
  span: unknown
  log: {
    eventName: string
    body: unknown
    attributes: { 'reatom.name': string; 'reatom.frame.id': string }
  }
}
const recordsSnapshot = readFixture('records-snapshot.json') as unknown[]
const exceptionJoin = readFixture('exception-join.json') as {
  span: unknown
  log: unknown
}

const createStore = () =>
  ADMIN_FRAME.run(() =>
    reatomOtlpStore({
      sourceId: 'local',
      resource: INSTANCE_RESOURCE,
    }),
  )

const ingest = (
  store: ReturnType<typeof reatomOtlpStore>,
  records: readonly unknown[],
) => {
  ADMIN_FRAME.run(() => store.ingest(records))
}

const listRecords = (store: ReturnType<typeof reatomOtlpStore>) =>
  ADMIN_FRAME.run(() => store.records() as AdminRecord[])

test('activity rows use the three AD-1 columns over AdminRecord', () => {
  const store = createStore()
  ingest(store, [
    successSpan,
    atomUpdate.log,
    exceptionJoin.span,
    exceptionJoin.log,
  ])

  const rows = listRecords(store).map(toActivityRow)
  expect(rows).toHaveLength(4)

  const ping = rows[0]!
  expect(ping.time).toBe(ping.record.start)
  expect(ping.label).toBe('devtools.ping')
  expect(ping.showActionBadge).toBe(true)
  expect(ping.showErrorBadge).toBe(false)
  expect(ping.value).toBe('pong')

  const checked = rows[1]!
  expect(checked.label).toBe('tree.checked')
  expect(checked.showActionBadge).toBe(false)
  expect(checked.value).toBe(true)

  const explode = rows[2]!
  expect(explode.label).toBe('explode')
  expect(explode.showActionBadge).toBe(true)
  expect(explode.showErrorBadge).toBe(true)
  expect(recordHasError(explode.record)).toBe(true)
})

test('toRailNode skips records without frameId and links computed.dependency', () => {
  const store = createStore()
  const routeShort = {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    spanId: 'bbbbbbbbbbbbbbbb',
    name: 'route goods',
    startTimeUnixNano: '1791352144731000000',
    endTimeUnixNano: '1791352144731000000',
    attributes: {
      'reatom.kind': 'route',
      'reatom.name': 'goods',
    },
  }
  const diamondWithLinkFrame = structuredClone(recordsSnapshot[2]) as {
    attributes: unknown
    links: Array<{
      attributes: Array<{ key: string; value: { stringValue?: string } }>
    }>
  }
  diamondWithLinkFrame.links[0]!.attributes.push({
    key: 'reatom.frame.id',
    value: { stringValue: '4' },
  })

  ingest(store, [
    atomUpdate.span,
    atomUpdate.log,
    routeShort,
    diamondWithLinkFrame,
  ])

  const records = listRecords(store)
  const withoutFrame = records.find((record) => record.name === 'route goods')
  expect(withoutFrame).toBeDefined()
  expect(toRailNode(withoutFrame!)).toBeUndefined()

  const nodes = railNodesFromRecords(records)
  expect(nodes.some((node) => node.label === 'goods')).toBe(false)
  expect(nodes.map((node) => node.id).sort((a, b) => a - b)).toEqual([1, 2, 6])

  const toggle = toRailNode(records.find((record) => record.frameId === '1')!)
  expect(toggle).toMatchObject({
    id: 1,
    label: 'tree#12.toggle',
    kind: 'action',
    parentIds: [],
    hasError: false,
  })

  const checked = toRailNode(records.find((record) => record.frameId === '2')!)
  expect(checked).toMatchObject({
    id: 2,
    label: 'tree.checked',
    kind: 'state',
    parentIds: [1],
  })

  const diamond = toRailNode(records.find((record) => record.frameId === '6')!)
  expect(diamond?.parentIds).toEqual(expect.arrayContaining([3, 5, 4]))
})

test('cause rail 1-hop is the selection plus direct parents and children', () => {
  const store = createStore()
  ingest(store, [atomUpdate.span, atomUpdate.log])
  const records = listRecords(store)
  const oneHop = causeRailNodes(records, '1', 'full', undefined, 1)
  expect(oneHop.map((node) => node.id).sort((a, b) => a - b)).toEqual([1, 2])
})

test('cause rail walks causeIds from a selected frame root', () => {
  const store = createStore()
  ingest(store, [atomUpdate.span, atomUpdate.log])
  const records = listRecords(store)
  const ancestors = causeRailNodes(records, '2', 'ancestors')
  expect(ancestors.map((node) => node.id).sort((a, b) => a - b)).toEqual([1, 2])
  const descendants = causeRailNodes(records, '1', 'descendants')
  expect(descendants.map((node) => node.id).sort((a, b) => a - b)).toEqual([
    1, 2,
  ])
})

test('cause rail keys frame ids by trace so colliding ids do not join', () => {
  const pingTrace = 'e81f78cd8e164b580618a24df929cd89'
  const toggleTrace = 'cb8d064f62349e625e67d655b9ed1946'
  const explodeTrace = '5b8efff798038103d269b633813fc60c'
  const store = createStore()
  ingest(store, [
    successSpan,
    atomUpdate.span,
    atomUpdate.log,
    exceptionJoin.span,
  ])
  const records = listRecords(store)
  expect(
    records
      .filter((record) => record.frameId === '1')
      .map((record) => record.traceId),
  ).toEqual(expect.arrayContaining([pingTrace, toggleTrace, explodeTrace]))

  const checkedAncestors = causeRailNodes(
    records,
    '2',
    'ancestors',
    toggleTrace,
  )
  expect(checkedAncestors.map((node) => node.label)).toEqual(
    expect.arrayContaining(['tree#12.toggle', 'tree.checked']),
  )
  expect(checkedAncestors.map((node) => node.label)).not.toContain(
    'devtools.ping',
  )

  const pingOnly = causeRailNodes(records, '1', 'ancestors', pingTrace)
  expect(pingOnly.map((node) => node.label)).toEqual(['devtools.ping'])

  const unscoped = causeRailNodes(records, '2', 'ancestors')
  expect(unscoped.map((node) => node.label)).toEqual(
    expect.arrayContaining(['tree#12.toggle', 'tree.checked']),
  )
  expect(unscoped.map((node) => node.label)).not.toContain('devtools.ping')
})

function atomNamesInTree(nodes: OtlpStateNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.atomName !== undefined ? [node.atomName] : []),
    ...atomNamesInTree(node.children),
  ])
}

const treeAtomLog = {
  eventName: 'reatom.atom.update',
  traceId: 'cb8d064f62349e625e67d655b9ed1946',
  spanId: '1111111111111111',
  timeUnixNano: '1791351231721000000',
  body: { checked: false },
  attributes: {
    'event.name': 'reatom.atom.update',
    'reatom.name': 'tree',
    'reatom.kind': 'atom',
    'reatom.frame.id': '8',
    'reatom.cause.ids': [],
  },
}

test('state last-write is per atomName+sourceId and does not drop actions from byAtom', () => {
  const store = createStore()
  const laterChecked = {
    ...atomUpdate.log,
    body: false,
    timeUnixNano: '1791351231723000000',
  }
  ingest(store, [atomUpdate.span, atomUpdate.log, laterChecked, successSpan])

  ADMIN_FRAME.run(() => {
    expect(store.byAtom('tree#12.toggle')).toHaveLength(1)
    expect(store.byAtom('tree#12.toggle')[0]!.kind).toBe('span')
    expect(store.byAtom('devtools.ping')).toHaveLength(1)
    expect(store.byAtom('tree.checked')).toHaveLength(2)
  })

  const records = listRecords(store)
  const last = lastWriteByAtom(records)
  expect(last.get('local:tree.checked')?.body).toBe(false)
  expect(last.has('local:tree#12.toggle')).toBe(false)
  expect(last.has('local:devtools.ping')).toBe(false)

  const tree = buildLastWriteStateTree(records)
  const labels = tree.flatMap(function walk(node): string[] {
    return [node.label, ...node.children.flatMap(walk)]
  })
  const checkedLeaf = tree
    .flatMap(function walk(node): OtlpStateNode[] {
      return [node, ...node.children.flatMap(walk)]
    })
    .find((node) => node.atomName === 'tree.checked')
  expect(checkedLeaf?.writeCount).toBe(2)
  expect(checkedLeaf?.reatomKind).toBe('atom')
  expect(labels).toContain('checked')
  expect(labels).not.toContain('toggle')
  expect(labels).not.toContain('ping')
  expect(last.get('local:tree.checked')?.body).toBe(false)
})

test('state tree sorts numbered atom segments numerically', () => {
  const record = (atomName: string): AdminRecord => ({
    id: atomName,
    sourceId: 'local',
    kind: 'log',
    traceId: 'trace',
    spanId: atomName,
    name: atomName,
    start: 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    atomName,
    eventName: 'reatom.atom.update',
    reatomKind: 'atom',
  })
  const tree = buildLastWriteStateTree([
    record('item#10'),
    record('item#2'),
    record('item#8'),
  ])
  expect(tree.map((node) => node.label)).toEqual(['item'])
  expect(tree[0]?.children.map((node) => node.label)).toEqual(['2', '8', '10'])
})

test('state last-write tree keeps child atoms regardless of write order', () => {
  const childFirst = createStore()
  ingest(childFirst, [atomUpdate.log, treeAtomLog])
  const childFirstNames = atomNamesInTree(
    buildLastWriteStateTree(listRecords(childFirst)),
  )
  expect(childFirstNames).toEqual(
    expect.arrayContaining(['tree', 'tree.checked']),
  )

  const parentFirst = createStore()
  ingest(parentFirst, [treeAtomLog, atomUpdate.log])
  const parentFirstNames = atomNamesInTree(
    buildLastWriteStateTree(listRecords(parentFirst)),
  )
  expect(parentFirstNames).toEqual(
    expect.arrayContaining(['tree', 'tree.checked']),
  )
})

test('timeline buckets count action vs state from kind and errors from outcome', () => {
  const store = createStore()
  ingest(store, [...recordsSnapshot, exceptionJoin.span, exceptionJoin.log])
  const records = listRecords(store)
  const buckets = buildRecordBuckets(records, 60_000 * 60 * 24 * 365 * 10)
  const merged = {
    actionCount: buckets.reduce((sum, bucket) => sum + bucket.actionCount, 0),
    stateCount: buckets.reduce((sum, bucket) => sum + bucket.stateCount, 0),
    errorCount: buckets.reduce((sum, bucket) => sum + bucket.errorCount, 0),
    entries: buckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
  }
  expect(merged.entries).toBe(5)
  expect(merged.actionCount).toBe(
    records.filter((record) => timelineRole(record) === 'action').length,
  )
  expect(merged.stateCount).toBe(
    records.filter((record) => timelineRole(record) === 'state').length,
  )
  expect(merged.actionCount).toBeGreaterThan(0)
  expect(merged.stateCount).toBeGreaterThan(0)
  expect(merged.errorCount).toBeGreaterThan(0)
  expect(records.every((record) => Number.isFinite(record.start))).toBe(true)

  const range = recordTimeRange(records)
  expect(range).not.toBeNull()
  expect(range!.min).toBe(Math.min(...records.map((record) => record.start)))
  expect(range!.max).toBe(Math.max(...records.map((record) => record.start)))
})

test('timeline buckets assign records in one pass and clamp bucket count', () => {
  const records = Array.from({ length: 400 }, (_, index) => ({
    id: String(index),
    start: index,
  })) as AdminRecord[]
  const buckets = buildRecordBuckets(records, 1)
  const range = recordTimeRange(records)
  expect(range).not.toBeNull()
  expect(buckets.length).toBe(MAX_BUCKET_COUNT)
  expect(buckets.reduce((sum, bucket) => sum + bucket.entries.length, 0)).toBe(
    400,
  )
  expect(buckets.at(-1)!.end).toBeGreaterThanOrEqual(range!.max)
  const maxEntriesPerBucket = Math.ceil(400 / MAX_BUCKET_COUNT) + 1
  expect(
    buckets.every((bucket) => bucket.entries.length <= maxEntriesPerBucket),
  ).toBe(true)
  expect(recordTimeRange([])).toBeNull()
  expect(buildRecordBuckets([], 1)).toEqual([])
})

test('chrome feed cap, pause gate, unique ids, and selection write frame root', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })

  ADMIN_FRAME.run(() => {
    admin.ingest([atomUpdate.span, atomUpdate.log, successSpan])
    expect(admin.records()).toHaveLength(3)
    expect(new Set(admin.records().map((record) => record.id)).size).toBe(3)

    const checked = admin
      .records()
      .find((record) => record.atomName === 'tree.checked')
    expect(checked).toBeDefined()
    admin.selectRecord(checked!)
    expect(admin.selectedRecordId()).toBe(checked!.id)
    expect(admin.selectedRootFrameId()).toBe('2')
    expect(admin.selectedTraceId()).toBe(checked!.traceId)

    const frameless = {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: 'bbbbbbbbbbbbbbbb',
      name: 'route goods',
      startTimeUnixNano: '1791352144731000000',
      endTimeUnixNano: '1791352144731000000',
      attributes: {
        'reatom.kind': 'route',
        'reatom.name': 'goods',
      },
    }
    admin.ingest([frameless])
    const goods = admin
      .records()
      .find((record) => record.name === 'route goods')
    expect(goods).toBeDefined()
    expect(goods!.frameId).toBeUndefined()
    admin.selectRecord(goods!)
    expect(admin.selectedRecordId()).toBe(goods!.id)
    expect(admin.selectedRootFrameId()).toBeNull()
    admin.selectRecord(checked!)
    expect(admin.selectedRootFrameId()).toBe('2')
    admin.selectFrame(999_999)
    expect(admin.selectedRecordId()).toBeNull()
    expect(admin.selectedRootFrameId()).toBe('2')

    admin.paused.setTrue()
    admin.ingest([exceptionJoin.span])
    expect(admin.records()).toHaveLength(4)

    admin.paused.setFalse()
    admin.ingest([exceptionJoin.span, exceptionJoin.log])
    expect(admin.records()).toHaveLength(6)

    const extras = Array.from(
      { length: FEED_RENDER_LIMIT + 5 },
      (_, index) => ({
        eventName: 'reatom.log',
        traceId: 'cccccccccccccccccccccccccccccccc',
        spanId: `d${index.toString().padStart(15, '0')}`,
        timeUnixNano: String(1791352144731000000n + BigInt(index)),
        body: index,
        attributes: { 'reatom.frame.id': String(100 + index) },
      }),
    )
    admin.ingest(extras)
    expect(admin.records().length).toBeGreaterThan(FEED_RENDER_LIMIT)
    expect(admin.feedRecords()).toHaveLength(FEED_RENDER_LIMIT)

    admin.clear()
    expect(admin.records()).toEqual([])
    expect(admin.feedRecords()).toEqual([])
    expect(admin.selectedRecordId()).toBeNull()
    expect(admin.selectedRootFrameId()).toBeNull()
    expect(admin.selectedTraceId()).toBeNull()
  })
})

test('trace header counts the full visible set, not the 200-record feed', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: INSTANCE_RESOURCE,
  })
  const traceId = 'c'.repeat(32)
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: FEED_RENDER_LIMIT + 10 }, (_, index) => ({
        name: index === 0 ? 'checkout' : `child-${index}`,
        traceId,
        spanId: index.toString(16).padStart(16, '0'),
        parentSpanId:
          index === 0 ? undefined : (0).toString(16).padStart(16, '0'),
        startTimeUnixNano: String(1791352144731000000n + BigInt(index)),
        endTimeUnixNano: String(1791352144731000000n + BigInt(index) + 1n),
        attributes: { 'reatom.kind': index === 0 ? 'action' : 'computed' },
      })),
    )
    expect(admin.feedRecords()).toHaveLength(FEED_RENDER_LIMIT)
    expect(admin.traceHeader()?.spanCount).toBe(FEED_RENDER_LIMIT + 10)
    expect(admin.traceHeader()?.rootName).toBe('checkout')
  })
})

test('visibleFeed keeps the last 200 records', () => {
  const records = Array.from({ length: 205 }, (_, index) => ({
    id: String(index),
    start: index,
  })) as AdminRecord[]
  const visible = visibleFeed(records)
  expect(visible).toHaveLength(200)
  expect(visible[0]!.id).toBe('5')
  expect(visible.at(-1)!.id).toBe('204')
})
