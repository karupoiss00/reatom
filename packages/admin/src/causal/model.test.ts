import { atom, computed, notify } from '@reatom/core'
import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from '../otlp/chrome'
import { LOCAL_VALUES, reatomOtlpStore, type AdminRecord } from '../otlp/ingest'
import type { CausalEdge } from './graph'
import { reatomCausalTimeline } from './model'

const ms = (n: number) => String(BigInt(n) * 1_000_000n)
const span = (
  name: string,
  frame: string,
  start: number,
  causes: string[] = [],
  spanId = frame,
) => ({
  name,
  spanId,
  traceId: 'trace',
  startTimeUnixNano: ms(start),
  endTimeUnixNano: ms(start + 5),
  attributes: {
    'reatom.name': name,
    'reatom.kind': 'action',
    'reatom.frame.id': frame,
    'reatom.cause.ids': causes,
  },
})
const log = (start: number) => ({
  traceId: 'trace',
  spanId: 'pending',
  eventName: 'reatom.log',
  body: 'pending work',
  timeUnixNano: ms(start),
})
const chainNames = (
  model: ReturnType<typeof reatomCausalTimeline>,
  keys: Iterable<string>,
) => [...keys].map((key) => model.graph().events.get(key)!.record.name).sort()
const chainEdgeNames = (
  model: ReturnType<typeof reatomCausalTimeline>,
  edges: Iterable<CausalEdge>,
) =>
  [...edges]
    .map(
      (edge) =>
        `${model.graph().events.get(edge.from)!.record.name}→${model.graph().events.get(edge.to)!.record.name}`,
    )
    .sort()

test('causal tail appends preserve handles, late causes reorder rows and leave raw capture order intact', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([span('one', '1', 10)])
    notify()
    const one = admin.causal.ordered.array()[0]!
    const before = admin.causal.privateState().appendCount
    admin.ingest([span('two', '2', 20, ['1'])])
    notify()
    expect(admin.causal.privateState().appendCount).toBe(before + 1)
    expect(admin.causal.ordered.array()[0]).toBe(one)
    admin.ingest([span('effect', '4', 0, ['3'])])
    notify()
    admin.ingest([span('late cause', '3', 30)])
    notify()
    expect(
      admin.causal.ordered.array().map((row) => row.record().name),
    ).toEqual(['one', 'two', 'late cause', 'effect'])
    expect(admin.records().map((record) => record.name)).toEqual([
      'one',
      'two',
      'effect',
      'late cause',
    ])
    expect(admin.causal.ordered.array().at(-1)!.record().start).toBe(0)
    admin.disposeModel()
  })
})

test('placeholder promotion retains handle, selection and history and recomputes measured bounds', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: {},
    source: 'replay',
  })
  ADMIN_FRAME.run(() => {
    admin.ingest([log(50)])
    notify()
    const placeholder = admin.causal.ordered
      .array()
      .find((row) => row.synthetic())!
    admin.causal.select(placeholder)
    expect(admin.selectedRecord()!.outcome).toBe('pending')
    const symbols = Object.getOwnPropertySymbols(placeholder.record())
    expect(symbols.every((symbol) => symbol === LOCAL_VALUES)).toBe(true)
    expect(admin.causal.range()).toEqual({ start: 50, end: 50 })
    admin.ingest([span('completed', '1', 10, [], 'pending')])
    notify()
    const completed = admin.causal.ordered
      .array()
      .find((row) => row.record().name === 'completed')!
    expect(completed).toBe(placeholder)
    expect(completed.synthetic()).toBe(false)
    expect(admin.selectedRecord()!.name).toBe('completed')
    expect(admin.selectionHistory()).toEqual([completed.record().id])
    expect(admin.causal.range()).toEqual({ start: 10, end: 50 })
    admin.disposeModel()
  })
})

