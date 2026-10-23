import {
  action,
  atom,
  computed,
  context,
  effect,
  sleep,
  wrap,
} from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import type { TransportBatch } from './sendTraces.ts'
import { otlpTransport } from './sendTraces.ts'
import { reatomTestTelemetry } from './test-helpers.ts'
import { installDomStubs, withWarnSpy } from './test-helpers.ts'

type V2FactoryInput = Parameters<typeof reatomTestTelemetry>[0] & {
  name: string
  endpoint: string | null
}

type V2Instance = ReturnType<typeof reatomTestTelemetry> & {
  records: () => readonly unknown[]
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const start = (overrides: Partial<V2FactoryInput> = {}) => {
  const fetchMock = vi.fn<typeof globalThis.fetch>(
    async () => new Response('{}', { status: 200 }),
  )
  const otel = reatomTestTelemetry({
    name: 'instance-v2',
    endpoint: null,
    serviceName: 'instance-v2',
    batchInterval: 100_000,
    maxBatchSize: 100,
    maxQueueSize: 100,
    fetch: fetchMock,
    useBeacon: false,
    ...overrides,
  } as Parameters<typeof reatomTestTelemetry>[0]) as V2Instance
  cleanups.push(() => context.start(() => otel.dispose()))
  return { otel, fetchMock }
}

const readRecords = (
  otel: Pick<ReturnType<typeof reatomOpentelemetry>, 'records'>,
): readonly unknown[] => {
  expect(typeof otel.records).toBe('function')
  const snapshot = otel.records()
  expect(Array.isArray(snapshot)).toBe(true)
  return snapshot
}

const visitRecords = (value: unknown, visit: (record: object) => void) => {
  if (value === null || typeof value !== 'object') return
  visit(value)
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visit)
    return
  }
  for (const nested of Object.values(value)) visitRecords(nested, visit)
}

const recordSpanIds = (records: readonly unknown[]): Set<string> => {
  const ids = new Set<string>()
  visitRecords(records, (record) => {
    const spanId = 'spanId' in record ? record.spanId : undefined
    if (typeof spanId === 'string' && spanId.length > 0) ids.add(spanId)
  })
  return ids
}

const recordNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  visitRecords(records, (record) => {
    const spanId = 'spanId' in record ? record.spanId : undefined
    const name = 'name' in record ? record.name : undefined
    if (typeof spanId === 'string' && typeof name === 'string') names.push(name)
  })
  return names
}

const disjointIds = (left: Set<string>, right: Set<string>) =>
  [...left].filter((id) => right.has(id))

const capturedStringAttrs = (span: object): Record<string, string> =>
  'attributes' in span ? (span.attributes as Record<string, string>) : {}

const successSpanFrom = (records: readonly unknown[]): object | undefined => {
  let found: object | undefined
  visitRecords(records, (record) => {
    if (found) return
    const spanId = 'spanId' in record ? record.spanId : undefined
    if (typeof spanId !== 'string') return
    const attrs = capturedStringAttrs(record)
    if (attrs['reatom.outcome'] === 'ok') found = record
  })
  return found
}

const storageKeyList = (store: Storage | undefined) => {
  if (!store) return []
  return Array.from({ length: store.length }, (_, i) => store.key(i) ?? '')
}

test('F-01: missing name throws a config error', () => {
  expect(() =>
    reatomTestTelemetry({
      endpoint: null,
      serviceName: 'missing-name',
    } as Parameters<typeof reatomTestTelemetry>[0]),
  ).toThrow(/name/)
})

test('F-01: local capture does not require an endpoint or exporter', () => {
  const otel = reatomOpentelemetry({
    name: 'shop',
    serviceName: 'local',
    skipGlobalExtension: true,
  })
  try {
    otel.log('local.without-endpoint')
    expect('otlp' in otel).toBe(false)
    expect(otel.records()).toHaveLength(2)
    expect(otel.records()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'span', name: 'app.session' }),
        expect.objectContaining({
          type: 'log',
          eventName: 'local.without-endpoint',
        }),
      ]),
    )
    expect(otel.stats()).toMatchObject({ captured: 2, retained: 2 })
  } finally {
    otel.dispose()
  }
})

