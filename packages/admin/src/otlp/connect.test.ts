import {
  action,
  notify,
  sleep,
  top,
  withLocalStorage,
  wrap,
} from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { afterEach, expect, test, vi } from 'test'

import { canPersistToLocalStorage } from '../filters/persistence'
import { ADMIN_FRAME } from '../root'
import { adminSettings, resetAdminSettings } from '../view/settings'
import {
  ADMIN_CLEAR_UNDO_MS,
  connectAdmin,
  type AdminOtelInstance,
  type AdminOtelOptionsSnapshot,
  type AdminOtelStats,
} from './connect'
import { localValuesOf, type AdminLocalValues } from './ingest.ts'

const WARN_CONTEXT_LOSS_KEY = '_Admin.settings.tracing.otel.warnContextLoss.v1'
const SPLIT_LONG_TRACES_KEY = '_Admin.settings.tracing.otel.splitLongTraces.v1'

const emptyStats = (): AdminOtelStats => ({
  queued: 1,
  inFlight: 2,
  exported: 3,
  dropped: 4,
  droppedByReason: { capacity: 1 },
  transportQuarantined: false,
})

const span = (name: string, spanId: string) => ({
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  spanId,
  name,
  startTimeUnixNano: '1000000000000000',
  endTimeUnixNano: '1000000001000000',
})

type FakeOptions = AdminOtelOptionsSnapshot & {
  serviceName?: string
  serviceVersion?: string
  environment?: string
  resource?: Record<string, unknown>
  maxQueueSize?: number
}

function createFake(
  init: Partial<FakeOptions> = {},
  localValuesOfRecord?: (record: unknown) => AdminLocalValues | undefined,
) {
  let windowRecords: unknown[] = []
  const {
    serviceName = 'demo',
    serviceVersion,
    environment,
    resource,
    maxQueueSize: recordLimit = 1000,
    ...live
  } = init
  let options: AdminOtelOptionsSnapshot = { endpoint: null, ...live }
  let currentStats = emptyStats()
  const statsListeners = new Set<(stats: AdminOtelStats) => void>()
  const listeners = new Set<(records: readonly unknown[]) => void>()
  const calls: string[] = []
  const roots: object[] = []
  const note = (name: string) => {
    calls.push(name)
    roots.push(top().root)
  }
  const emit = () => {
    for (const listener of [...listeners]) listener(windowRecords)
  }
  const otel: AdminOtelInstance = Object.assign(() => options, {
    resource: {
      'service.name': serviceName,
      ...(serviceVersion ? { 'service.version': serviceVersion } : {}),
      ...(environment ? { 'deployment.environment.name': environment } : {}),
      ...resource,
    },
    recordLimit,
    records: Object.assign(() => windowRecords.slice(), {
      subscribe(listener: (records: readonly unknown[]) => void) {
        note('subscribe')
        listeners.add(listener)
        listener(windowRecords)
        return () => {
          note('unsubscribe')
          listeners.delete(listener)
        }
      },
    }),
    clearRecords() {
      note('clearRecords')
      windowRecords = []
      emit()
    },
    set(
      update:
        | AdminOtelOptionsSnapshot
        | ((current: AdminOtelOptionsSnapshot) => AdminOtelOptionsSnapshot),
    ) {
      note('set')
      options = typeof update === 'function' ? update(options) : update
    },
    stats: Object.assign(
      () => {
        note('stats')
        return currentStats
      },
      {
        subscribe(listener: (stats: AdminOtelStats) => void) {
          note('stats.subscribe')
          statsListeners.add(listener)
          listener(currentStats)
          return () => {
            note('stats.unsubscribe')
            statsListeners.delete(listener)
          }
        },
      },
    ),
    ...(localValuesOfRecord
      ? {
          localValuesOf(record: unknown) {
            note('localValuesOf')
            return localValuesOfRecord(record)
          },
        }
      : {}),
  })
  return {
    otel,
    setStats(next: AdminOtelStats) {
      currentStats = next
      for (const listener of statsListeners) listener(next)
    },
    calls,
    roots,
    push(...items: unknown[]) {
      windowRecords = [...windowRecords, ...items]
      emit()
    },
    replace(next: unknown[]) {
      windowRecords = next
      emit()
    },
    get options() {
      return options
    },
    get window() {
      return windowRecords
    },
  }
}