test('filters keep hidden selection, highlight keeps topology, section controls retain one section', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([span('cause', '1', 10), span('effect', '2', 20, ['1'])])
    notify()
    const row = admin.causal.ordered.array()[0]!
    admin.causal.select(row)
    admin.filterName.set('effect')
    notify()
    expect(admin.causal.hiddenSelection()).toBe(true)
    expect(admin.selectedRecord()!.name).toBe('cause')
    admin.filterMode.set('highlight')
    notify()
    expect(admin.causal.visible().size).toBe(2)
    expect(admin.causal.lanes().intervals).toHaveLength(1)
    admin.causal.toggleSection('graph')
    admin.causal.toggleSection('logs')
    admin.causal.toggleSection('time')
    expect(admin.causal.sections.time()).toBe(true)
    admin.causal.resizeSection('time', 12)
    expect(admin.causal.widths.time()).toBe(160)
    admin.disposeModel()
  })
})

test('tail arrivals preserve a paused viewport including overscan and count only actual new rows', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: 150 }, (_, index) =>
        span(`event ${index}`, String(index), index * 10),
      ),
    )
    notify()
    admin.causal.virtual.viewportSize.set(26 * 10)
    admin.followLive.setFalse()
    admin.causal.virtual.scrollTo(26 * 50 + 7)
    notify()
    const offset = admin.causal.virtual.scrollOffset(),
      window = admin.causal.virtual.items()
    admin.ingest([span('new event', '150', 1500)])
    notify()
    expect(admin.causal.virtual.scrollOffset()).toBe(offset)
    expect(admin.causal.virtual.items()).toBe(window)
    expect(admin.causal.unseen()).toBe(1)
    admin.followLive.setTrue()
    notify()
    expect(admin.causal.unseen()).toBe(0)
    expect(admin.causal.virtual.items().at(-1)!.record().name).toBe('new event')
    admin.disposeModel()
  })
})

test('only proven span/log aliases merge; ordinary logs and different frame kinds remain separate', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    const framedLog = (body: string, kind = 'computed') => ({
      traceId: 'trace',
      spanId: 'shared',
      eventName: `reatom.${kind}.update`,
      body,
      timeUnixNano: ms(20),
      attributes: {
        'reatom.frame.id': '1',
        'reatom.name': 'same',
        'reatom.kind': kind,
        'reatom.cause.ids': ['root'],
      },
    })
    admin.showMountLogs.setTrue()
    admin.ingest([framedLog('first'), framedLog('second')])
    notify()
    expect(
      admin.causal.ordered.array().filter((row) => row.record().kind === 'log'),
    ).toHaveLength(2)
    admin.clear()
    notify()
    admin.ingest([
      {
        ...span('same', '1', 10, [], 'shared'),
        attributes: {
          'reatom.kind': 'computed',
          'reatom.frame.id': '1',
          'reatom.name': 'same',
        },
      },
      framedLog('alias'),
      framedLog('different kind', 'atom'),
    ])
    notify()
    const actual = admin.causal.ordered
      .array()
      .filter((row) => !row.synthetic())
    expect(actual).toHaveLength(2)
    expect(
      actual.find((row) => row.record().reatomKind === 'computed')!.record()
        .kind,
    ).toBe('span')
    expect(
      actual.find((row) => row.record().reatomKind === 'atom')!.record().kind,
    ).toBe('log')
    admin.disposeModel()
  })
})

test('a late span canonicalizes its frame log into the selected pending handle', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.showMountLogs.setTrue()
    admin.ingest([
      {
        traceId: 'trace',
        spanId: 'late',
        eventName: 'reatom.computed.update',
        body: 'first result',
        timeUnixNano: ms(20),
        attributes: {
          'reatom.frame.id': '1',
          'reatom.kind': 'computed',
          'reatom.name': 'same',
        },
      },
    ])
    notify()
    const pending = admin.causal.ordered.array().find((row) => row.synthetic())!
    admin.causal.select(pending)
    admin.ingest([
      {
        ...span('same', '1', 10, [], 'late'),
        attributes: {
          'reatom.frame.id': '1',
          'reatom.kind': 'computed',
          'reatom.name': 'same',
        },
      },
    ])
    notify()
    expect(admin.causal.ordered.array()).toEqual([pending])
    expect(admin.causal.pending()).toBe(0)
    expect(admin.selectedRecord()!.name).toBe('same')
    expect(admin.selectionHistory()).toEqual([pending.record().id])
    admin.disposeModel()
  })
})

