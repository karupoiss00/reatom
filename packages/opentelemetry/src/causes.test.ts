import {
  action,
  atom,
  computed,
  context,
  effect,
  getCalls,
  notify,
  withAsync,
  withAsyncData,
  wrap,
} from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import type { ParsedSpan } from './test-helpers.ts'
import {
  findSpan,
  HEX_SPAN_ID,
  HEX_TRACE_ID,
  parseSpans,
} from './test-helpers.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const decodeAnyValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if ('stringValue' in record) return record.stringValue
  if ('intValue' in record) return record.intValue
  if ('boolValue' in record) return record.boolValue
  if ('doubleValue' in record) return record.doubleValue
  if ('bytesValue' in record) return record.bytesValue
  if ('arrayValue' in record) {
    const values = (record.arrayValue as { values?: unknown[] })?.values ?? []
    return values.map(decodeAnyValue)
  }
  if ('kvlistValue' in record) {
    const entries =
      (
        record.kvlistValue as {
          values?: Array<{ key: string; value: unknown }>
        }
      )?.values ?? []
    return Object.fromEntries(
      entries.map(({ key, value: nested }) => [key, decodeAnyValue(nested)]),
    )
  }
  return value
}

interface ParsedLog {
  eventName: string
  traceId: string
  spanId: string
  severityNumber: number
  body: unknown
  attributes: Record<string, unknown>
}

const parseLogRecords = (body: string | unknown): ParsedLog[] => {
  const raw = typeof body === 'string' ? JSON.parse(body) : body
  return (raw?.resourceLogs ?? []).flatMap((resourceLogs: any) =>
    (resourceLogs.scopeLogs ?? []).flatMap((scopeLogs: any) =>
      (scopeLogs.logRecords ?? []).map((record: any): ParsedLog => {
        const attributes = decodeAnyValue({
          kvlistValue: { values: record.attributes ?? [] },
        }) as Record<string, unknown>
        return {
          eventName: record.eventName ?? attributes['event.name'],
          traceId: record.traceId,
          spanId: record.spanId,
          severityNumber: record.severityNumber,
          body: decodeAnyValue(record.body),
          attributes,
        }
      }),
    ),
  )
}

const setup = () => {
  const traces: unknown[] = []
  const logs: unknown[] = []
  const fetchMock = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname
    const body = init?.body
    if (path.endsWith('/v1/logs')) logs.push(body)
    else traces.push(body)
    return new Response('{}', { status: 200 })
  })
  const otel = reatomOpentelemetry({
    name: 'causes',
    endpoint: 'https://collector.test',
    serviceName: 'causes-svc',
    batchInterval: 50,
    maxBatchSize: 10,
    maxQueueSize: 100,
    fetch: fetchMock,
    useBeacon: false,
    captureValues: {},
  })
  cleanups.push(otel.dispose)
  return { otel, traces, logs }
}

const exportedSpans = (traces: unknown[]) => traces.flatMap(parseSpans)
const exportedLogs = (logs: unknown[]) => logs.flatMap(parseLogRecords)

const toggleActionSpan = (spans: ParsedSpan[]): ParsedSpan => {
  const matches = spans.filter(
    (span) => span.name === 'tree#.toggle' || span.name === 'tree#12.toggle',
  )
  expect(matches).toHaveLength(1)
  return matches[0]!
}