const names = (connection: ReturnType<typeof connectAdmin>) =>
  ADMIN_FRAME.run(() => connection.admin.records().map((record) => record.name))

const disposers: Array<() => void> = []

const localWork = () =>
  ADMIN_FRAME.run(() => adminSettings().localWorkOptions())

const clearTracingPersist = () => {
  if (typeof globalThis.localStorage !== 'undefined') {
    localStorage.removeItem(WARN_CONTEXT_LOSS_KEY)
    localStorage.removeItem(SPLIT_LONG_TRACES_KEY)
  }
  ADMIN_FRAME.run(() => {
    const storage = withLocalStorage.storageAtom()
    storage.cache.delete(WARN_CONTEXT_LOSS_KEY)
    storage.cache.delete(SPLIT_LONG_TRACES_KEY)
    storage.clear?.({ key: WARN_CONTEXT_LOSS_KEY })
    storage.clear?.({ key: SPLIT_LONG_TRACES_KEY })
  })
}

const readPersist = (key: string) =>
  ADMIN_FRAME.run(() => {
    const record = withLocalStorage.storageAtom().get({ key })
    if (record === null || record instanceof Promise) return undefined
    return record.data
  })

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  resetAdminSettings()
  clearTracingPersist()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const connect = (
  fake: ReturnType<typeof createFake>,
  options?: Parameters<typeof connectAdmin>[1],
) => {
  const connection = connectAdmin(fake.otel, options)
  disposers.push(() => connection.dispose())
  return connection
}

const flush = () => {
  vi.advanceTimersByTime(1)
}

test('binds otel calls to the caller frame and batches the identity delta', () => {
  vi.useFakeTimers()
  const fake = createFake()
  const appRoot = top().root
  const connection = connect(fake)
  const first = span('first', 's1')
  const second = span('second', 's2')
  fake.push(first)
  fake.push(second)
  expect(names(connection)).toEqual([])
  flush()
  expect(names(connection)).toEqual(['first', 'second'])
  fake.push(span('third', 's3'))
  fake.replace(fake.window)
  flush()
  expect(names(connection)).toEqual(['first', 'second', 'third'])
  expect(fake.calls).toContain('subscribe')
  expect(fake.calls).toContain('stats')
  expect(fake.roots.every((root) => root === appRoot)).toBe(true)
  expect(fake.roots).not.toContain(ADMIN_FRAME.root)
  const stats = ADMIN_FRAME.run(() => connection.stats())
  expect(stats).toEqual(emptyStats())
})

test('turns keepRecords on only when an endpoint is set, without backfilling', () => {
  vi.useFakeTimers()
  const kept = createFake()
  const prior = span('already', 'old')
  kept.push(prior)
  const keptWindow = kept.window
  const live = connect(kept)
  flush()
  expect(kept.options.keepRecords).toBeUndefined()
  expect(kept.options.localValues).toBe(true)
  expect(kept.calls.filter((call) => call === 'set')).toEqual(['set', 'set'])
  expect(kept.window).toBe(keptWindow)
  expect(names(live)).toEqual(['already'])

  const exported = createFake({
    endpoint: 'https://collector.example/v1/traces',
    serviceVersion: '1.2.3',
    keepRecords: false,
  })
  const before = exported.window.slice()
  const connection = connect(exported)
  expect(exported.calls[0]).toBe('set')
  expect(exported.calls[1]).toBe('set')
  expect(exported.calls[2]).toBe('set')
  expect(exported.calls[3]).toBe('subscribe')
  expect(exported.options.keepRecords).toBe(true)
  expect(exported.options.localValues).toBe(true)
  expect(exported.options.endpoint).toBe('https://collector.example/v1/traces')
  expect(exported.otel.resource['service.version']).toBe('1.2.3')
  expect(exported.window).toEqual(before)
  connection.dispose()
  expect(exported.options.keepRecords).toBe(false)
  expect(exported.options.localValues).toBeUndefined()
  expect(exported.calls).toContain('unsubscribe')
})