test('clear and undo merge newer duplicate-looking logs without ID collisions or stale graph edges', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([log(50)])
    notify()
    const snapshot = admin.records().slice()
    admin.clear()
    notify()
    expect(admin.causal.ordered().size).toBe(0)
    admin.ingest([log(50)])
    notify()
    admin.restoreRecords(snapshot)
    notify()
    expect(admin.records()).toHaveLength(2)
    expect(new Set(admin.records().map((record) => record.id)).size).toBe(2)
    expect(
      admin.causal.ordered.array().filter((row) => !row.synthetic()),
    ).toHaveLength(2)
    expect(admin.causal.graph().edges).toEqual([])
    // A repeated restore cannot insert an already-owned intrusive node twice.
    admin.restoreRecords(snapshot)
    notify()
    expect(admin.records()).toHaveLength(2)
    admin.disposeModel()
  })
})

test('default timeline counters and append geometry do not read the compatibility source array', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    // Returning from the legacy tree must release its eager array consumers.
    admin.causalEnabled.setFalse()
    notify()
    admin.causalEnabled.setTrue()
    notify()
    const list = admin.store.recordList,
      array = list.array
    list.array = (() => {
      throw new Error('Unexpected full source array conversion')
    }) as unknown as typeof array
    try {
      admin.recordCounts()
      admin.causal.lanes()
      admin.causal.buses()
      admin.causal.rawRelations()
      admin.causal.visibleTime()
      admin.ingest([span('action', '1', 10)])
      notify()
      expect(admin.recordCounts()).toEqual({
        errors: 0,
        logs: 0,
        abort: 0,
        mount: 0,
        kinds: { action: 1 },
      })
      expect(admin.abortSuspenseCount()).toBe(0)
      expect(admin.mountLogCount()).toBe(0)
      expect(admin.causal.lanes().ranks.size).toBe(1)
      expect(admin.causal.buses().ranks.size).toBe(1)
      expect(admin.causal.rawRelations().inScope.size).toBe(1)
      expect(admin.causal.visibleTime()).toEqual({ start: 10, end: 15 })
    } finally {
      list.array = array
      admin.disposeModel()
    }
  })
})

test('capture counters refresh after late exceptions and clear/undo', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([span('action', '1', 10)])
    notify()
    expect(admin.recordCounts().errors).toBe(0)
    admin.ingest([
      {
        traceId: 'trace',
        spanId: '1',
        eventName: 'exception',
        timeUnixNano: ms(12),
        attributes: {
          'exception.type': 'Error',
          'exception.message': 'late failure',
        },
      },
    ])
    notify()
    expect(admin.recordCounts().errors).toBe(
      admin
        .records()
        .filter((record) => record.error != null || record.outcome === 'error')
        .length,
    )
    expect(admin.recordCounts().logs).toBe(1)
    const saved = admin.records().slice()
    admin.clear()
    notify()
    expect(admin.recordCounts()).toEqual({
      errors: 0,
      logs: 0,
      abort: 0,
      mount: 0,
      kinds: {},
    })
    admin.restoreRecords(saved)
    notify()
    expect(admin.recordCounts().logs).toBe(1)
    expect(admin.recordCounts().kinds.action).toBe(1)
    admin.disposeModel()
  })
})