test('F-01: two unspecialized instances keep disjoint records and stats', () => {
  const host = start({
    name: 'app',
    endpoint: null,
    serviceName: 'host-app',
  })
  const widget = start({
    name: 'widget',
    endpoint: null,
    serviceName: 'widget-app',
  })

  context.start(() => {
    expect(action(() => 'shared-ok', 'shared.work')()).toBe('shared-ok')

    const hostRecords = readRecords(host.otel)
    const widgetRecords = readRecords(widget.otel)
    const hostIds = recordSpanIds(hostRecords)
    const widgetIds = recordSpanIds(widgetRecords)
    const hostStats = host.otel.otlp.stats()
    const widgetStats = widget.otel.otlp.stats()

    expect(hostIds.size).toBeGreaterThan(0)
    expect(widgetIds.size).toBeGreaterThan(0)
    expect(disjointIds(hostIds, widgetIds)).toEqual([])
    expect(recordNames(hostRecords)).toContain('shared.work')
    expect(recordNames(widgetRecords)).toContain('shared.work')
    expect(hostStats).not.toBe(widgetStats)
    expect(
      hostStats.queued + hostStats.exported + hostStats.dropped,
    ).toBeGreaterThan(0)
    expect(
      widgetStats.queued + widgetStats.exported + widgetStats.dropped,
    ).toBeGreaterThan(0)

    const widgetQueued = widgetStats.queued
    const widgetExported = widgetStats.exported
    const widgetDropped = widgetStats.dropped
    host.otel.dispose()
    expect(widget.otel.otlp.stats()).toMatchObject({
      queued: widgetQueued,
      exported: widgetExported,
      dropped: widgetDropped,
    })
  })

  expect(host.fetchMock).not.toHaveBeenCalled()
  expect(widget.fetchMock).not.toHaveBeenCalled()
  expect(storageKeyList(globalThis.localStorage).join('\n')).not.toMatch(
    /visitor|session/i,
  )
  expect(storageKeyList(globalThis.sessionStorage).join('\n')).not.toMatch(
    /visitor|session/i,
  )
})

test('F-01: local capture makes no network calls and fills records', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  const otel = reatomOpentelemetry({
    name: 'devtools',
    serviceName: 'devtools',
  })
  cleanups.push(() => {
    otel.dispose()
    fetchMock.mockRestore()
  })
  expect('otlp' in otel).toBe(false)
  const ping = action(() => 'pong', 'devtools.ping')

  context.start(() => {
    expect(ping()).toBe('pong')
    expect(recordNames(readRecords(otel))).toContain('devtools.ping')
    expect(recordSpanIds(readRecords(otel)).size).toBeGreaterThan(0)
    const success = successSpanFrom(readRecords(otel))
    expect(success).toBeDefined()
    expect(capturedStringAttrs(success!)).toMatchObject({
      'reatom.name': 'devtools.ping',
      'reatom.kind': 'action',
      'reatom.outcome': 'ok',
    })
  })
  await context.start(() => otel.flush())

  expect(fetchMock).not.toHaveBeenCalled()
})

test('F-01: creating an instance without window does not crash', async () => {
  const globalObject = globalThis as {
    window?: unknown
    document?: unknown
  }
  const hadWindow = 'window' in globalThis
  const hadDocument = 'document' in globalThis
  const windowRef = globalObject.window
  const documentRef = globalObject.document
  const windowSpy =
    windowRef &&
    typeof windowRef === 'object' &&
    'addEventListener' in windowRef
      ? vi.spyOn(windowRef as Window, 'addEventListener')
      : undefined
  const documentSpy =
    documentRef &&
    typeof documentRef === 'object' &&
    'addEventListener' in documentRef
      ? vi.spyOn(documentRef as Document, 'addEventListener')
      : undefined
  try {
    delete globalObject.window
    delete globalObject.document
    expect(typeof window).toBe('undefined')

    const { otel, fetchMock } = start({
      name: 'ssr',
      endpoint: null,
    })
    const listenerTypes = [
      ...(windowSpy?.mock.calls.map(([type]) => String(type)) ?? []),
      ...(documentSpy?.mock.calls.map(([type]) => String(type)) ?? []),
    ]
    expect(listenerTypes).not.toContain('visibilitychange')
    expect(listenerTypes).not.toContain('pagehide')
    const ping = action(() => 'ok', 'ssr.ping')
    context.start(() => {
      expect(ping()).toBe('ok')
      expect(recordNames(readRecords(otel))).toContain('ssr.ping')
    })
    await context.start(() => otel.flush())
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    windowSpy?.mockRestore()
    documentSpy?.mockRestore()
    if (hadWindow) globalObject.window = windowRef
    else delete globalObject.window
    if (hadDocument) globalObject.document = documentRef
    else delete globalObject.document
  }
})