test('subscribes to delivery stats without waiting for another record', () => {
  const fake = createFake()
  const connection = connect(fake)
  const delivered = { ...emptyStats(), queued: 0, exported: 12 }
  fake.setStats(delivered)
  expect(ADMIN_FRAME.run(() => connection.stats())).toEqual(delivered)
  connection.dispose()
  expect(fake.calls).toContain('stats.unsubscribe')
  fake.setStats({ ...delivered, exported: 20 })
  expect(ADMIN_FRAME.run(() => connection.stats())).toEqual(delivered)
})

test('connects a native telemetry atom and follows its readonly record stream', async () => {
  const otel = reatomOpentelemetry({
    name: 'admin-native-atom',
    endpoint: null,
    serviceName: 'native-app',
  })
  const connection = connectAdmin(otel, { tracingSettings: false })
  try {
    action(() => 'saved', 'nativeApp.save')()
    notify()
    await wrap(sleep(0))
    expect(names(connection)).toContain('nativeApp.save')
    expect(ADMIN_FRAME.run(() => connection.stats())).toEqual(otel.stats())
    expect(otel().localValues).toBe(true)
  } finally {
    connection.dispose()
    expect(otel().localValues).toBe(false)
    otel.dispose()
  }
})

test('pause holds the window and resume ingests it; replay still ingests', () => {
  vi.useFakeTimers()
  const fake = createFake()
  const connection = connect(fake)
  flush()
  connection.pause()
  expect(ADMIN_FRAME.run(() => connection.paused())).toBe(true)
  fake.push(span('waiting', 'w'))
  flush()
  expect(names(connection)).toEqual([])
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(1)
  ADMIN_FRAME.run(() => connection.admin.ingest([span('replay', 'r')]))
  expect(names(connection)).toEqual(['replay'])
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(1)
  connection.resume()
  flush()
  expect(names(connection)).toEqual(['replay', 'waiting'])
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(0)
  expect(ADMIN_FRAME.run(() => connection.paused())).toBe(false)
})

test('clear calls clearRecords, and undo merges the snapshot until the toast expires', () => {
  vi.useFakeTimers()
  const fake = createFake({
    serviceName: 'shop',
    serviceVersion: '9',
    environment: 'prod',
    resource: { 'service.instance.id': 'tab-1' },
  })
  const connection = connect(fake)
  fake.push(span('kept', 'k'))
  flush()
  const stamped = ADMIN_FRAME.run(() => connection.admin.records()[0]!)
  expect(stamped.resource).toEqual({
    'service.name': 'shop',
    'service.version': '9',
    'deployment.environment.name': 'prod',
    'service.instance.id': 'tab-1',
  })
  connection.clear()
  expect(fake.calls).toContain('clearRecords')
  expect(names(connection)).toEqual([])
  expect(ADMIN_FRAME.run(() => connection.canUndo())).toBe(true)
  fake.push(span('after', 'a'))
  flush()
  expect(names(connection)).toEqual(['after'])
  connection.undo()
  expect(names(connection)).toEqual(['kept', 'after'])
  expect(ADMIN_FRAME.run(() => connection.canUndo())).toBe(false)
  connection.undo()
  expect(names(connection)).toEqual(['kept', 'after'])

  connection.clear()
  expect(ADMIN_FRAME.run(() => connection.canUndo())).toBe(true)
  vi.advanceTimersByTime(ADMIN_CLEAR_UNDO_MS)
  expect(ADMIN_FRAME.run(() => connection.canUndo())).toBe(false)
  connection.undo()
  expect(names(connection)).toEqual([])
})

