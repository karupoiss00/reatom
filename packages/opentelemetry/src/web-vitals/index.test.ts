import { context } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'
import type { Metric } from 'web-vitals'

import { installBrowserCapture } from '../browserCapture.ts'
import type { BrowserCapture } from '../browserCapture.ts'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { connectWebVitals } from './index.ts'
import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { installDomStubs } from '../test-helpers.ts'
import { faroTransport } from '../faro/index.ts'

const callbacks = vi.hoisted(() => [] as Array<(metric: Metric) => void>)
vi.mock('web-vitals', () =>
  Object.fromEntries(
    ['onCLS', 'onFCP', 'onINP', 'onLCP', 'onTTFB'].map((key) => [
      key,
      (cb: (metric: Metric) => void) => callbacks.push(cb),
    ]),
  ),
)
afterEach(() => {
  callbacks.length = 0
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const setup = () => {
  const otel = {} as ReatomOpentelemetry
  const log = vi.fn()
  let enabled = true
  const cleanups = new Map<string | undefined, () => void>()
  const snapshot = {
    context: { traceId: 'trace', spanId: 'span' },
    attributes: { 'page.id': 'original' },
  }
  installBrowserCapture(otel, {
    enabled: () => enabled,
    snapshot: () => snapshot,
    log,
    attach: (cleanup: () => void, key?: string) => {
      cleanups.get(key)?.()
      cleanups.set(key, cleanup)
      return cleanup
    },
  } as unknown as BrowserCapture)
  return {
    otel,
    log,
    setEnabled: (value: boolean) => {
      enabled = value
    },
  }
}
const metric = {
  name: 'LCP',
  value: 123,
  delta: 23,
  id: 'v6-id',
  rating: 'good',
  navigationType: 'navigate',
  entries: [],
} as Metric

test('SSR connect does not register upstream callbacks', () => {
  connectWebVitals(setup().otel).dispose()
  expect(callbacks).toHaveLength(0)
})
test('registers all five official callbacks and emits Faro-compatible finite measurements', () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', {})
  const { otel, log, setEnabled } = setup()
  const collector = connectWebVitals(otel)
  expect(callbacks).toHaveLength(5)
  callbacks[0]!(metric)
  expect(log).toHaveBeenLastCalledWith(
    expect.objectContaining({
      eventName: 'measurement',
      attributes: expect.objectContaining({
        'measurement.type': 'web-vitals',
        'measurement.values': { lcp: 123, delta: 23 },
        'measurement.unit': 'ms',
        'web_vital.delta': 23,
        'web_vital.id': 'v6-id',
      }),
      snapshot: expect.objectContaining({
        attributes: { 'page.id': 'original' },
      }),
    }),
  )
  callbacks[0]!({ ...metric, value: Infinity })
  setEnabled(false)
  callbacks[0]!(metric)
  collector.dispose()
  setEnabled(true)
  callbacks[0]!(metric)
  expect(log).toHaveBeenCalledTimes(1)
})
test('replacement silences old callbacks and CLS is unitless', () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', {})
  const { otel, log } = setup()
  connectWebVitals(otel)
  const second = connectWebVitals(otel)
  expect(callbacks).toHaveLength(5)
  callbacks[0]!({ ...metric, name: 'CLS', value: 0.1 })
  expect(log).toHaveBeenCalledTimes(1)
  expect(log.mock.calls[0]![0].attributes['measurement.unit']).toBe('1')
  second.dispose()
})

test('real parent honors diagnostics/log switches, explicit disposal, keyed replacement and HMR', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const dom = installDomStubs()
  try {
    context.start(() => {
      const options = {
        name: 'metrics-real-lifetime',
        endpoint: null,
        serviceName: 'metrics',
        skipGlobalExtension: true,
      }
      const otel = reatomOpentelemetry(options)
      try {
        const first = connectWebVitals(otel)
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        first.dispose()
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        const second = connectWebVitals(otel)
        expect(otel.records()).toHaveLength(2) // Cached document metric.
        connectWebVitals(otel)
        expect(callbacks).toHaveLength(5)
        otel.clearRecords()
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        otel.options.set((value) => ({
          ...value,
          consent: { diagnostics: false },
        }))
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        otel.options.set((value) => ({
          ...value,
          consent: { diagnostics: true },
          signals: { logs: false },
        }))
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        otel.options.set((value) => ({ ...value, signals: { logs: true } }))
        const replacement = reatomOpentelemetry(options)
        try {
          callbacks[0]!(metric)
          expect(otel.records()).toHaveLength(0)
          expect(replacement.records()).toHaveLength(0)
          const count = callbacks.length
          connectWebVitals(otel).dispose()
          expect(callbacks).toHaveLength(count)
          connectWebVitals(replacement)
          expect(callbacks).toHaveLength(5)
          expect(replacement.records()).toHaveLength(1)
          callbacks[0]!(metric)
          expect(replacement.records()).toHaveLength(2)
          second.dispose()
        } finally {
          replacement.dispose()
        }
      } finally {
        otel.dispose()
      }
    })
  } finally {
    dom.restore()
  }
})

test('real queue and Faro transport preserve native lowercase Web Vitals values and delta', async () => {
  const dom = installDomStubs()
  const bodies: Array<{
    measurements?: Array<{
      type: string
      values: Record<string, number>
      context: Record<string, string>
    }>
  }> = []
  const otel = reatomOpentelemetry({
    name: 'web-vitals-faro-wire',
    endpoint: null,
    serviceName: 'metrics',
    skipGlobalExtension: true,
    transports: [
      faroTransport({
        endpoint: 'https://faro.test/collect',
        fetch: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)))
          return new Response('{}')
        },
      }),
    ],
  })
  const collector = connectWebVitals(otel)
  try {
    callbacks[0]!(metric)
    await otel.flush()
    const measurements = bodies.flatMap((body) => body.measurements ?? [])
    expect(measurements).toHaveLength(1)
    expect(measurements[0]).toMatchObject({
      type: 'web-vitals',
      values: { lcp: 123, delta: 23 },
      context: { 'web_vital.name': 'LCP', 'measurement.unit': 'ms' },
    })
    expect(measurements[0]!.values).not.toHaveProperty('LCP')
  } finally {
    collector.dispose()
    otel.dispose()
    dom.restore()
  }
})
