import {
  action,
  atom,
  computed,
  context,
  notify,
  toAbortError,
} from '@reatom/core'
import { afterEach, expect, test } from 'vitest'

import type { LogRecordInput } from './buildLogRecord.ts'
import type { SpanInput } from './buildSpan.ts'
import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { createTestWithOTel } from './test-helpers.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const collect = () => {
  const spans: SpanInput[] = []
  const logs: LogRecordInput[] = []
  const withOTel = createTestWithOTel({
    queueSpan: (span) => spans.push(span),
    queueLog: (log) => logs.push(log),
    isActive: () => true,
    captureValues: {},
  })
  return { spans, logs, withOTel }
}

const start = (
  extra: Partial<Parameters<typeof reatomOpentelemetry>[0]> = {},
) => {
  const name = `otel-call-${Math.random().toString(16).slice(2)}`
  const otel = reatomOpentelemetry({
    name,
    endpoint: null,
    serviceName: 'p',
    batchInterval: 100_000,
    maxBatchSize: 100,
    maxQueueSize: 100,
    retry: { maxRetries: 0 },
    useBeacon: false,
    ...extra,
  })
  cleanups.push(() => context.start(() => otel.dispose()))
  return otel
}

type RawRecord = {
  name?: string
  eventName?: string
  attributes?: ReadonlyArray<{
    key: string
    value?: { stringValue?: string }
  }>
}

const isRecord = (value: unknown): value is RawRecord =>
  !!value && typeof value === 'object'

const stringAttr = (record: RawRecord, key: string) =>
  record.attributes?.find((entry) => entry.key === key)?.value?.stringValue

const spanNamed = (records: readonly unknown[], name: string) =>
  records.find(
    (record) =>
      isRecord(record) &&
      record.eventName === undefined &&
      record.name === name,
  )

test('throwing per-target serialize records the span with [Failed] for that value', () => {
  const { spans, withOTel } = collect()
  const bad = action((x: number) => x, 'probe.bad').extend(
    withOTel({
      serialize: () => {
        throw new Error('mapper')
      },
    }),
  )

  context.start(() => {
    expect(bad(7)).toBe(7)
  })

  expect(spans).toHaveLength(1)
  expect(spans[0]!.name).toBe('probe.bad')
  expect(spans[0]!.attributes).toEqual({
    params: '[Failed]',
    payload: '[Failed]',
  })
  expect(JSON.stringify(spans[0])).not.toContain('mapper')
  expect(spans[0]!.extraAttributes).toMatchObject({ 'reatom.outcome': 'ok' })
})

test('throwing per-target serialize keeps sibling fields and never writes the raw input', () => {
  const { spans, withOTel } = collect()
  const hidden = 'hidden-note-sentinel'
  const save = action(
    () => ({ public: 'visible-sentinel', note: hidden }),
    'probe.partial',
  ).extend(
    withOTel({
      serialize: (value, key) => {
        if (key === 'note') throw new Error('mapper')
        return value
      },
    }),
  )

  context.start(() => {
    expect(save()).toEqual({ public: 'visible-sentinel', note: hidden })
  })

  expect(spans).toHaveLength(1)
  expect(spans[0]!.attributes).toEqual({
    params: '[]',
    payload: '{"public":"visible-sentinel","note":"[Failed]"}',
  })
  expect(JSON.stringify(spans[0]!.attributes)).not.toContain(hidden)
  expect(JSON.stringify(spans[0]!.attributes)).not.toContain('mapper')
})

test('throwing instance redact records the span with [Failed] for that value', () => {
  const otel = start({
    captureValues: {
      redact: (key, value) => {
        if (key === 'note') throw new Error('instance-mapper')
        return value
      },
    },
  })
  const hidden = 'instance-note-sentinel'
  const save = action(
    () => ({ public: 'visible-sentinel', note: hidden }),
    'probe.instance',
  )

  context.start(() => {
    expect(save()).toEqual({ public: 'visible-sentinel', note: hidden })
  })

  const span = spanNamed(otel.records(), 'probe.instance')
  expect(span).toBeDefined()
  expect(stringAttr(span!, 'reatom.payload')).toBe(
    '{"public":"visible-sentinel","note":"[Failed]"}',
  )
  expect(JSON.stringify(span)).not.toContain(hidden)
  expect(JSON.stringify(span)).not.toContain('instance-mapper')
  expect(stringAttr(span!, 'reatom.outcome')).toBe('ok')
})