test('replay and remote clear leave the app sink and skip live ingest', () => {
  vi.useFakeTimers()
  const fake = createFake()
  const connection = connect(fake)
  fake.push(span('live', 'live'))
  flush()
  expect(names(connection)).toEqual(['live'])

  ADMIN_FRAME.run(() => connection.admin.source.set('replay'))
  fake.push(span('during-replay', 'replay'))
  flush()
  expect(names(connection)).toEqual(['live'])
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(1)
  expect(fake.window).toHaveLength(2)

  connection.clear()
  expect(fake.calls).not.toContain('clearRecords')
  expect(fake.window).toHaveLength(2)
  expect(names(connection)).toEqual([])
  expect(ADMIN_FRAME.run(() => connection.admin.source())).toBe('replay')
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(1)

  ADMIN_FRAME.run(() => connection.admin.source.set('remote'))
  fake.push(span('during-remote', 'remote'))
  flush()
  expect(names(connection)).toEqual([])
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(2)
  connection.clear()
  expect(fake.calls).not.toContain('clearRecords')
  expect(fake.window).toHaveLength(3)
  flush()
  expect(ADMIN_FRAME.run(() => connection.admin.source())).toBe('live')
  expect(names(connection)).toEqual(['during-replay', 'during-remote'])
  expect(ADMIN_FRAME.run(() => connection.waiting())).toBe(0)
})

test('flags older records dropped when the remembered record leaves a full window', () => {
  vi.useFakeTimers()
  const fake = createFake({ maxQueueSize: 2 })
  const connection = connect(fake)
  const first = span('first', 's1')
  const second = span('second', 's2')
  fake.push(first, second)
  flush()
  fake.replace([span('third', 's3'), span('fourth', 's4')])
  flush()
  expect(ADMIN_FRAME.run(() => connection.olderRecordsDropped())).toBe(true)
  expect(names(connection)).toEqual(['first', 'second', 'third', 'fourth'])
  connection.clear()
  expect(ADMIN_FRAME.run(() => connection.olderRecordsDropped())).toBe(false)
})

test('uses a timer while the document is hidden and cancels it on dispose', () => {
  vi.useFakeTimers()
  const raf = vi.fn()
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('document', { hidden: true })
  const fake = createFake()
  const connection = connect(fake)
  fake.push(span('hidden', 'h'))
  expect(raf).not.toHaveBeenCalled()
  flush()
  expect(names(connection)).toEqual(['hidden'])
  fake.push(span('late', 'l'))
  connection.dispose()
  flush()
  expect(names(connection)).toEqual(['hidden'])
})

test('prevents Escape when the composed path contains the host', () => {
  vi.useFakeTimers()
  const listeners: Array<{
    type: string
    fn: EventListener
    capture: boolean
  }> = []
  vi.stubGlobal('window', {
    addEventListener(type: string, fn: EventListener, capture?: boolean) {
      listeners.push({ type, fn, capture: capture === true })
    },
    removeEventListener(type: string, fn: EventListener, capture?: boolean) {
      const index = listeners.findIndex(
        (entry) =>
          entry.type === type &&
          entry.fn === fn &&
          entry.capture === (capture === true),
      )
      if (index !== -1) listeners.splice(index, 1)
    },
  })
  const fake = createFake()
  const headless = connect(fake)
  expect(listeners).toEqual([])
  const host = { hidden: false } as HTMLElement
  headless.setHost(host)
  expect(listeners).toEqual([
    expect.objectContaining({ type: 'keydown', capture: true }),
  ])
  const preventDefault = vi.fn()
  listeners[0]!.fn({
    key: 'Escape',
    composedPath: () => [host],
    preventDefault,
  } as unknown as Event)
  expect(preventDefault).toHaveBeenCalledTimes(1)
  const outside = vi.fn()
  listeners[0]!.fn({
    key: 'Escape',
    composedPath: () => [],
    preventDefault: outside,
  } as unknown as Event)
  expect(outside).not.toHaveBeenCalled()
  listeners[0]!.fn({
    key: 'Enter',
    composedPath: () => [host],
    preventDefault: outside,
  } as unknown as Event)
  expect(outside).not.toHaveBeenCalled()
  headless.hide()
  expect(host.hidden).toBe(true)
  headless.show()
  expect(host.hidden).toBe(false)
  headless.dispose()
  expect(listeners).toEqual([])
})