test('shared buses preserve every row and stable projection on selection and ordinary resizing', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('hub', '0', 0),
      ...Array.from({ length: 1000 }, (_, index) =>
        span(`effect ${index}`, String(index + 1), index + 1, ['0']),
      ),
    ])
    notify()
    const rows = admin.causal.ordered.array(),
      projection = admin.causal.buses()
    expect(rows).toHaveLength(1001)
    expect(projection.routes).toHaveLength(1)
    expect(projection.routes[0]!.edges).toHaveLength(1000)
    expect(projection.branchesByEvent.get(rows[500]!.key)).toHaveLength(1)
    admin.causal.select(rows[500]!)
    notify()
    expect(admin.causal.buses()).toBe(projection)
    expect(admin.causal.ordered.array()).toBe(rows)
    expect(admin.causal.visible().size).toBe(rows.length)
    admin.causal.resizeSection('graph', 300)
    admin.causal.resizeSection('logs', 600)
    notify()
    expect(admin.causal.buses()).toBe(projection)
    expect(admin.causal.ordered.array()).toBe(rows)
    admin.causal.busTrackBudget.set(1)
    const narrow = admin.causal.buses()
    expect(narrow.routes[0]!.edges).toBe(projection.routes[0]!.edges)
    admin.causal.busTrackBudget.set(4)
    expect(admin.causal.buses()).toBe(projection)
    admin.causal.relationshipDirection.set('effects')
    admin.causal.tracedEdgeKey.set(projection.routes[0]!.edges[0]!.key)
    notify()
    expect(admin.causal.buses()).toBe(projection)
    expect(admin.causal.ordered.array()).toBe(rows)
    admin.clear()
    notify()
    expect(admin.causal.tracedEdgeKey()).toBe(null)
    expect(admin.causal.relationshipDirection()).toBe('causes')
    expect(admin.causal.buses().routes).toEqual([])
    admin.disposeModel()
  })
})

test('filter projection and raw recorded neighbors stay distinct and a missing trace invalidates explicitly', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('visible cause', '1', 10),
      span('hidden middle', '2', 20, ['1']),
      span('visible effect', '3', 30, ['2']),
    ])
    notify()
    const effect = admin.causal.ordered
      .array()
      .find((row) => row.record().name === 'visible effect')!
    const raw = admin.causal.rawRelations(),
      direct = raw.incoming.get(effect.key)![0]!
    admin.causal.tracedEdgeKey.set(direct.key)
    notify()
    admin.filterName.set('visible')
    notify()
    const projected = admin.causal.buses()
    expect(projected.incoming.get(effect.key)).toHaveLength(1)
    expect(projected.incoming.get(effect.key)![0]!.hidden).toHaveLength(1)
    expect(admin.causal.rawRelations()).toBe(raw)
    expect(raw.incoming.get(effect.key)![0]!.hidden).toEqual([])
    expect(projected.edgeByKey.has(direct.key)).toBe(false)
    expect(admin.causal.tracedEdgeKey()).toBe(null)
    const bridge = projected.incoming.get(effect.key)![0]!
    admin.causal.tracedEdgeKey.set(bridge.key)
    notify()
    admin.causal.select(effect)
    notify()
    expect(admin.causal.tracedEdgeKey()).toBe(bridge.key)
    expect(admin.causal.buses()).toBe(projected)
    admin.disposeModel()
  })
})

test('raw neighbor details disclose scope exclusions without bridging excluded events', () => {
  ADMIN_FRAME.run(() => {
    const store = reatomOtlpStore({ sourceId: 'local', resource: {} }),
      selected = atom<AdminRecord | null>(null, 'bus.scope.selected')
    const scope = atom<((record: AdminRecord) => boolean) | null>(
      null,
      'bus.scope.predicate',
    )
    const model = reatomCausalTimeline(
      {
        store,
        predicate: computed(() => () => true, 'bus.scope.filter'),
        scope,
        follow: atom(false, 'bus.scope.follow'),
        now: atom(100, 'bus.scope.now'),
        selected,
        select: (record) => selected.set(record),
        replaceSelection: () => {},
      },
      'bus.scope',
    )
    const stop = model.start()
    store.ingest([
      span('excluded cause', '1', 10),
      span('visible effect', '2', 20, ['1']),
    ])
    notify()
    const effect = model.ordered
        .array()
        .find((row) => row.record().name === 'visible effect')!,
      cause = model.ordered
        .array()
        .find((row) => row.record().name === 'excluded cause')!
    model.select(cause)
    scope.set(() => (record: AdminRecord) => record.name !== 'excluded cause')
    notify()
    const raw = model.rawRelations()
    expect(raw.inScope.has(cause.key)).toBe(false)
    expect(raw.excludedIncoming.get(effect.key)).toBe(1)
    expect(raw.incoming.get(effect.key)).toBeUndefined()
    expect(model.buses().routes).toEqual([])
    expect(model.buses().boundaries.get(effect.key)).toEqual([
      'Cause outside source/scope',
    ])
    expect(model.selectedRow()).toBe(cause)
    expect(model.hiddenSelection()).toBe(true)
    stop()
  })
})

