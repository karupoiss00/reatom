import { action, context } from '@reatom/core'
import { afterEach, expect, test } from 'vitest'

import type { SpanInput } from './buildSpan.ts'
import { createTestWithOTel, reatomTestTelemetry } from './test-helpers.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const start = () => {
  const name = `action-rejection-${Math.random().toString(16).slice(2)}`
  const otel = reatomTestTelemetry({
    name,
    endpoint: null,
    serviceName: 'p',
    batchInterval: 100_000,
    maxBatchSize: 100,
    maxQueueSize: 100,
    retry: { maxRetries: 0 },
    useBeacon: false,
  })
  cleanups.push(() => context.start(() => otel.dispose()))
  return otel
}

type RawSpan = {
  name?: string
  eventName?: string
  attributes?: Record<string, unknown>
}

const isSpanNamed = (record: unknown, name: string): record is RawSpan =>
  !!record &&
  typeof record === 'object' &&
  !('eventName' in record) &&
  'name' in record &&
  (record as RawSpan).name === name

const stringAttr = (record: RawSpan, key: string) => record.attributes?.[key]

const captureUnhandled = async (run: () => Promise<void> | void) => {
  const unhandled: unknown[] = []
  const onUnhandled = (error: unknown) => {
    unhandled.push(error)
  }
  process.on('unhandledRejection', onUnhandled)
  try {
    await run()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    return unhandled
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
}

test('un-awaited rejecting traced action reports exactly one unhandledRejection', async () => {
  const otel = start()
  const failure = new Error('boom')
  const fail = action(async () => {
    throw failure
  }, 'probe.fail')

  const unhandled = await captureUnhandled(() => {
    context.start(() => {
      fail()
    })
  })

  expect(unhandled).toEqual([failure])
  const spans = otel
    .records()
    .filter((record) => isSpanNamed(record, 'probe.fail'))
  expect(spans).toHaveLength(1)
  expect(stringAttr(spans[0]!, 'reatom.outcome')).toBe('error')
})

test('awaited rejecting traced action reports zero unhandled rejections and the original error', async () => {
  const otel = start()
  const failure = new Error('boom')
  const fail = action(async () => {
    throw failure
  }, 'probe.fail')

  const unhandled = await captureUnhandled(async () => {
    await expect(context.start(() => fail())).rejects.toBe(failure)
  })

  expect(unhandled).toEqual([])
  const spans = otel
    .records()
    .filter((record) => isSpanNamed(record, 'probe.fail'))
  expect(spans).toHaveLength(1)
  expect(stringAttr(spans[0]!, 'reatom.outcome')).toBe('error')
})

test('traced async action resolves to the same value', async () => {
  const otel = start()
  const value = { ok: 'same' }
  const load = action(async () => value, 'probe.ok')

  const unhandled = await captureUnhandled(async () => {
    expect(await context.start(() => load())).toBe(value)
  })

  expect(unhandled).toEqual([])
  const spans = otel
    .records()
    .filter((record) => isSpanNamed(record, 'probe.ok'))
  expect(spans).toHaveLength(1)
  expect(stringAttr(spans[0]!, 'reatom.outcome')).toBe('ok')
})

test('un-awaited resolved traced action does not report an unhandledRejection', async () => {
  const otel = start()
  const load = action(async () => 'done', 'probe.ok')

  const unhandled = await captureUnhandled(() => {
    context.start(() => {
      load()
    })
  })

  expect(unhandled).toEqual([])
  const spans = otel
    .records()
    .filter((record) => isSpanNamed(record, 'probe.ok'))
  expect(spans).toHaveLength(1)
  expect(stringAttr(spans[0]!, 'reatom.outcome')).toBe('ok')
})

test('traced async action keeps own properties of the returned promise', async () => {
  start()
  const controller = new AbortController()
  const load = action(
    () => Object.assign(Promise.resolve('done'), { controller }),
    'probe.decorated',
  )

  const returned = context.start(() => load()) as Promise<string> & {
    controller?: AbortController
  }

  expect(returned.controller).toBe(controller)
  expect(await returned).toBe('done')
})

test('sync traced action still returns the original non-promise result', () => {
  const otel = start()
  const value = { n: 1 }
  const read = action(() => value, 'probe.sync')

  context.start(() => {
    expect(read()).toBe(value)
  })

  const spans = otel
    .records()
    .filter((record) => isSpanNamed(record, 'probe.sync'))
  expect(spans).toHaveLength(1)
  expect(stringAttr(spans[0]!, 'reatom.outcome')).toBe('ok')
})

test('awaited async action span records outcome through createTestWithOTel', async () => {
  const spans: SpanInput[] = []
  const withOTel = createTestWithOTel({
    queueSpan: (span) => spans.push(span),
    isActive: () => true,
    captureValues: {},
  })
  const value = { ok: 'unit' }
  const failure = new Error('boom')
  const load = action(async () => value, 'unit.ok').extend(withOTel())
  const fail = action(async () => {
    throw failure
  }, 'unit.fail').extend(withOTel())

  expect(await context.start(() => load())).toBe(value)
  await expect(context.start(() => fail())).rejects.toBe(failure)

  expect(spans.map((span) => span.name)).toEqual(['unit.ok', 'unit.fail'])
  expect(spans[0]!.extraAttributes).toMatchObject({ 'reatom.outcome': 'ok' })
  expect(spans[1]!.extraAttributes).toMatchObject({ 'reatom.outcome': 'error' })
  expect(spans[1]!.status?.code).toBe('error')
})