test('writes localValues on connect, restores it on dispose, and stops attaching when turned off', () => {
  vi.useFakeTimers()
  const live = new Map<unknown, AdminLocalValues>()
  const previous = createFake({ localValues: 'all' }, (record) =>
    live.get(record),
  )
  const connection = connect(previous)
  expect(previous.options.localValues).toBe(true)
  expect(ADMIN_FRAME.run(() => connection.localValues())).toBe(true)

  const secret = 'live-secret-token'
  const first = {
    ...span('first', 's1'),
    attributes: { 'reatom.payload': '"***"', 'reatom.params': '["***"]' },
  }
  live.set(first, { payload: { token: secret }, params: [secret] })
  previous.push(first)
  flush()
  const attached = ADMIN_FRAME.run(() => connection.admin.records()[0]!)
  expect(localValuesOf(attached)?.payload).toEqual({ token: secret })
  expect(previous.calls).toContain('localValuesOf')
  expect(previous.roots.every((root) => root === top().root)).toBe(true)

  ADMIN_FRAME.run(() => {
    connection.localValues.set(false)
    notify()
  })
  expect(previous.options.localValues).toBe(false)
  expect(localValuesOf(attached)?.payload).toEqual({ token: secret })

  const second = {
    ...span('second', 's2'),
    attributes: { 'reatom.payload': '"***"' },
  }
  live.set(second, { payload: { token: 'second-secret' } })
  previous.push(second)
  flush()
  const records = ADMIN_FRAME.run(() => connection.admin.records())
  expect(localValuesOf(records[0]!)?.payload).toEqual({ token: secret })
  expect(localValuesOf(records[1]!)).toBeUndefined()

  connection.dispose()
  expect(previous.options.localValues).toBe('all')
})

test('an instance without localValuesOf still accepts the localValues atom', () => {
  vi.useFakeTimers()
  const fake = createFake()
  const connection = connect(fake, { localValues: 'all' })
  expect(fake.options.localValues).toBe('all')
  expect(ADMIN_FRAME.run(() => connection.localValues())).toBe('all')
  fake.push(span('plain', 'p1'))
  flush()
  const record = ADMIN_FRAME.run(() => connection.admin.records()[0]!)
  expect(localValuesOf(record)).toBeUndefined()
  expect(record.name).toBe('plain')
  connection.dispose()
  expect(fake.options.localValues).toBeUndefined()
})

test('writes tracing options on connect from the instance, defaulting warn to on', () => {
  vi.useFakeTimers()
  const unspecified = createFake()
  const unspecifiedConnection = connect(unspecified)
  expect(unspecified.options.warnContextLoss).toBe(true)
  expect(unspecified.options.maxSpansPerTrace).toBeUndefined()
  expect(unspecified.options.maxTraceMs).toBeUndefined()
  expect(ADMIN_FRAME.run(() => unspecifiedConnection.warnContextLoss())).toBe(
    true,
  )
  expect(ADMIN_FRAME.run(() => unspecifiedConnection.splitLongTraces())).toBe(
    true,
  )
  expect(localWork()).toEqual([
    expect.objectContaining({
      id: 'otel.warnContextLoss',
      label: 'Warn about lost trace context',
      description:
        'Print one console warning when a callback without wrap starts a new trace.',
      checked: unspecifiedConnection.warnContextLoss,
    }),
    expect.objectContaining({
      id: 'otel.splitLongTraces',
      label: 'Split long traces',
      description:
        'Start a linked trace when one reaches the tracer span or age limit (1,000 spans or 60 seconds by default), so a poller does not grow one trace forever.',
      checked: unspecifiedConnection.splitLongTraces,
    }),
  ])

  const custom = createFake({
    warnContextLoss: false,
    maxSpansPerTrace: 250,
    maxTraceMs: 5_000,
  })
  const customConnection = connect(custom)
  expect(custom.options.warnContextLoss).toBe(false)
  expect(custom.options.maxSpansPerTrace).toBe(250)
  expect(custom.options.maxTraceMs).toBe(5_000)
  expect(ADMIN_FRAME.run(() => customConnection.warnContextLoss())).toBe(false)
  expect(ADMIN_FRAME.run(() => customConnection.splitLongTraces())).toBe(true)
})

