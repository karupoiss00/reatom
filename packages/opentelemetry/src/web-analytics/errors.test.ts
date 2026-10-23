import { action, context } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { parseLogRecords, reatomTestTelemetry } from '../test-helpers.ts'
import {} from './connectWebAnalytics.ts'
import type { AnalyticsFixtureOptions as WebAnalyticsCreateOptions } from './test-helpers.ts'
import { createAnalytics, readAnalyticsStats } from './test-helpers.ts'

type WindowListener = (event: unknown) => void

const OPTIONS = {
  name: 'site',
  endpoint: 'https://collector.test',
  serviceName: 'site-web',
  skipGlobalExtension: true as const,
  navigation: 'popstate' as const,
  useBeacon: false,
  retry: { maxRetries: 0 },
  batchInterval: 100_000,
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    const stop = cleanups.pop()!
    context.start(() => stop())
  }
  vi.unstubAllGlobals()
  Reflect.deleteProperty(
    globalThis,
    Symbol.for('reatom.opentelemetry.analytics.pageViews'),
  )
})

const remember = <T extends { dispose?: { (): void } | (() => void) }>(
  analytics: T,
): T => {
  if (typeof analytics.dispose === 'function') {
    const dispose = analytics.dispose.bind(analytics)
    cleanups.push(() => dispose())
  }
  return analytics
}

const installWindow = () => {
  const href = 'https://shop.test/home'
  const listeners = new Map<string, Set<WindowListener>>()

  const location = {
    get href() {
      return href
    },
    get pathname() {
      return new URL(href).pathname
    },
    get origin() {
      return new URL(href).origin
    },
    get search() {
      return new URL(href).search
    },
    get hash() {
      return new URL(href).hash
    },
  }

  const windowStub = {
    location,
    history: {
      pushState() {},
      replaceState() {},
    },
    addEventListener: vi.fn(
      (
        type: string,
        fn: WindowListener,
        options?: AddEventListenerOptions | boolean,
      ) => {
        const set = listeners.get(type) ?? new Set()
        set.add(fn)
        listeners.set(type, set)
        const signal = typeof options === 'object' ? options.signal : undefined
        signal?.addEventListener('abort', () => {
          listeners.get(type)?.delete(fn)
        })
      },
    ),
    removeEventListener: vi.fn((type: string, fn: WindowListener) => {
      listeners.get(type)?.delete(fn)
    }),
    document: {
      visibilityState: 'visible' as const,
      body: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  }

  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', windowStub.document)
  vi.stubGlobal('location', location)

  return {
    hasListener(type: 'error' | 'unhandledrejection') {
      return (listeners.get(type)?.size ?? 0) > 0
    },
    fire(type: 'error' | 'unhandledrejection', error: Error) {
      const event =
        type === 'error'
          ? {
              type,
              error,
              message: error.message,
              preventDefault() {},
            }
          : {
              type,
              reason: error,
              preventDefault() {},
            }
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event)
    },
    firePageHide() {
      for (const fn of [...(listeners.get('pagehide') ?? [])]) fn({})
    },
  }
}

const startAnalytics = (
  consent?: boolean,
  extra?: Partial<Omit<WebAnalyticsCreateOptions, 'consent' | 'fetch'>>,
) => {
  const logBodies: unknown[] = []
  const shop = installWindow()
  const analytics = context.start(() =>
    remember(
      createAnalytics({
        ...OPTIONS,
        ...extra,
        ...(consent === undefined ? {} : { consent }),
        fetch: async (url, init) => {
          if (String(url).includes('/v1/logs')) logBodies.push(init?.body)
          return new Response('{}', { status: 200 })
        },
      }),
    ),
  )
  return { analytics, logBodies, shop }
}

const logsNamed = (logBodies: unknown[], eventName: string) =>
  logBodies
    .flatMap((body) => parseLogRecords(body ?? {}))
    .filter((record) => record.eventName === eventName)

const exceptionLogs = (logBodies: unknown[]) =>
  logsNamed(logBodies, 'exception')

const suppressedLogs = (logBodies: unknown[]) =>
  logsNamed(logBodies, 'exception.suppressed')

const flushLogs = async (analytics: ReturnType<typeof createAnalytics>) => {
  await context.start(() => analytics.otel.flush())
}