test('F-12: atom write inside an action emits reatom.atom.update with the action spanId and cause ids, not a span', async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const checked = atom(false, 'tree.checked')
    const toggle = action(() => {
      checked.set(true)
      return true
    }, 'tree#12.toggle')
    expect(toggle()).toBe(true)
    expect(checked()).toBe(true)
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  expect(spans.map((span) => span.name)).not.toContain('tree.checked')
  expect(
    spans.filter((span) => span.attributes['reatom.kind'] === 'atom'),
  ).toEqual([])

  const toggleSpan = toggleActionSpan(spans)
  expect(toggleSpan.events.map((event) => event.name)).not.toContain(
    'reatom.atom.update',
  )

  const updates = exportedLogs(logs).filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates).toHaveLength(1)
  const update = updates[0]!
  expect(update).toMatchObject({
    eventName: 'reatom.atom.update',
    traceId: toggleSpan.traceId,
    spanId: toggleSpan.spanId,
    severityNumber: 9,
    body: true,
    attributes: {
      'event.name': 'reatom.atom.update',
      'reatom.name': 'tree.checked',
      'reatom.frame.id': expect.any(String),
    },
  })
  expect(update.spanId).toMatch(HEX_SPAN_ID)
  expect(update.traceId).toMatch(HEX_TRACE_ID)
  expect(update.attributes['reatom.cause.ids']).toEqual([
    toggleSpan.attributes['reatom.frame.id'],
  ])
  expect(update.attributes['reatom.frame.id']).not.toBe(
    toggleSpan.attributes['reatom.frame.id'],
  )
  expect(toggleSpan.name).toBe('tree#.toggle')
  expect(toggleSpan.attributes['reatom.name']).toBe('tree#12.toggle')
  expect(toggleSpan.attributes['reatom.instance']).toBe('12')
})

test('F-12: tree#12.toggle is named tree#.toggle with reatom.instance "12"', async () => {
  const { otel, traces } = setup()

  context.start(() => {
    const toggle = action(() => true, 'tree#12.toggle')
    expect(toggle()).toBe(true)
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  expect(spans.map((span) => span.name)).not.toContain('tree#12.toggle')

  const toggleSpan = findSpan(traces[0], 'tree#.toggle')
  expect(toggleSpan.name).toBe('tree#.toggle')
  expect(toggleSpan.attributes['reatom.name']).toBe('tree#12.toggle')
  expect(toggleSpan.attributes['reatom.instance']).toBe('12')
  expect(toggleSpan.attributes['reatom.kind']).toBe('action')
})

type OtlpLink = {
  traceId: string
  spanId: string
  attributes?: Array<{ key: string; value: unknown }>
}

const parseSpanLinks = (
  traces: unknown[],
): Array<{ spanName: string; links: OtlpLink[] }> => {
  const found: Array<{ spanName: string; links: OtlpLink[] }> = []
  for (const body of traces) {
    const raw = typeof body === 'string' ? JSON.parse(String(body)) : body
    for (const resource of raw?.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) {
        for (const span of scope.spans ?? []) {
          found.push({ spanName: span.name, links: span.links ?? [] })
        }
      }
    }
  }
  return found
}

const linkReason = (link: OtlpLink): unknown => {
  const attributes = decodeAnyValue({
    kvlistValue: { values: link.attributes ?? [] },
  }) as Record<string, unknown>
  return attributes['reatom.link.reason']
}

const computedDependencyLinks = (traces: unknown[]): OtlpLink[] =>
  parseSpanLinks(traces).flatMap(({ links }) =>
    links.filter((link) => linkReason(link) === 'computed.dependency'),
  )

const namedSpan = (spans: ParsedSpan[], name: string): ParsedSpan => {
  const matches = spans.filter((span) => span.name === name)
  expect(matches).toHaveLength(1)
  return matches[0]!
}

const computedSpansNamed = (spans: ParsedSpan[], name: string): ParsedSpan[] =>
  spans.filter(
    (span) =>
      span.attributes['reatom.kind'] === 'computed' &&
      (span.name === name || span.attributes['reatom.name'] === name),
  )

const computedUpdatesNamed = (
  records: ParsedLog[],
  name: string,
): ParsedLog[] =>
  records.filter(
    (record) =>
      record.eventName === 'reatom.computed.update' &&
      record.attributes['reatom.name'] === name,
  )

const setupDiamondCart = async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const qty = atom(1, 'cart.qty')
    const price = atom(10, 'cart.price')
    const total = computed(() => qty() * price(), 'cart.total')
    total.subscribe(() => {})

    const setQty = action(() => qty.set(2), 'cart.setQty')
    const setPrice = action(() => price.set(20), 'cart.setPrice')

    otel.traceVar.set(otel.createTrace({ name: 'ot9.qty' }))
    expect(setQty()).toBe(2)
    otel.traceVar.set(otel.createTrace({ name: 'ot9.price' }))
    expect(setPrice()).toBe(20)
    expect(total()).toBe(40)
    notify()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const records = exportedLogs(logs)
  const qtySpan = namedSpan(spans, 'cart.setQty')
  const priceSpan = namedSpan(spans, 'cart.setPrice')
  expect(qtySpan.traceId).toMatch(HEX_TRACE_ID)
  expect(priceSpan.traceId).toMatch(HEX_TRACE_ID)
  expect(qtySpan.traceId).not.toBe(priceSpan.traceId)
  expect(qtySpan.spanId).toMatch(HEX_SPAN_ID)
  expect(priceSpan.spanId).toMatch(HEX_SPAN_ID)

  return { traces, logs, spans, records, qtySpan, priceSpan }
}