test('toggling tracing switches writes warnContextLoss and trace limits', () => {
  vi.useFakeTimers()
  const fake = createFake({
    warnContextLoss: false,
    maxSpansPerTrace: 250,
    maxTraceMs: 5_000,
  })
  const connection = connect(fake)
  ADMIN_FRAME.run(() => {
    connection.warnContextLoss.set(true)
    connection.splitLongTraces.set(false)
    notify()
  })
  expect(fake.options.warnContextLoss).toBe(true)
  expect(fake.options.maxSpansPerTrace).toBe(Infinity)
  expect(fake.options.maxTraceMs).toBe(Infinity)

  ADMIN_FRAME.run(() => {
    connection.splitLongTraces.set(true)
    notify()
  })
  expect(fake.options.warnContextLoss).toBe(true)
  expect(fake.options.maxSpansPerTrace).toBe(250)
  expect(fake.options.maxTraceMs).toBe(5_000)
})

test('dispose restores tracing options and unregisters the switches', () => {
  vi.useFakeTimers()
  const custom = createFake({
    warnContextLoss: false,
    maxSpansPerTrace: 250,
    maxTraceMs: 5_000,
  })
  const customConnection = connect(custom)
  ADMIN_FRAME.run(() => {
    customConnection.warnContextLoss.set(true)
    customConnection.splitLongTraces.set(false)
    notify()
  })
  expect(localWork().map((option) => option.id)).toEqual([
    'otel.warnContextLoss',
    'otel.splitLongTraces',
  ])
  customConnection.dispose()
  expect(custom.options.warnContextLoss).toBe(false)
  expect(custom.options.maxSpansPerTrace).toBe(250)
  expect(custom.options.maxTraceMs).toBe(5_000)
  expect(localWork()).toEqual([])

  const fresh = createFake()
  const freshConnection = connect(fresh)
  ADMIN_FRAME.run(() => {
    freshConnection.warnContextLoss.set(false)
    freshConnection.splitLongTraces.set(false)
    notify()
  })
  freshConnection.dispose()
  expect(fresh.options.warnContextLoss).toBeUndefined()
  expect(fresh.options.maxSpansPerTrace).toBeUndefined()
  expect(fresh.options.maxTraceMs).toBeUndefined()
  expect(localWork()).toEqual([])
})