test('shared-bus presentation keeps certified append and existing event identities', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('hub', '0', 0),
      span('one', '1', 10, ['0']),
      span('two', '2', 20, ['0']),
    ])
    notify()
    const handle = admin.causal.ordered.array()[0]!,
      before = admin.causal.privateState().appendCount,
      group = admin.causal.buses().routes[0]!
    admin.ingest([span('three', '3', 30, ['0'])])
    notify()
    expect(admin.causal.privateState().appendCount).toBe(before + 1)
    expect(admin.causal.ordered.array()[0]).toBe(handle)
    expect(admin.causal.buses().routes).toHaveLength(1)
    expect(admin.causal.buses().routes[0]!.key).toBe(group.key)
    expect(admin.causal.buses().routes[0]!.edges).toHaveLength(3)
    admin.disposeModel()
  })
})

test('all seven section combinations use the approved uniform row density', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: 40 }, (_, index) =>
        span(`event ${index}`, String(index), index * 10),
      ),
    )
    notify()
    const sections = admin.causal.sections,
      rows = admin.causal.ordered.array(),
      buses = admin.causal.buses()
    const combinations = [
      { graph: true, logs: true, time: true, height: 26 },
      { graph: true, logs: true, time: false, height: 36 },
      { graph: false, logs: true, time: false, height: 36 },
      { graph: false, logs: true, time: true, height: 26 },
      { graph: true, logs: false, time: true, height: 26 },
      { graph: true, logs: false, time: false, height: 26 },
      { graph: false, logs: false, time: true, height: 26 },
    ]
    for (const state of combinations) {
      // Show the next sections before hiding previous ones, retaining the
      // existing invariant that the final visible section cannot be hidden.
      for (const key of ['graph', 'logs', 'time'] as const)
        if (state[key] && !sections[key]()) admin.causal.toggleSection(key)
      for (const key of ['graph', 'logs', 'time'] as const)
        if (!state[key] && sections[key]()) admin.causal.toggleSection(key)
      notify()
      expect(admin.causal.rowHeight()).toBe(state.height)
      expect(admin.causal.virtual.totalSize()).toBe(40 * state.height)
      expect(admin.causal.ordered.array()).toBe(rows)
      expect(admin.causal.buses()).toBe(buses)
    }
    admin.disposeModel()
  })
})

test('density changes preserve the first visible event, within-row pixels and selection across overscan', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: 150 }, (_, index) =>
        span(`event ${index}`, String(index), index * 10),
      ),
    )
    notify()
    admin.causal.virtual.viewportSize.set(260)
    const rows = admin.causal.ordered.array(),
      first = rows[50]!,
      selected = rows[55]!
    admin.causal.select(selected)
    admin.causal.virtual.scrollTo(50 * 26 + 7)
    notify()
    expect(admin.causal.virtual().offset).toBe(44)
    expect(admin.causal.virtual.items()[6]).toBe(first)
    admin.causal.toggleSection('time')
    notify()
    expect(admin.causal.rowHeight()).toBe(36)
    expect(admin.causal.virtual.scrollOffset()).toBe(50 * 36 + 7)
    expect(admin.causal.virtual.items()[6]).toBe(first)
    expect(admin.causal.selectedRow()).toBe(selected)
    expect(admin.followLive()).toBe(false)
    expect(admin.causal.virtual.padding().before).toBe(44 * 36)
    admin.causal.toggleSection('time')
    notify()
    expect(admin.causal.rowHeight()).toBe(26)
    expect(admin.causal.virtual.scrollOffset()).toBe(50 * 26 + 7)
    expect(admin.causal.virtual.items()[6]).toBe(first)
    expect(admin.causal.selectedRow()).toBe(selected)
    expect(admin.causal.ordered.array()).toBe(rows)
    admin.disposeModel()
  })
})