test('OT-9: computed with causes from different traces is a short span on the primary cause, not a new root', async () => {
  const { spans, qtySpan, priceSpan } = await setupDiamondCart()

  const diamondSpans = computedSpansNamed(spans, 'cart.total')
  expect(diamondSpans).toHaveLength(1)

  const diamond = diamondSpans[0]!
  expect([qtySpan.traceId, priceSpan.traceId]).toContain(diamond.traceId)
  const primary = diamond.traceId === qtySpan.traceId ? qtySpan : priceSpan
  expect(diamond.parentSpanId).toBe(primary.spanId)
  expect(diamond.spanId).not.toBe(primary.spanId)
  expect(diamond.spanId).toMatch(HEX_SPAN_ID)
  expect(diamond.endTimeUnixNano).toEqual(expect.any(String))
  expect(diamond.attributes['reatom.kind']).toBe('computed')
  expect(diamond.attributes['reatom.name']).toBe('cart.total')
})

test('OT-9: diamond computed recompute is not only a reatom.computed.update log', async () => {
  const { records, qtySpan, priceSpan } = await setupDiamondCart()

  const actionTraceIds = new Set([qtySpan.traceId, priceSpan.traceId])
  const diamondLogs = computedUpdatesNamed(records, 'cart.total').filter(
    (record) => actionTraceIds.has(record.traceId),
  )
  expect(diamondLogs).toHaveLength(0)
})

test('OT-9: cross-trace computed span has one computed.dependency link to the other trace', async () => {
  const { traces, qtySpan, priceSpan } = await setupDiamondCart()

  const links = computedDependencyLinks(traces)
  expect(links).toHaveLength(1)

  const link = links[0]!
  const other =
    link.traceId === qtySpan.traceId
      ? qtySpan
      : link.traceId === priceSpan.traceId
        ? priceSpan
        : undefined
  expect(other).toBeDefined()
  expect(link).toMatchObject({
    traceId: other!.traceId,
    spanId: other!.spanId,
  })
  expect(linkReason(link)).toBe('computed.dependency')
})