test('throwing serialize on an atom update still records the log', async () => {
  const { logs, spans, withOTel } = collect()
  const hidden = 'atom-note-sentinel'
  const count = atom({ id: 'kept-id', note: 'old' }, 'probe.count').extend(
    withOTel({
      serialize: (value, key) => {
        if (key === 'note') throw new Error('mapper')
        return value
      },
    }),
  )
  const write = action(
    () => count.set({ id: 'kept-id', note: hidden }),
    'probe.write',
  ).extend(withOTel())

  context.start(() => {
    expect(write()).toEqual({ id: 'kept-id', note: hidden })
  })
  await Promise.resolve()

  const updates = logs.filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates.length).toBeGreaterThan(0)
  expect(updates.at(-1)?.body).toEqual({ id: 'kept-id', note: '[Failed]' })
  expect(updates.at(-1)?.attributes).toMatchObject({
    'reatom.name': 'probe.count',
  })
  expect(JSON.stringify(updates.at(-1))).not.toContain(hidden)
  expect(spans.some((span) => span.name === 'probe.write')).toBe(true)
})

test.each(['sync', 'async'] as const)(
  'failed %s action attributes receive the original error',
  async (mode) => {
    const { spans, withOTel } = collect()
    const failure = new Error('boom')
    const seen: unknown[] = []
    const broken = action(
      mode === 'async'
        ? async () => {
            throw failure
          }
        : () => {
            throw failure
          },
      'probe.fail',
    ).extend(
      withOTel({
        attributes: ({ error, payload }) => {
          seen.push(error)
          return {
            'app.saw_error': error === failure,
            'app.payload': payload === undefined ? 'none' : 'set',
          }
        },
      }),
    )

    if (mode === 'async') {
      await expect(context.start(() => broken())).rejects.toBe(failure)
    } else {
      context.start(() => {
        expect(() => broken()).toThrow(failure)
      })
    }

    expect(seen).toEqual([failure])
    expect(spans).toHaveLength(1)
    expect(spans[0]!.extraAttributes).toMatchObject({
      'reatom.outcome': 'error',
      'app.saw_error': true,
      'app.payload': 'none',
    })
  },
)

test('abort and suspense attributes receive the reason', () => {
  const { spans, withOTel } = collect()
  const reason = toAbortError('stop')
  const suspension = Promise.resolve('wait')
  const seen: unknown[] = []
  const attributes = ({ error }: { error?: unknown }) => {
    seen.push(error)
    return { 'app.kind': error instanceof Promise ? 'suspense' : 'abort' }
  }
  const cancel = action(() => {
    throw reason
  }, 'probe.abort').extend(withOTel({ attributes }))
  const suspend = action(() => {
    throw suspension
  }, 'probe.suspend').extend(withOTel({ attributes }))

  context.start(() => {
    expect(() => cancel()).toThrow(reason)
    let caught: unknown
    try {
      suspend()
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(suspension)
  })

  expect(seen).toEqual([reason, suspension])
  const abortSpan = spans.find((span) => span.name === 'probe.abort')
  const suspenseSpan = spans.find((span) => span.name === 'probe.suspend')
  expect(abortSpan!.extraAttributes).toMatchObject({
    'reatom.outcome': 'abort',
    'app.kind': 'abort',
  })
  expect(suspenseSpan!.extraAttributes).toMatchObject({
    'reatom.outcome': 'suspense',
    'app.kind': 'suspense',
  })
  expect(abortSpan!.status).toBeUndefined()
  expect(suspenseSpan!.status).toBeUndefined()
})

test('atom update attributes receive prevState', async () => {
  const { logs, withOTel } = collect()
  const seen: Array<{ prevState: unknown; state: unknown }> = []
  const count = atom(0, 'probe.count').extend(
    withOTel({
      attributes: ({ prevState, state }) => {
        seen.push({ prevState, state })
        return {
          'app.prev': String(prevState),
          'app.state': String(state),
        }
      },
    }),
  )
  const write = action(() => count.set(1), 'probe.write').extend(withOTel())

  context.start(() => write())
  await Promise.resolve()

  expect(seen).toContainEqual({ prevState: 0, state: 1 })
  const updates = logs.filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates.at(-1)?.attributes).toMatchObject({
    'app.prev': '0',
    'app.state': '1',
  })
})