test('shrinking a row clamps an otherwise impossible within-row offset without skipping the anchored event', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: 100 }, (_, index) =>
        span(`event ${index}`, String(index), index * 10),
      ),
    )
    notify()
    admin.causal.virtual.viewportSize.set(260)
    admin.followLive.setFalse()
    admin.causal.toggleSection('time')
    notify()
    admin.causal.virtual.scrollTo(50 * 36 + 31)
    notify()
    const anchored = admin.causal.ordered.array()[50]!
    admin.causal.toggleSection('time')
    notify()
    expect(admin.causal.virtual.scrollOffset()).toBe(50 * 26 + 25)
    const window = admin.causal.virtual()
    expect(
      window.items[
        Math.floor(admin.causal.virtual.scrollOffset() / 26) - window.offset
      ],
    ).toBe(anchored)
    expect(admin.followLive()).toBe(false)
    admin.disposeModel()
  })
})

test('Follow remains pinned through density changes while selection identity stays intact', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: 100 }, (_, index) =>
        span(`event ${index}`, String(index), index * 10),
      ),
    )
    notify()
    admin.causal.virtual.viewportSize.set(260)
    const selected = admin.causal.ordered.array()[40]!
    admin.causal.select(selected)
    admin.followLive.setTrue()
    notify()
    expect(admin.causal.virtual.scrollOffset()).toBe(100 * 26 - 260)
    admin.causal.toggleSection('time')
    notify()
    expect(admin.causal.virtual.scrollOffset()).toBe(100 * 36 - 260)
    expect(admin.causal.virtual.items().at(-1)!.record().name).toBe('event 99')
    expect(admin.followLive()).toBe(true)
    expect(admin.causal.selectedRow()).toBe(selected)
    admin.causal.toggleSection('logs')
    notify()
    expect(admin.causal.rowHeight()).toBe(26)
    expect(admin.causal.virtual.scrollOffset()).toBe(100 * 26 - 260)
    expect(admin.followLive()).toBe(true)
    expect(admin.causal.selectedRow()).toBe(selected)
    admin.disposeModel()
  })
})

test('selection highlights complete directed chains without siblings, co-parents or bypass edges', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('root', '1', 10),
      span('ancestor', '2', 20, ['1']),
      span('selected', '3', 30, ['2']),
      span('descendant', '4', 40, ['3', '7', '2']),
      span('tail', '5', 50, ['4']),
      span('sibling', '6', 60, ['2']),
      span('co-parent', '7', 70),
      span('left', '8', 80, ['3']),
      span('right', '9', 90, ['3']),
      span('join', '10', 100, ['8', '9']),
    ])
    notify()
    const model = admin.causal,
      rows = model.ordered.array(),
      buses = model.buses(),
      selected = rows.find((row) => row.record().name === 'selected')!
    model.select(selected)
    const chain = model.selectionChain()
    expect(chain.chosen).toBe(selected.key)
    expect(chainNames(model, chain.ancestors)).toEqual(['ancestor', 'root'])
    expect(chainNames(model, chain.descendants)).toEqual([
      'descendant',
      'join',
      'left',
      'right',
      'tail',
    ])
    expect(chainNames(model, chain.related)).toEqual([
      'ancestor',
      'descendant',
      'join',
      'left',
      'right',
      'root',
      'tail',
    ])
    expect(chainEdgeNames(model, chain.edges.values())).toEqual([
      'ancestor→selected',
      'descendant→tail',
      'left→join',
      'right→join',
      'root→ancestor',
      'selected→descendant',
      'selected→left',
      'selected→right',
    ])
    expect(chain.ancestorEdgeKeys.size).toBe(2)
    expect(chain.descendantEdgeKeys.size).toBe(6)
    expect(chain.edgeKeys.size).toBe(8)
    for (const edge of model.rawRelations().edgeByKey.values())
      expect(chain.includesProjected(edge)).toBe(chain.edgeKeys.has(edge.key))
    expect(model.ordered.array()).toBe(rows)
    expect(model.visible().size).toBe(rows.length)
    expect(model.buses()).toBe(buses)
    model.toggleSection('graph')
    notify()
    expect(model.selectionChain()).toBe(chain)
    expect(model.buses()).toBe(buses)
    admin.selectRecord(null)
    expect(model.selectionChain().chosen).toBeUndefined()
    expect(model.selectionChain().related.size).toBe(0)
    expect(model.selectionChain().edgeKeys.size).toBe(0)
    admin.disposeModel()
  })
})