test('F-07: a duplicate live name warns once in dev naming both creation sites', async () => {
  await withWarnSpy((warn) => {
    function createFirstLiveAppInstance() {
      return start({ name: 'app', serviceName: 'first-site' })
    }
    function createSecondLiveAppInstance() {
      return start({ name: 'app', serviceName: 'second-site' })
    }

    const first = createFirstLiveAppInstance()
    const second = createSecondLiveAppInstance()

    expect(warn).toHaveBeenCalledTimes(1)
    const rendered = warn.mock.calls
      .flat()
      .map((arg) =>
        arg instanceof Error ? (arg.stack ?? arg.message) : String(arg),
      )
      .join('\n')
    expect(rendered).toContain('app')
    expect(rendered).toContain('createFirstLiveAppInstance')
    expect(rendered).toContain('createSecondLiveAppInstance')

    const ping = action(() => 'ok', 'app.after-replace')
    context.start(() => {
      expect(ping()).toBe('ok')
      expect(readRecords(first.otel)).toEqual([])
      expect(recordNames(readRecords(second.otel))).toContain(
        'app.after-replace',
      )
      expect(recordSpanIds(readRecords(second.otel)).size).toBeGreaterThan(0)
    })
  })
})

test('F-07: two context.start stores keep disjoint records', () => {
  const { otel } = start({ name: 'ssr-requests', endpoint: null })
  const ping = action(() => 'ok', 'ssr-requests.ping')

  const firstIds = context.start(() => {
    expect(ping()).toBe('ok')
    const ids = recordSpanIds(readRecords(otel))
    expect(ids.size).toBeGreaterThan(0)
    return ids
  })
  const secondIds = context.start(() => {
    expect(ping()).toBe('ok')
    const ids = recordSpanIds(readRecords(otel))
    expect(ids.size).toBeGreaterThan(0)
    return ids
  })

  expect(disjointIds(firstIds, secondIds)).toEqual([])
})

test('F-07: empty context.start records() does not include another root’s spanIds', () => {
  const { otel } = start({ name: 'ssr-empty-read', endpoint: null })
  const ping = action(() => 'ok', 'ssr-empty-read.ping')

  const writtenIds = context.start(() => {
    expect(ping()).toBe('ok')
    const ids = recordSpanIds(readRecords(otel))
    expect(ids.size).toBeGreaterThan(0)
    return ids
  })

  const emptyRootIds = context.start(() => recordSpanIds(readRecords(otel)))

  expect(disjointIds(writtenIds, emptyRootIds)).toEqual([])
})

test('F-07: records() after await wrap in an isolated action does not include another root’s spanIds', async () => {
  const { otel } = start({ name: 'ssr-wrap-read', endpoint: null })
  const writeA = action(() => 'a', 'ssr-wrap-read.a')
  const writeBPayload = action(() => 'b', 'ssr-wrap-read.b')
  const writeB = action(async () => {
    expect(writeBPayload()).toBe('b')
    await wrap(Promise.resolve())
    const ids = recordSpanIds(readRecords(otel))
    expect(ids.size).toBeGreaterThan(0)
    return ids
  }, 'ssr-wrap-read.writeB')

  const rootAIds = context.start(() => {
    expect(writeA()).toBe('a')
    const ids = recordSpanIds(readRecords(otel))
    expect(ids.size).toBeGreaterThan(0)
    return ids
  })

  const rootBIds = await context.start(() => wrap(writeB()))

  expect(disjointIds(rootAIds, rootBIds)).toEqual([])
})