test.each(['error', 'unhandledrejection'] as const)(
  'T-050 / WA-5: consent true; window %s TypeError is an exception log with type only',
  async (type) => {
    const { analytics, logBodies, shop } = startAnalytics(true)
    expect(shop.hasListener(type)).toBe(true)
    const failure = new TypeError('x')

    shop.fire(type, failure)
    await flushLogs(analytics)

    const exceptions = exceptionLogs(logBodies)
    expect(exceptions).toHaveLength(1)
    const record = exceptions[0]!
    expect(record.severityNumber).toBe(17)
    expect(record.attributes['exception.type']).toBe('TypeError')
    expect(record.attributes).not.toHaveProperty('exception.message')
    expect(record.attributes).not.toHaveProperty('exception.stacktrace')
  },
)

test('T-050 / WA-5: traced action Error is not duplicated as a second analytics exception', async () => {
  const { analytics, logBodies, shop } = startAnalytics(true)
  expect(shop.hasListener('error')).toBe(true)
  expect(shop.hasListener('unhandledrejection')).toBe(true)
  const failure = new TypeError('x')

  const explode = action(() => {
    throw failure
  }, 'shop.submit').extend(analytics.otel.withOTel())

  context.start(() => {
    try {
      explode()
    } catch (error) {
      expect(error).toBe(failure)
    }
  })

  shop.fire('error', failure)
  shop.fire('unhandledrejection', failure)
  await flushLogs(analytics)

  expect(exceptionLogs(logBodies)).toHaveLength(1)
  expect(failure).not.toHaveProperty('__sentry_captured__')
})

test('T-050 / WA-5: consent false adds no analytics exception OTLP stream', async () => {
  const { analytics, logBodies, shop } = startAnalytics(false)
  expect(shop.hasListener('error')).toBe(true)
  expect(shop.hasListener('unhandledrejection')).toBe(true)
  const traced = new TypeError('traced')
  const unhandled = new TypeError('x')

  const explode = action(() => {
    throw traced
  }, 'shop.submit').extend(analytics.otel.withOTel())

  context.start(() => {
    try {
      explode()
    } catch (error) {
      expect(error).toBe(traced)
    }
  })

  await flushLogs(analytics)
  const tracerExceptions = exceptionLogs(logBodies)
  expect(tracerExceptions).toHaveLength(1)
  expect(tracerExceptions[0]!.attributes['exception.type']).toBe('TypeError')

  shop.fire('error', unhandled)
  shop.fire('unhandledrejection', unhandled)
  await flushLogs(analytics)

  expect(exceptionLogs(logBodies)).toHaveLength(1)
})

test('T-050 / WA-5 / R11: omitted consent adds no analytics exception OTLP', async () => {
  const { analytics, logBodies, shop } = startAnalytics(undefined, {
    name: 'errors-consent-omitted',
  })
  expect(shop.hasListener('error')).toBe(true)
  expect(shop.hasListener('unhandledrejection')).toBe(true)

  shop.fire('error', new TypeError('x'))
  shop.fire('unhandledrejection', new TypeError('x'))
  shop.firePageHide()
  await flushLogs(analytics)

  expect(exceptionLogs(logBodies)).toHaveLength(0)
  expect(suppressedLogs(logBodies)).toHaveLength(0)
})

test('T-050 / WA-5: captureErrorDetails after consent includes scrubbed message and stack', async () => {
  const { analytics, logBodies, shop } = startAnalytics(true, {
    name: 'errors-details',
    captureErrorDetails: true,
  })
  const failure = new TypeError('leak user@shop.test')

  shop.fire('error', failure)
  await flushLogs(analytics)

  const exceptions = exceptionLogs(logBodies)
  expect(exceptions).toHaveLength(1)
  const record = exceptions[0]!
  expect(record.severityNumber).toBe(17)
  expect(record.attributes['exception.type']).toBe('TypeError')
  expect(record.attributes['exception.message']).toBe('leak [email]')
  expect(record.attributes).toHaveProperty('exception.stacktrace')
  expect(String(record.attributes['exception.stacktrace'])).not.toContain(
    'user@shop.test',
  )
})

test('T-050 / WA-5: 100 identical errors emit 10 records plus a suppressed summary', async () => {
  const { analytics, logBodies, shop } = startAnalytics(true, {
    name: 'errors-identical',
  })

  for (let index = 0; index < 100; index++) {
    shop.fire('error', new TypeError('x'))
  }
  expect(readAnalyticsStats(analytics.otel).droppedByReason.rateLimit).toBe(90)

  shop.firePageHide()
  await flushLogs(analytics)

  const exceptions = exceptionLogs(logBodies)
  expect(exceptions).toHaveLength(10)
  expect(
    exceptions.every(
      (record) => record.attributes['exception.type'] === 'TypeError',
    ),
  ).toBe(true)
  expect(
    exceptions.every(
      (record) =>
        !('exception.message' in record.attributes) &&
        !('exception.stacktrace' in record.attributes),
    ),
  ).toBe(true)

  const suppressed = suppressedLogs(logBodies)
  expect(suppressed).toHaveLength(1)
  expect(suppressed[0]!.attributes['exception.type']).toBe('TypeError')
  expect(Number(suppressed[0]!.attributes['app.exception.count'])).toBe(100)
})