test('computed diamond attributes receive prevState', async () => {
  const otel = start()
  const seen: Array<{ prevState: unknown; state: unknown }> = []

  context.start(() => {
    const qty = atom(1, 'cart.qty')
    const price = atom(10, 'cart.price')
    const total = computed(() => qty() * price(), 'cart.total').extend(
      otel.withOTel({
        attributes: ({ prevState, state }) => {
          seen.push({ prevState, state })
          return {
            'app.prev': String(prevState),
            'app.state': String(state),
          }
        },
      }),
    )
    total.subscribe(() => {})

    const setQty = action(() => qty.set(2), 'cart.setQty')
    const setPrice = action(() => price.set(20), 'cart.setPrice')
    otel.traceVar.set(otel.createTrace({ name: 'ot.qty' }))
    expect(setQty()).toBe(2)
    otel.traceVar.set(otel.createTrace({ name: 'ot.price' }))
    expect(setPrice()).toBe(20)
    expect(total()).toBe(40)
    notify()
  })
  await Promise.resolve()

  expect(seen).toContainEqual({ prevState: 10, state: 40 })
  const diamond = spanNamed(otel.records(), 'cart.total')
  expect(diamond).toBeDefined()
  expect(stringAttr(diamond!, 'app.prev')).toBe('10')
  expect(stringAttr(diamond!, 'app.state')).toBe('40')
  expect(stringAttr(diamond!, 'reatom.kind')).toBe('computed')
})

test('throwing attributes function records reatom.attributes_error', () => {
  const { spans, withOTel } = collect()
  const hostile = action(() => 'ok', 'probe.hostile').extend(
    withOTel({
      attributes: () => {
        throw new TypeError('bad attributes')
      },
    }),
  )

  context.start(() => {
    expect(hostile()).toBe('ok')
  })

  expect(spans).toHaveLength(1)
  expect(spans[0]!.extraAttributes).toMatchObject({
    'reatom.outcome': 'ok',
    'reatom.attributes_error': 'TypeError',
  })
})

test('throwing attributes function on a rejected action still records the error span', async () => {
  const { spans, withOTel } = collect()
  const failure = new Error('boom')
  const hostile = action(async () => {
    throw failure
  }, 'probe.hostile').extend(
    withOTel({
      attributes: () => {
        throw new TypeError('bad attributes')
      },
    }),
  )

  await expect(context.start(() => hostile())).rejects.toBe(failure)

  expect(spans).toHaveLength(1)
  expect(spans[0]!.status?.code).toBe('error')
  expect(spans[0]!.extraAttributes).toMatchObject({
    'reatom.outcome': 'error',
    'reatom.attributes_error': 'TypeError',
  })
})

test('throwing attributes function on an atom update still records the log', async () => {
  const { logs, withOTel } = collect()
  const count = atom(0, 'probe.count').extend(
    withOTel({
      attributes: () => {
        throw new TypeError('bad attributes')
      },
    }),
  )
  const write = action(() => count.set(1), 'probe.write').extend(withOTel())

  context.start(() => write())
  await Promise.resolve()

  const updates = logs.filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates.length).toBeGreaterThan(0)
  expect(updates.at(-1)?.attributes).toMatchObject({
    'reatom.name': 'probe.count',
    'reatom.attributes_error': 'TypeError',
  })
})