test('F-07: dispose with a full queue does not throw into the app', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (error: unknown) => {
    unhandled.push(error)
  }
  process.on('unhandledRejection', onUnhandled)
  const { otel, fetchMock } = start({
    name: 'full-queue',
    endpoint: 'https://collector.invalid',
    keepRecords: true,
    maxQueueSize: 4,
    maxBatchSize: 100,
    retry: { maxRetries: 0 },
  })
  const ping = action(() => 'queued', 'full-queue.ping')
  const work = action(() => 'app-ok', 'full-queue.work')
  try {
    context.start(() => {
      expect(ping()).toBe('queued')
      expect(ping()).toBe('queued')
      expect(ping()).toBe('queued')
      expect(ping()).toBe('queued')
      expect(otel.otlp.stats().queued).toBe(4)
      expect(recordSpanIds(readRecords(otel)).size).toBe(4)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(() => context.start(() => otel.dispose())).not.toThrow()
    expect(readRecords(otel)).toEqual([])
    expect(otel.otlp.stats()).toMatchObject({
      queued: 0,
      inFlight: 0,
    })
    expect(otel.otlp.stats().droppedByReason.disposed).toBeGreaterThanOrEqual(4)
    expect(context.start(() => work())).toBe('app-ok')
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('F-07: offline pauses OTLP posts and coming online resumes', async () => {
  const stubs = installDomStubs()
  const navigatorRef = globalThis.navigator
  const setOnline = (online: boolean) => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { onLine: online },
    })
    stubs.windowListeners.get(online ? 'online' : 'offline')?.()
  }
  setOnline(false)
  const { otel, fetchMock } = start({
    name: 'offline-buffer',
    endpoint: 'https://collector.invalid',
    retry: { maxRetries: 0 },
    exportTimeoutMs: 50,
  })
  const ping = action(() => 'ok', 'offline-buffer.ping')
  try {
    expect(context.start(() => ping())).toBe('ok')
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(otel.otlp.stats().queued).toBeGreaterThan(0)

    setOnline(true)
    await context.start(() => otel.flush())
    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/v1\/traces$/)
  } finally {
    context.start(() => otel.dispose())
    stubs.restore()
    if (navigatorRef === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: navigatorRef,
      })
    }
  }
})

