import { context } from '@reatom/core'
import { onTestFinished, afterEach, expect, test, vi } from 'vitest'
import type { Metric } from 'web-vitals'

import { browserCaptureOf, installBrowserCapture } from '../browserCapture.ts'
import type { BrowserCapture } from '../browserCapture.ts'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { withWebVitals } from './index.ts'
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
  const dom = installDomStubs()
  onTestFinished(() => dom.restore())
  const otel = reatomOpentelemetry({
    name: 'web-vitals-observer-spy',
    endpoint: null,
    skipGlobalExtension: true,
  })
  onTestFinished(() => otel.dispose())
  const log = vi.fn()
  let enabled = true
  let snapshot = {
    context: { traceId: 'trace', spanId: 'span' },
    attributes: { 'page.id': 'original' },
  }
  installBrowserCapture(otel, {
    ...browserCaptureOf(otel)!,
    enabled: () => enabled,
    snapshot: () => snapshot,
    log,
  } as unknown as BrowserCapture)
  return {
    otel,
    log,
    setPage: (id: string) => {
      snapshot = { ...snapshot, attributes: { 'page.id': id } }
    },
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

const applyVitals = (otel: ReatomOpentelemetry) =>
  otel.extend(withWebVitals()).webVitals

test('SSR connect does not register upstream callbacks', () => {
  const { otel } = setup()
  vi.stubGlobal('window', undefined)
  const control = applyVitals(otel)
  expect(control()).toBe(true)
  control.setFalse()
  expect(callbacks).toHaveLength(0)
})
test('registers all five official callbacks and emits Faro-compatible finite measurements', () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', {})
  const { otel, log, setEnabled } = setup()
  const collector = applyVitals(otel)
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
  collector.setFalse()
  setEnabled(true)
  callbacks[0]!(metric)
  expect(log).toHaveBeenCalledTimes(1)
})
test('replacement silences old callbacks and CLS is unitless', () => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', {})
  const { otel, log } = setup()
  const second = applyVitals(otel)
  expect(() => applyVitals(otel)).toThrow()
  second.setFalse()
  expect(() => applyVitals(otel)).toThrow()
  second.setTrue()
  expect(callbacks).toHaveLength(5)
  callbacks[0]!({ ...metric, name: 'CLS', value: 0.1 })
  expect(log).toHaveBeenCalledTimes(1)
  expect(log.mock.calls[0]![0].attributes['measurement.unit']).toBe('1')
  second.setFalse()
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
        const first = applyVitals(otel)
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        first.setFalse()
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        first.setTrue()
        const second = first
        expect(otel.records()).toHaveLength(2) // Cached document metric.
        expect(() => applyVitals(otel)).toThrow()
        expect(callbacks).toHaveLength(5)
        otel.clearRecords()
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        otel.set((value) => ({
          ...value,
          consent: { diagnostics: false },
        }))
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        otel.set((value) => ({
          ...value,
          consent: { diagnostics: true },
          signals: { logs: false },
        }))
        callbacks[0]!(metric)
        expect(otel.records()).toHaveLength(1)
        otel.set((value) => ({ ...value, signals: { logs: true } }))
        const replacement = reatomOpentelemetry(options)
        try {
          callbacks[0]!(metric)
          expect(otel.records()).toHaveLength(0)
          expect(replacement.records()).toHaveLength(0)
          const count = callbacks.length
          expect(() => applyVitals(otel)).toThrow()
          expect(callbacks).toHaveLength(count)
          applyVitals(replacement)
          expect(callbacks).toHaveLength(5)
          expect(replacement.records()).toHaveLength(1)
          callbacks[0]!(metric)
          expect(replacement.records()).toHaveLength(2)
          second.setFalse()
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
  const collector = applyVitals(otel)
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
    collector.setFalse()
    otel.dispose()
    dom.restore()
  }
})

test('Web Vitals replay keeps the application-time document snapshot across disable and reenable', () => {
  const { otel, log, setPage } = setup()
  const control = applyVitals(otel)
  callbacks[0]!(metric)
  control.setFalse()
  setPage('new-login-page')
  control.setTrue()
  expect(log).toHaveBeenCalledTimes(2)
  expect(log.mock.calls[1]![0].snapshot.attributes).toEqual({
    'page.id': 'original',
  })
  callbacks[0]!({ ...metric, value: 456 })
  expect(log.mock.calls[2]![0].snapshot.attributes).toEqual({
    'page.id': 'original',
  })
  expect(callbacks).toHaveLength(5)
})