test('F-12: computed update whose cause parent is a toggle span uses the toggle TraceId, not an earlier add', async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const size = atom(0, 'tree.size')
    const checkedCount = computed(() => size(), 'tree._checkedCount')
    const toggle = action((state = true) => state, 'tree#1.toggle')
    const checked = computed(() => {
      const count = checkedCount()
      const n = size()
      let state = n === 0 || count === n
      getCalls(toggle).forEach(({ payload }) => {
        state = payload
      })
      return state
    }, 'tree.checked')
    checked.subscribe(() => {})

    const add = action(() => {
      size.set(1)
    }, 'tree#1.add')

    otel.traceVar.set(otel.createTrace({ name: 'tree.add' }))
    add()
    notify()
    otel.traceVar.set(otel.createTrace({ name: 'tree.toggle' }))
    toggle(false)
    notify()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const records = exportedLogs(logs)
  const addSpan = namedSpan(spans, 'tree#.add')
  const toggleSpan = namedSpan(spans, 'tree#.toggle')
  expect(addSpan.traceId).not.toBe(toggleSpan.traceId)

  const toggleFrameId = toggleSpan.attributes['reatom.frame.id']
  expect(typeof toggleFrameId).toBe('string')

  const fromToggle = computedUpdatesNamed(records, 'tree.checked').filter(
    (record) => {
      const ids = record.attributes['reatom.cause.ids']
      return Array.isArray(ids) && ids.includes(toggleFrameId)
    },
  )
  expect(fromToggle.length).toBeGreaterThan(0)
  for (const record of fromToggle) {
    expect(record.traceId).toBe(toggleSpan.traceId)
    expect(record.spanId).toBe(toggleSpan.spanId)
  }
})

test('OT-9: computed with a single traced cause stays a reatom.computed.update log', async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const qty = atom(1, 'cart.qty')
    const doubled = computed(() => qty() * 2, 'cart.doubled')
    doubled.subscribe(() => {})

    const setQty = action(() => qty.set(3), 'cart.setQty')
    otel.traceVar.set(otel.createTrace({ name: 'ot9.single' }))
    expect(setQty()).toBe(3)
    expect(doubled()).toBe(6)
    notify()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const records = exportedLogs(logs)
  const setQtySpan = namedSpan(spans, 'cart.setQty')

  expect(computedSpansNamed(spans, 'cart.doubled')).toEqual([])
  expect(computedDependencyLinks(traces)).toEqual([])

  const updates = computedUpdatesNamed(records, 'cart.doubled').filter(
    (record) => record.traceId === setQtySpan.traceId,
  )
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({
    eventName: 'reatom.computed.update',
    traceId: setQtySpan.traceId,
    spanId: setQtySpan.spanId,
    severityNumber: 9,
    attributes: {
      'event.name': 'reatom.computed.update',
      'reatom.name': 'cart.doubled',
      'reatom.frame.id': expect.any(String),
    },
  })
})

test('uninstrumented atoms created before the instance pass the writer trace through to a computed', async () => {
  const leaf = atom(1, 'cause.leaf')
  const mid = computed(() => leaf() + 1, 'cause.mid')
  const { otel, traces, logs } = setup()

  context.start(() => {
    const view = computed(() => mid() * 10, 'cause.view')
    view.subscribe(() => {})
    const write = action(() => {
      leaf.set(4)
    }, 'cause.write')
    write()
    notify()
  })

  await otel.flush()

  const writeSpan = namedSpan(exportedSpans(traces), 'cause.write')
  const viewed = computedUpdatesNamed(exportedLogs(logs), 'cause.view').filter(
    (record) => record.body === 50 || record.body === '50',
  )
  expect(viewed).toHaveLength(1)
  expect(viewed[0]).toMatchObject({
    traceId: writeSpan.traceId,
    spanId: writeSpan.spanId,
    attributes: {
      'reatom.parent.reason': 'dependency',
    },
  })
  expect(viewed[0]!.attributes['reatom.cause.ids']).toContain(
    writeSpan.attributes['reatom.frame.id'],
  )
})

const settle = () => wrap(new Promise((resolve) => setTimeout(resolve, 10)))