test('selection chains are cycle-safe and keep the two traversal directions distinct', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('cycle A', '1', 10, ['3', '4']),
      span('selected', '2', 20, ['1']),
      span('cycle C', '3', 30, ['2']),
      span('upstream', '4', 40),
      span('downstream', '5', 50, ['3', '6']),
      span('co-parent', '6', 60),
      span('sibling', '7', 70, ['4']),
    ])
    notify()
    const model = admin.causal
    model.select(
      model.ordered.array().find((row) => row.record().name === 'selected')!,
    )
    const chain = model.selectionChain()
    expect(chainNames(model, chain.ancestors)).toEqual([
      'cycle A',
      'cycle C',
      'upstream',
    ])
    expect(chainNames(model, chain.descendants)).toEqual([
      'cycle A',
      'cycle C',
      'downstream',
    ])
    expect(chainNames(model, chain.related)).toEqual([
      'cycle A',
      'cycle C',
      'downstream',
      'upstream',
    ])
    expect(chainEdgeNames(model, chain.edges.values())).toEqual([
      'cycle A→selected',
      'cycle C→cycle A',
      'cycle C→downstream',
      'selected→cycle C',
      'upstream→cycle A',
    ])
    expect(chain.ancestorEdgeKeys.size).toBe(4)
    expect(chain.descendantEdgeKeys.size).toBe(4)
    expect(chain.edgeKeys.size).toBe(5)
    expect(chain.related.has(chain.chosen!)).toBe(false)
    admin.disposeModel()
  })
})

test('selection chains stop at scope boundaries and exclude an out-of-scope selection', () => {
  ADMIN_FRAME.run(() => {
    const store = reatomOtlpStore({ sourceId: 'local', resource: {} }),
      selected = atom<AdminRecord | null>(null, 'chain.scope.selected')
    const scope = atom<((record: AdminRecord) => boolean) | null>(
      null,
      'chain.scope.predicate',
    )
    const model = reatomCausalTimeline(
      {
        store,
        predicate: computed(() => () => true, 'chain.scope.filter'),
        scope,
        follow: atom(false, 'chain.scope.follow'),
        now: atom(100, 'chain.scope.now'),
        selected,
        select: (record) => selected.set(record),
        replaceSelection: () => {},
      },
      'chain.scope',
    )
    const stop = model.start()
    store.ingest([
      span('root', '1', 10),
      span('excluded', '2', 20, ['1']),
      span('selected', '3', 30, ['2']),
      span('descendant', '4', 40, ['3']),
    ])
    notify()
    const selectedRow = model.ordered
        .array()
        .find((row) => row.record().name === 'selected')!,
      excluded = model.ordered
        .array()
        .find((row) => row.record().name === 'excluded')!
    model.select(selectedRow)
    scope.set(() => (record: AdminRecord) => record.name !== 'excluded')
    notify()
    expect(model.selectionChain().ancestors.size).toBe(0)
    expect(chainNames(model, model.selectionChain().descendants)).toEqual([
      'descendant',
    ])
    expect(model.selectionChain().edgeKeys.size).toBe(1)
    expect(model.rawRelations().excludedIncoming.get(selectedRow.key)).toBe(1)
    model.select(excluded)
    expect(model.selectionChain().chosen).toBe(excluded.key)
    expect(model.selectionChain().related.size).toBe(0)
    expect(model.selectionChain().edgeKeys.size).toBe(0)
    for (const edge of model.graph().edges)
      expect(model.selectionChain().includesProjected(edge)).toBe(false)
    stop()
  })
})

