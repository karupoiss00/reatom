import { action, atom, computed, context } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomTestTelemetry, withWarnSpy } from './test-helpers.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  vi.unstubAllEnvs()
})

const start = (
  overrides: Partial<Parameters<typeof reatomTestTelemetry>[0]> = {},
) => {
  const otel = reatomTestTelemetry({
    name: `defaults-${Math.random().toString(16).slice(2)}`,
    endpoint: null,
    serviceName: 'defaults',
    batchInterval: 100_000,
    maxBatchSize: 100,
    maxQueueSize: 100,
    useBeacon: false,
    ...overrides,
  })
  cleanups.push(() => context.start(() => otel.dispose()))
  return otel
}

const stringAttr = (record: object, key: string): string | undefined => {
  const value =
    'attributes' in record
      ? (record.attributes as Record<string, unknown>)[key]
      : undefined
  return typeof value === 'string' ? value : undefined
}

const spanNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('name' in record)) continue
    if (typeof record.name === 'string' && 'spanId' in record) {
      names.push(record.name)
    }
  }
  return names
}

const updateNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('eventName' in record)) {
      continue
    }
    if (
      record.eventName !== 'reatom.atom.update' &&
      record.eventName !== 'reatom.computed.update'
    ) {
      continue
    }
    const name = stringAttr(record, 'reatom.name')
    if (name) names.push(name)
  }
  return names
}

const settleHooks = () => Promise.resolve()

test('analytics and otel names are excluded from automatic observation', async () => {
  const otel = start()
  context.start(() => {
    const internal = atom(0, 'analytics.shop.visitor')
    const tracer = atom(0, 'otel.shop.queue')
    const note = atom('x', 'shop.note')
    const doubled = computed(() => note().length, 'shop.note.length')
    doubled.subscribe(() => {})
    const pageView = action(() => {
      internal.set(1)
    }, 'analytics.shop.pageView')
    const write = action(() => {
      tracer.set(1)
      note.set('y')
      return doubled()
    }, 'shop.write')
    pageView()
    expect(write()).toBe(1)
  })
  await settleHooks()

  const records = otel.records()
  expect(spanNames(records)).toContain('shop.write')
  expect(spanNames(records)).not.toContain('analytics.shop.pageView')
  expect(updateNames(records)).toContain('shop.note')
  expect(updateNames(records)).not.toContain('analytics.shop.visitor')
  expect(updateNames(records)).not.toContain('otel.shop.queue')
})

test('skipGlobalExtension skips automatic action spans and update logs', async () => {
  const otel = start({ skipGlobalExtension: true })
  context.start(() => {
    const count = atom(0, 'shop.count')
    const doubled = computed(() => count() * 2, 'shop.doubled')
    doubled.subscribe(() => {})
    const bump = action(() => {
      count.set(1)
      return doubled()
    }, 'shop.bump')
    expect(bump()).toBe(2)
  })
  await settleHooks()

  const records = otel.records()
  expect(spanNames(records)).not.toContain('shop.bump')
  expect(updateNames(records)).toEqual([])
})

test('explicit withOTel still records when skipGlobalExtension is set', async () => {
  const otel = start({ skipGlobalExtension: true })
  const count = atom(0, 'shop.count').extend(
    otel.withOTel({ attributes: { 'app.count.tag': 'cart' } }),
  )
  const traced = action(() => {
    count.set(1)
    return 'ok'
  }, 'shop.traced').extend(
    otel.withOTel({
      attributes: ({ payload }) => ({ 'app.result': String(payload) }),
    }),
  )

  context.start(() => {
    expect(traced()).toBe('ok')
  })
  await settleHooks()

  const records = otel.records()
  const tracedSpan = records.find(
    (record) =>
      record &&
      typeof record === 'object' &&
      'name' in record &&
      record.name === 'shop.traced',
  )
  expect(tracedSpan).toBeTruthy()
  expect(stringAttr(tracedSpan as object, 'app.result')).toBe('ok')
  expect(updateNames(records)).toContain('shop.count')
  const countUpdate = records.find(
    (record) =>
      record &&
      typeof record === 'object' &&
      'eventName' in record &&
      record.eventName === 'reatom.atom.update' &&
      stringAttr(record, 'reatom.name') === 'shop.count',
  )
  expect(stringAttr(countUpdate as object, 'app.count.tag')).toBe('cart')
})

test('a relative endpoint throws at construction and warns in development', async () => {
  await withWarnSpy(async (warn) => {
    expect(() =>
      reatomTestTelemetry({
        name: 'relative',
        endpoint: '/otel',
        serviceName: 'relative',
      }),
    ).toThrow(/absolute HTTP\(S\) endpoint/)
    expect(warn).toHaveBeenCalled()
  })
})

test('a relative endpoint still throws in production and does not warn', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  await withWarnSpy(async (warn) => {
    expect(() =>
      reatomTestTelemetry({
        name: 'relative-prod',
        endpoint: 'otel',
        serviceName: 'relative-prod',
      }),
    ).toThrow(/absolute HTTP\(S\) endpoint/)
    expect(warn).not.toHaveBeenCalled()
  })
})

test('an invalid traceparent warns in development and stays quiet in production', async () => {
  await withWarnSpy(async (warn) => {
    const otel = start({ endpoint: 'https://collector.invalid/otel' })
    expect(otel.parseTraceparent('not-a-traceparent')).toBeUndefined()
    expect(
      warn.mock.calls.some((call) =>
        call.map(String).join(' ').includes('invalid traceparent'),
      ),
    ).toBe(true)
  })

  vi.stubEnv('NODE_ENV', 'production')
  await withWarnSpy(async (warn) => {
    const otel = start({ endpoint: 'https://collector.invalid/otel' })
    expect(otel.parseTraceparent('not-a-traceparent')).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })
})