test('async action onFulfill keeps the action as parent and cause', async () => {
  const { otel, traces } = setup()

  await context.start(async () => {
    const load = action(async () => {
      await wrap(Promise.resolve())
      return 1
    }, 'load').extend(withAsync())
    await wrap(load())
    await settle()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const loadSpan = namedSpan(spans, 'load')
  const fulfillSpan = namedSpan(spans, 'load.onFulfill')
  expect(fulfillSpan.parentSpanId).toBe(loadSpan.spanId)
  expect(fulfillSpan.traceId).toBe(loadSpan.traceId)
  expect(fulfillSpan.attributes['reatom.cause.ids']).toEqual(
    expect.arrayContaining([loadSpan.attributes['reatom.frame.id']]),
  )
})

test('async action onReject keeps the action as parent and cause', async () => {
  const { otel, traces } = setup()

  await context.start(async () => {
    const load = action(async () => {
      await wrap(Promise.resolve())
      throw new Error('load failed')
    }, 'load').extend(withAsync())
    await wrap(load().catch(() => undefined))
    await settle()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const loadSpan = namedSpan(spans, 'load')
  const rejectSpan = namedSpan(spans, 'load.onReject')
  expect(rejectSpan.parentSpanId).toBe(loadSpan.spanId)
  expect(rejectSpan.traceId).toBe(loadSpan.traceId)
  expect(rejectSpan.attributes['reatom.cause.ids']).toEqual(
    expect.arrayContaining([loadSpan.attributes['reatom.frame.id']]),
  )
})

test('async computed onFulfill on first connect is parented, not a new root', async () => {
  const { otel, traces } = setup()

  await context.start(async () => {
    const dep = atom(1, 'dep')
    const data = computed(async () => {
      const value = dep()
      await wrap(Promise.resolve())
      return value
    }, 'data').extend(withAsyncData())
    const unsubscribe = data.data.subscribe(() => {})
    await settle()
    unsubscribe()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const fulfillSpan = namedSpan(spans, 'data.onFulfill')
  expect(fulfillSpan.parentSpanId).toMatch(HEX_SPAN_ID)
})

test('async computed onFulfill after a dependency write keeps non-empty causes', async () => {
  const { otel, traces } = setup()

  await context.start(async () => {
    const dep = atom(1, 'dep')
    const data = computed(async () => {
      const value = dep()
      await wrap(Promise.resolve())
      return value
    }, 'data').extend(withAsyncData())
    const unsubscribe = data.data.subscribe(() => {})
    await settle()
    action(() => dep.set(2), 'bump')()
    await settle()
    unsubscribe()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const bumpSpan = namedSpan(spans, 'bump')
  const fulfillSpans = spans.filter((span) => span.name === 'data.onFulfill')
  expect(fulfillSpans.length).toBeGreaterThan(1)
  const afterBump = fulfillSpans.find((span) => {
    const ids = span.attributes['reatom.cause.ids']
    return Array.isArray(ids) && ids.length > 0
  })
  expect(afterBump).toBeDefined()
  expect(afterBump!.attributes['reatom.cause.ids']).toEqual(
    expect.arrayContaining([expect.any(String)]),
  )
  expect(bumpSpan.attributes['reatom.frame.id']).toEqual(expect.any(String))
})

test('a dependency that was read but not written is not a cause', async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const qty = atom(1, 'cart.qty')
    const price = atom(10, 'cart.price')
    const total = computed(() => qty() * price(), 'cart.total')
    total.subscribe(() => {})

    const setQty = action(() => qty.set(2), 'cart.setQty')
    expect(setQty()).toBe(2)
    expect(total()).toBe(20)
    notify()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const qtySpan = namedSpan(spans, 'cart.setQty')
  const qtyWrites = exportedLogs(logs).filter(
    (record) =>
      record.eventName === 'reatom.atom.update' &&
      record.attributes['reatom.name'] === 'cart.qty',
  )
  const priceWrites = exportedLogs(logs).filter(
    (record) =>
      record.eventName === 'reatom.atom.update' &&
      record.attributes['reatom.name'] === 'cart.price',
  )
  expect(qtyWrites.length).toBeGreaterThan(0)
  expect(priceWrites).toEqual([])

  const updates = computedUpdatesNamed(exportedLogs(logs), 'cart.total').filter(
    (record) => record.traceId === qtySpan.traceId,
  )
  expect(updates.length).toBeGreaterThan(0)
  const qtyFrameId = qtyWrites[0]!.attributes['reatom.frame.id']
  for (const record of updates) {
    const ids = record.attributes['reatom.cause.ids']
    expect(ids).toEqual([qtyFrameId])
  }
})

test('action called from an effect after two writes includes both dependency cause ids', async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const query = atom('', 'query')
    const other = atom(0, 'other')
    const report = action((value: string) => value, 'report')
    effect(() => {
      other()
      report(query())
    }, 'reportEffect')
    action(() => other.set(1), 'init')()
    action(() => query.set('a'), 'search')()
  })

  await otel.flush()

  const otherFrameId = exportedLogs(logs).find(
    (record) =>
      record.eventName === 'reatom.atom.update' &&
      record.attributes['reatom.name'] === 'other',
  )?.attributes['reatom.frame.id']
  const queryFrameId = exportedLogs(logs).find(
    (record) =>
      record.eventName === 'reatom.atom.update' &&
      record.attributes['reatom.name'] === 'query',
  )?.attributes['reatom.frame.id']
  expect(typeof otherFrameId).toBe('string')
  expect(typeof queryFrameId).toBe('string')

  const afterWrites = exportedSpans(traces)
    .filter((span) => span.name === 'report')
    .find((span) => {
      const ids = span.attributes['reatom.cause.ids']
      return Array.isArray(ids) && ids.length > 0
    })
  expect(afterWrites).toBeDefined()
  expect(afterWrites!.attributes['reatom.cause.ids']).toEqual(
    expect.arrayContaining([otherFrameId, queryFrameId]),
  )
})

test('action called from a subscribed computed includes the written dependency cause id', async () => {
  const { otel, traces, logs } = setup()

  context.start(() => {
    const query = atom('', 'query')
    const report = action((value: string) => value, 'report')
    const derived = computed(() => report(query()), 'derived')
    derived.subscribe(() => {})
    action(() => query.set('a'), 'search')()
  })

  await otel.flush()

  const queryFrameId = exportedLogs(logs).find(
    (record) =>
      record.eventName === 'reatom.atom.update' &&
      record.attributes['reatom.name'] === 'query',
  )?.attributes['reatom.frame.id']
  expect(typeof queryFrameId).toBe('string')

  const afterWrite = exportedSpans(traces)
    .filter((span) => span.name === 'report')
    .find((span) => {
      const ids = span.attributes['reatom.cause.ids']
      return Array.isArray(ids) && ids.length > 0
    })
  expect(afterWrite).toBeDefined()
  expect(afterWrite!.attributes['reatom.cause.ids']).toEqual(
    expect.arrayContaining([queryFrameId]),
  )
})

test('action called from an effect is parented by the last-changed dependency', async () => {
  const { otel, traces } = setup()

  context.start(() => {
    const query = atom('', 'query')
    const other = atom(0, 'other')
    const report = action((value: string) => value, 'report')
    effect(() => {
      other()
      report(query())
    }, 'reportEffect')
    action(() => other.set(1), 'init')()
    action(() => query.set('a'), 'search')()
  })

  await otel.flush()

  const spans = exportedSpans(traces)
  const searchSpan = namedSpan(spans, 'search')
  const afterWrites = spans
    .filter((span) => span.name === 'report')
    .find((span) => {
      const ids = span.attributes['reatom.cause.ids']
      return Array.isArray(ids) && ids.length > 0
    })
  expect(afterWrites).toBeDefined()
  expect(afterWrites!.parentSpanId).toBe(searchSpan.spanId)
  expect(afterWrites!.traceId).toBe(searchSpan.traceId)
})