test('projected chain highlighting preserves hidden paths but rejects ancestor-to-descendant bypasses', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('visible root', '1', 10),
      span('hidden ancestor', '2', 20, ['1']),
      span('visible selected', '3', 30, ['2']),
      span('hidden descendant', '4', 40, ['3', '6']),
      span('visible tail', '5', 50, ['4']),
      span('hidden bypass', '6', 60, ['2']),
    ])
    notify()
    const model = admin.causal
    model.select(
      model.ordered
        .array()
        .find((row) => row.record().name === 'visible selected')!,
    )
    admin.filterName.set('visible')
    notify()
    const chain = model.selectionChain(),
      edges = [...model.buses().edgeByKey.values()]
    expect(chainNames(model, chain.related)).toEqual([
      'hidden ancestor',
      'hidden descendant',
      'visible root',
      'visible tail',
    ])
    expect(chainEdgeNames(model, edges)).toEqual([
      'visible root→visible selected',
      'visible root→visible tail',
      'visible selected→visible tail',
    ])
    expect(
      chainEdgeNames(model, edges.filter(chain.includesProjected)),
    ).toEqual([
      'visible root→visible selected',
      'visible selected→visible tail',
    ])
    expect(model.visible().size).toBe(3)
    admin.disposeModel()
  })
})

test('a hidden selected event highlights its projected path while direct-wins bypasses stay unhighlighted', () => {
  for (const direct of [false, true]) {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    ADMIN_FRAME.run(() => {
      admin.ingest([
        span('visible root', '1', 10),
        span('hidden ancestor', '2', 20, ['1']),
        span('hidden selected', '3', 30, ['2']),
        span('hidden descendant', '4', 40, ['3', '6']),
        span('visible tail', '5', 50, direct ? ['4', '1'] : ['4']),
        span('hidden bypass', '6', 60, ['2']),
      ])
      notify()
      const model = admin.causal
      model.select(
        model.ordered
          .array()
          .find((row) => row.record().name === 'hidden selected')!,
      )
      admin.filterName.set('visible')
      notify()
      const chain = model.selectionChain(),
        edges = [...model.buses().edgeByKey.values()]
      expect(model.hiddenSelection()).toBe(true)
      expect(edges).toHaveLength(1)
      expect(chain.includesProjected(edges[0]!)).toBe(!direct)
      expect(edges[0]!.hidden.includes(chain.chosen!)).toBe(!direct)
      expect(chainNames(model, chain.related)).toEqual([
        'hidden ancestor',
        'hidden descendant',
        'visible root',
        'visible tail',
      ])
      admin.disposeModel()
    })
  }
})

test('deep selected chains use iterative traversal without changing event rows', () => {
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
  ADMIN_FRAME.run(() => {
    admin.ingest(
      Array.from({ length: 12_000 }, (_, index) =>
        span(
          `event ${index}`,
          String(index),
          index * 10,
          index ? [String(index - 1)] : [],
        ),
      ),
    )
    notify()
    const rows = admin.causal.ordered.array()
    admin.causal.select(rows[6_000]!)
    const chain = admin.causal.selectionChain()
    expect(chain.ancestors.size).toBe(6_000)
    expect(chain.descendants.size).toBe(5_999)
    expect(chain.edgeKeys.size).toBe(11_999)
    expect(admin.causal.ordered.array()).toBe(rows)
    expect(admin.causal.visible().size).toBe(12_000)
    admin.disposeModel()
  })
})