test('persisted tracing switches win over the instance on reconnect', () => {
  vi.useFakeTimers()
  clearTracingPersist()
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => {
      storage.clear()
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  })
  expect(canPersistToLocalStorage()).toBe(true)

  const first = createFake({
    warnContextLoss: true,
    maxSpansPerTrace: 100,
    maxTraceMs: 1_000,
  })
  const firstConnection = connect(first)
  ADMIN_FRAME.run(() => {
    firstConnection.warnContextLoss.set(false)
    firstConnection.splitLongTraces.set(false)
    notify()
  })
  expect(first.options.warnContextLoss).toBe(false)
  expect(first.options.maxSpansPerTrace).toBe(Infinity)
  expect(first.options.maxTraceMs).toBe(Infinity)
  expect(readPersist(WARN_CONTEXT_LOSS_KEY)).toBe(false)
  expect(readPersist(SPLIT_LONG_TRACES_KEY)).toBe(false)
  if (storage.size > 0) {
    expect(storage.get(WARN_CONTEXT_LOSS_KEY)).toContain('false')
    expect(storage.get(SPLIT_LONG_TRACES_KEY)).toContain('false')
  }
  firstConnection.dispose()

  const second = createFake({
    warnContextLoss: true,
    maxSpansPerTrace: 100,
    maxTraceMs: 1_000,
  })
  const secondConnection = connect(second)
  expect(ADMIN_FRAME.run(() => secondConnection.warnContextLoss())).toBe(false)
  expect(ADMIN_FRAME.run(() => secondConnection.splitLongTraces())).toBe(false)
  expect(second.options.warnContextLoss).toBe(false)
  expect(second.options.maxSpansPerTrace).toBe(Infinity)
  expect(second.options.maxTraceMs).toBe(Infinity)
})

test('tracingSettings: false skips the switches and leaves otel options untouched', () => {
  vi.useFakeTimers()
  const fake = createFake({
    warnContextLoss: false,
    maxSpansPerTrace: 4,
    maxTraceMs: 5,
  })
  const connection = connect(fake, { tracingSettings: false })
  expect(fake.options.warnContextLoss).toBe(false)
  expect(fake.options.maxSpansPerTrace).toBe(4)
  expect(fake.options.maxTraceMs).toBe(5)
  expect(localWork()).toEqual([])
  expect(ADMIN_FRAME.run(() => connection.warnContextLoss())).toBe(false)
  expect(ADMIN_FRAME.run(() => connection.splitLongTraces())).toBe(true)
  ADMIN_FRAME.run(() => {
    connection.warnContextLoss.set(true)
    connection.splitLongTraces.set(false)
    notify()
  })
  expect(fake.options.warnContextLoss).toBe(false)
  expect(fake.options.maxSpansPerTrace).toBe(4)
  expect(fake.options.maxTraceMs).toBe(5)
  connection.dispose()
  expect(fake.options.warnContextLoss).toBe(false)
  expect(fake.options.maxSpansPerTrace).toBe(4)
  expect(fake.options.maxTraceMs).toBe(5)
  expect(fake.options.localValues).toBeUndefined()
})

test('disposing an older connection keeps the newer tracing switches', () => {
  vi.useFakeTimers()
  const older = createFake({ warnContextLoss: false })
  const newer = createFake({
    warnContextLoss: true,
    maxSpansPerTrace: 8,
    maxTraceMs: 9,
  })
  const olderConnection = connect(older)
  const olderOptions = localWork()
  expect(olderOptions.map((option) => option.id)).toEqual([
    'otel.warnContextLoss',
    'otel.splitLongTraces',
  ])

  const newerConnection = connect(newer)
  const newerOptions = localWork()
  expect(newerOptions).toHaveLength(2)
  expect(newerOptions[0] === olderOptions[0]).toBe(false)
  expect(newerOptions[1] === olderOptions[1]).toBe(false)
  expect(newerOptions[0]?.checked).toBe(newerConnection.warnContextLoss)
  expect(newerOptions[1]?.checked).toBe(newerConnection.splitLongTraces)

  olderConnection.dispose()
  expect(localWork()[0]).toBe(newerOptions[0])
  expect(localWork()[1]).toBe(newerOptions[1])
  expect(older.options.warnContextLoss).toBe(false)
  expect(newer.options.warnContextLoss).toBe(true)
  expect(newer.options.maxSpansPerTrace).toBe(8)
  expect(newer.options.maxTraceMs).toBe(9)

  newerConnection.dispose()
  expect(localWork()).toEqual([])
  expect(newer.options.warnContextLoss).toBe(true)
  expect(newer.options.maxSpansPerTrace).toBe(8)
  expect(newer.options.maxTraceMs).toBe(9)
})