test('F-07: 401 export does not throw into the app', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (error: unknown) => {
    unhandled.push(error)
  }
  process.on('unhandledRejection', onUnhandled)
  const { otel, fetchMock } = start({
    name: 'export-401',
    endpoint: 'https://collector.invalid',
    retry: { maxRetries: 0 },
  })
  fetchMock.mockResolvedValue(new Response('denied', { status: 401 }))
  const ping = action(() => 'ok', 'export-401.ping')
  try {
    expect(context.start(() => ping())).toBe('ok')
    await expect(context.start(() => otel.flush())).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalled()
    expect(unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('F-11: keepRecords copies next to a real endpoint; clearRecords drops the sink', async () => {
  const { otel, fetchMock } = start({
    name: 'keep-records',
    endpoint: 'https://collector.invalid',
    keepRecords: true,
    retry: { maxRetries: 0 },
  })
  const ping = action(() => 'ok', 'keep-records.ping')
  await context.start(async () => {
    expect(ping()).toBe('ok')
    const snapshot = readRecords(otel)
    expect(recordNames(snapshot)).toContain('keep-records.ping')
    await wrap(otel.flush())
    expect(fetchMock).toHaveBeenCalled()
    expect(recordNames(readRecords(otel))).toContain('keep-records.ping')
    otel.clearRecords()
    expect(readRecords(otel)).toEqual([])
    expect(readRecords(otel)).not.toBe(snapshot)
  })
})

test('F-11: a real endpoint without keepRecords does not fill records', async () => {
  const { otel, fetchMock } = start({
    name: 'prod-records',
    endpoint: 'https://collector.invalid',
    retry: { maxRetries: 0 },
  })
  const ping = action(() => 'ok', 'prod-records.ping')
  expect(context.start(() => ping())).toBe('ok')
  await context.start(() => otel.flush())
  expect(fetchMock).toHaveBeenCalled()
  expect(readRecords(otel)).toEqual([])
})

test('F-11: transports fan-out next to the default fetch', async () => {
  const extraBatches: TransportBatch[] = []
  const extra = async (batch: TransportBatch) => {
    extraBatches.push(batch)
    return { accepted: batch.itemCount, rejected: 0 }
  }
  const secondary = otlpTransport({
    endpoint: 'https://secondary.invalid',
    fetch: async () => new Response('{}', { status: 200 }),
  })
  const secondaryCalls: string[] = []
  const { otel, fetchMock } = start({
    name: 'fan-out',
    endpoint: 'https://collector.invalid',
    transports: [
      extra,
      async (batch) => {
        secondaryCalls.push(batch.signal)
        return secondary(batch)
      },
    ],
    retry: { maxRetries: 0 },
  })
  const ping = action(() => 'ok', 'fan-out.ping')
  expect(context.start(() => ping())).toBe('ok')
  await context.start(() => otel.flush())
  expect(fetchMock).toHaveBeenCalled()
  expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/collector\.invalid/)
  expect(extraBatches.map((batch) => batch.signal)).toContain('traces')
  expect(extraBatches[0]?.itemCount).toBeGreaterThan(0)
  expect(secondaryCalls).toContain('traces')
})

type LocalRecord = {
  name?: string
  eventName?: string
  traceId?: string
  spanId?: string
  parentSpanId?: string
  attributes?: Record<string, unknown>
  links?: Array<{
    traceId: string
    spanId: string
    attributes?: Record<string, unknown>
  }>
}

const localRecords = (otel: V2Instance): LocalRecord[] =>
  readRecords(otel).filter(
    (record): record is LocalRecord => !!record && typeof record === 'object',
  )

const stringAttr = (record: LocalRecord, key: string) =>
  record.attributes?.[key]

const spanNamed = (records: readonly LocalRecord[], name: string) =>
  records.find((record) => record.name === name)

const spansNamed = (records: readonly LocalRecord[], name: string) =>
  records.filter((record) => record.name === name)

const updateNamed = (
  records: readonly LocalRecord[],
  eventName: string,
  atomName: string,
) =>
  records.find(
    (record) =>
      record.eventName === eventName &&
      stringAttr(record, 'reatom.name') === atomName,
  )

const linkReasonOf = (record: LocalRecord) =>
  record.links?.[0]?.attributes?.['reatom.link.reason']

test('a computed pulled by a traced reader joins that reader trace', async () => {
  const { otel } = start({
    name: 'probe-reader',
    endpoint: null,
    serviceName: 'probe-reader',
    maxQueueSize: 50,
  })

  context.start(() => {
    const base = atom(1, 'probe.base')
    const doubled = computed(() => base() * 2, 'probe.doubled')
    const reader = action(() => doubled(), 'probe.reader')
    expect(reader()).toBe(2)
  })
  await otel.flush()

  const records = localRecords(otel)
  const readerSpan = spanNamed(records, 'probe.reader')
  const doubled = updateNamed(
    records,
    'reatom.computed.update',
    'probe.doubled',
  )
  expect(readerSpan?.traceId).toEqual(expect.stringMatching(/^[0-9a-f]{32}$/))
  expect(doubled).toMatchObject({
    traceId: readerSpan!.traceId,
    spanId: readerSpan!.spanId,
  })
  expect(stringAttr(doubled!, 'reatom.parent.reason')).toBe('read')
  expect(stringAttr(readerSpan!, 'reatom.parent.reason')).toBe('root')
})

test('an effect created inside an action stays on that action trace', async () => {
  const { otel } = start({
    name: 'probe-effect',
    endpoint: null,
    serviceName: 'probe-effect',
    maxQueueSize: 50,
  })
  const flag = atom(false, 'probe.effect.flag')

  context.start(() => {
    const run = action(() => {
      effect(() => flag(), 'probe.effect')
    }, 'probe.effectRun')
    run()
  })
  await otel.flush()

  const records = localRecords(otel)
  const runSpan = spanNamed(records, 'probe.effectRun')
  const effectUpdate = updateNamed(
    records,
    'reatom.computed.update',
    'probe.effect',
  )
  expect(effectUpdate).toMatchObject({
    traceId: runSpan!.traceId,
    spanId: runSpan!.spanId,
  })
})

test('nested actions record call and a manual trace records explicit', async () => {
  const { otel } = start({
    name: 'probe-reason',
    endpoint: null,
    serviceName: 'probe-reason',
    maxQueueSize: 50,
  })

  context.start(() => {
    const inner = action(() => 'inner', 'probe.reason.inner')
    const outer = action(() => inner(), 'probe.reason.outer')
    expect(outer()).toBe('inner')
    const manual = otel.createTrace({ name: 'probe.manual' })
    otel.traceVar.set(manual)
    const marked = action(() => 'marked', 'probe.reason.explicit')
    expect(marked()).toBe('marked')
  })

  const records = localRecords(otel)
  expect(
    stringAttr(
      spanNamed(records, 'probe.reason.outer')!,
      'reatom.parent.reason',
    ),
  ).toBe('root')
  expect(
    stringAttr(
      spanNamed(records, 'probe.reason.inner')!,
      'reatom.parent.reason',
    ),
  ).toBe('call')
  expect(
    stringAttr(
      spanNamed(records, 'probe.reason.explicit')!,
      'reatom.parent.reason',
    ),
  ).toBe('explicit')
  expect(spanNamed(records, 'probe.reason.explicit')!.traceId).toBe(
    spanNamed(records, 'probe.manual')!.traceId,
  )
})

test('a computed outside any reader records session', async () => {
  const { otel } = start({
    name: 'probe-session',
    endpoint: null,
    serviceName: 'probe-session',
    maxQueueSize: 50,
  })

  context.start(() => {
    const orphan = computed(() => 1, 'probe.orphan')
    expect(orphan()).toBe(1)
  })
  await otel.flush()

  const records = localRecords(otel)
  const update = updateNamed(records, 'reatom.computed.update', 'probe.orphan')
  expect(stringAttr(update!, 'reatom.parent.reason')).toBe('session')
  const session = spanNamed(records, 'app.session')
  if (session) expect(update!.traceId).toBe(session.traceId)
})

test('span budget defaults are 1000 spans and 60000 ms', () => {
  const { otel } = start({
    name: 'probe-budget-defaults',
    endpoint: null,
    serviceName: 'probe-budget-defaults',
  })
  expect(otel().maxSpansPerTrace).toBe(1000)
  expect(otel().maxTraceMs).toBe(60_000)
})

test('the 1001st span of a trace starts a linked continuation', () => {
  const { otel } = start({
    name: 'probe-budget-count',
    endpoint: null,
    serviceName: 'probe-budget-count',
    captureValues: false,
    maxQueueSize: 2000,
    maxBatchSize: 2000,
  })
  const child = action(() => 1, 'budget.count.child')
  const parent = action(() => {
    for (let i = 0; i < 1000; i++) child()
  }, 'budget.count.parent')

  context.start(() => {
    parent()
  })

  const records = localRecords(otel)
  const parentSpan = spanNamed(records, 'budget.count.parent')!
  const children = spansNamed(records, 'budget.count.child')
  expect(children).toHaveLength(1000)
  expect(children[998]).toMatchObject({
    traceId: parentSpan.traceId,
    parentSpanId: parentSpan.spanId,
  })
  const overflow = children[999]!
  expect(overflow.traceId).not.toBe(parentSpan.traceId)
  expect(overflow.parentSpanId).toBeUndefined()
  expect(overflow.links).toEqual([
    expect.objectContaining({
      traceId: parentSpan.traceId,
      spanId: parentSpan.spanId,
    }),
  ])
  expect(linkReasonOf(overflow)).toBe('trace.budget')
  expect(stringAttr(overflow, 'reatom.parent.reason')).toBe('budget')
})

test('a full trace reuses one continuation until that continuation fills', () => {
  const { otel } = start({
    name: 'probe-budget-reuse',
    endpoint: null,
    serviceName: 'probe-budget-reuse',
    captureValues: false,
    maxSpansPerTrace: 2,
    maxQueueSize: 20,
  })
  const child = action(() => 1, 'budget.reuse.child')
  const parent = action(() => {
    child()
    child()
    child()
    child()
  }, 'budget.reuse.parent')

  context.start(() => {
    parent()
  })

  const records = localRecords(otel)
  const parentSpan = spanNamed(records, 'budget.reuse.parent')!
  const children = spansNamed(records, 'budget.reuse.child')
  expect(children).toHaveLength(4)
  const [first, second, third, fourth] = children
  expect(first).toMatchObject({
    traceId: parentSpan.traceId,
    parentSpanId: parentSpan.spanId,
  })
  expect(stringAttr(first!, 'reatom.parent.reason')).toBe('call')
  expect(second!.traceId).not.toBe(parentSpan.traceId)
  expect(second!.parentSpanId).toBeUndefined()
  expect(linkReasonOf(second!)).toBe('trace.budget')
  expect(second!.links?.[0]).toMatchObject({
    traceId: parentSpan.traceId,
    spanId: parentSpan.spanId,
  })
  expect(stringAttr(second!, 'reatom.parent.reason')).toBe('budget')
  expect(third).toMatchObject({
    traceId: second!.traceId,
    parentSpanId: second!.spanId,
  })
  expect(stringAttr(third!, 'reatom.parent.reason')).toBe('budget')
  expect(fourth!.traceId).not.toBe(second!.traceId)
  expect(fourth!.parentSpanId).toBeUndefined()
  expect(linkReasonOf(fourth!)).toBe('trace.budget')
  expect(fourth!.links?.[0]).toMatchObject({
    traceId: second!.traceId,
    spanId: second!.spanId,
  })
  expect(stringAttr(fourth!, 'reatom.parent.reason')).toBe('budget')
})

test('maxTraceMs starts a continuation after the trace age and Infinity disables both limits', async () => {
  vi.useFakeTimers()
  const startedAt = 1_700_000_000_000
  vi.setSystemTime(startedAt)
  try {
    const { otel } = start({
      name: 'probe-budget-time',
      endpoint: null,
      serviceName: 'probe-budget-time',
      captureValues: false,
      maxTraceMs: 60_000,
      maxQueueSize: 20,
    })
    const child = action(() => 1, 'budget.time.child')
    const onTime = action(() => 1, 'budget.time.onTime')
    const later = action(() => 1, 'budget.time.later')
    const parent = action(async () => {
      child()
      await wrap(sleep(60_000))
      onTime()
      await wrap(sleep(1))
      later()
    }, 'budget.time.parent')
    const pending = context.start(() => parent())
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(1)
    await pending

    const records = localRecords(otel)
    const parentSpan = spanNamed(records, 'budget.time.parent')!
    expect(spanNamed(records, 'budget.time.onTime')).toMatchObject({
      traceId: parentSpan.traceId,
      parentSpanId: parentSpan.spanId,
    })
    const overflow = spanNamed(records, 'budget.time.later')!
    expect(overflow.traceId).not.toBe(parentSpan.traceId)
    expect(overflow.parentSpanId).toBeUndefined()
    expect(linkReasonOf(overflow)).toBe('trace.budget')
    expect(overflow.links?.[0]).toMatchObject({
      traceId: parentSpan.traceId,
      spanId: parentSpan.spanId,
    })
    expect(stringAttr(overflow, 'reatom.parent.reason')).toBe('budget')
  } finally {
    vi.useRealTimers()
  }
})

test('Infinity disables the span budget', async () => {
  vi.useFakeTimers()
  const startedAt = 1_700_000_000_000
  vi.setSystemTime(startedAt)
  try {
    const { otel } = start({
      name: 'probe-budget-infinity',
      endpoint: null,
      serviceName: 'probe-budget-infinity',
      captureValues: false,
      maxSpansPerTrace: Infinity,
      maxTraceMs: Infinity,
      maxQueueSize: 20,
    })
    const child = action(() => 1, 'budget.infinity.child')
    const later = action(() => 1, 'budget.infinity.later')
    const parent = action(async () => {
      for (let i = 0; i < 5; i++) child()
      await wrap(sleep(120_000))
      later()
    }, 'budget.infinity.parent')
    const pending = context.start(() => parent())
    await vi.advanceTimersByTimeAsync(120_000)
    await pending

    const records = localRecords(otel)
    const parentSpan = spanNamed(records, 'budget.infinity.parent')!
    const children = spansNamed(records, 'budget.infinity.child')
    expect(children).toHaveLength(5)
    for (const childSpan of children) {
      expect(childSpan.traceId).toBe(parentSpan.traceId)
      expect(childSpan.links ?? []).toEqual([])
    }
    expect(spanNamed(records, 'budget.infinity.later')).toMatchObject({
      traceId: parentSpan.traceId,
      parentSpanId: parentSpan.spanId,
    })
  } finally {
    vi.useRealTimers()
  }
})

test('options.set changes the span budget for later spans', () => {
  const { otel } = start({
    name: 'probe-budget-runtime',
    endpoint: null,
    serviceName: 'probe-budget-runtime',
    captureValues: false,
    maxQueueSize: 20,
  })
  const child = action(() => 1, 'budget.runtime.child')
  const parent = action(() => {
    child()
    otel.set((current) => ({ ...current, maxSpansPerTrace: 2 }))
    child()
  }, 'budget.runtime.parent')

  context.start(() => {
    parent()
  })

  const records = localRecords(otel)
  const parentSpan = spanNamed(records, 'budget.runtime.parent')!
  const children = spansNamed(records, 'budget.runtime.child')
  expect(children).toHaveLength(2)
  expect(children[0]).toMatchObject({
    traceId: parentSpan.traceId,
    parentSpanId: parentSpan.spanId,
  })
  expect(children[1]!.traceId).not.toBe(parentSpan.traceId)
  expect(linkReasonOf(children[1]!)).toBe('trace.budget')
  expect(stringAttr(children[1]!, 'reatom.parent.reason')).toBe('budget')
})