test('T-050 / R22: 100 alternating TypeError/RangeError cap at 10 each', async () => {
  const { analytics, logBodies, shop } = startAnalytics(true, {
    name: 'errors-alternating',
  })

  for (let index = 0; index < 200; index++) {
    shop.fire(
      'error',
      index % 2 === 0 ? new TypeError('x') : new RangeError('y'),
    )
  }
  expect(readAnalyticsStats(analytics.otel).droppedByReason.rateLimit).toBe(180)

  shop.firePageHide()
  await flushLogs(analytics)

  const exceptions = exceptionLogs(logBodies)
  const typeErrors = exceptions.filter(
    (record) => record.attributes['exception.type'] === 'TypeError',
  )
  const rangeErrors = exceptions.filter(
    (record) => record.attributes['exception.type'] === 'RangeError',
  )
  expect(typeErrors).toHaveLength(10)
  expect(rangeErrors).toHaveLength(10)

  const suppressed = suppressedLogs(logBodies)
  expect(suppressed).toHaveLength(2)
  const byType = Object.fromEntries(
    suppressed.map((record) => [
      record.attributes['exception.type'],
      Number(record.attributes['app.exception.count']),
    ]),
  )
  expect(byType).toEqual({ TypeError: 100, RangeError: 100 })
})

test('T-050 / R22: 100 app.page_view cap at 60 with stats.dropped.rateLimit', async () => {
  const { analytics, logBodies } = startAnalytics(true, {
    name: 'errors-page-view-cap',
    autoPageViews: false,
  })

  for (let index = 0; index < 100; index++) {
    context.start(() => analytics.pageView())
  }
  expect(readAnalyticsStats(analytics.otel).droppedByReason.rateLimit).toBe(40)

  await flushLogs(analytics)

  expect(logsNamed(logBodies, 'app.page_view')).toHaveLength(60)
})

test('T-050 / R22: rateLimit.errorsPerMin 0 means no client cap', async () => {
  const { analytics, logBodies, shop } = startAnalytics(true, {
    name: 'errors-no-cap',
    rateLimit: { errorsPerMin: 0 },
  })

  for (let index = 0; index < 15; index++) {
    shop.fire('error', new TypeError('x'))
  }
  shop.firePageHide()
  await flushLogs(analytics)

  expect(exceptionLogs(logBodies)).toHaveLength(15)
  expect(suppressedLogs(logBodies)).toHaveLength(0)
  expect(
    readAnalyticsStats(analytics.otel).droppedByReason.rateLimit,
  ).toBeUndefined()
})

test('T-050: dispose then reconnect does not stack rate-limit stats', async () => {
  const shop = installWindow()
  const otel = context.start(() =>
    reatomTestTelemetry({
      name: 'errors-reconnect',
      endpoint: 'https://collector.test',
      serviceName: 'site-web',
      skipGlobalExtension: true,
      useBeacon: false,
      retry: { maxRetries: 0 },
      batchInterval: 100_000,
      fetch: async () => new Response('{}', { status: 200 }),
    }),
  )
  cleanups.push(() => otel.dispose())

  const connect = () =>
    context.start(() =>
      createAnalytics(otel, {
        consent: true,
        navigation: 'popstate',
        autoPageViews: false,
      }),
    )

  const first = connect()
  const statsFn = otel.otlp.stats
  for (let index = 0; index < 15; index++) {
    shop.fire('error', new TypeError('x'))
  }
  expect(readAnalyticsStats(otel).droppedByReason.rateLimit).toBe(5)
  context.start(() => first.dispose())
  expect(otel.otlp.stats).toBe(statsFn)
  expect(readAnalyticsStats(otel).droppedByReason.rateLimit).toBeUndefined()

  first.enable()
  const second = first
  cleanups.push(() => second.dispose())
  expect(otel.otlp.stats).toBe(statsFn)
  for (let index = 0; index < 12; index++) {
    shop.fire('error', new TypeError('y'))
  }
  expect(readAnalyticsStats(otel).droppedByReason.rateLimit).toBe(2)
})
