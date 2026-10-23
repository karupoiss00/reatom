import { context } from '@reatom/core'
import { onTestFinished, afterEach, expect, test, vi } from 'vitest'
import {
  browserCaptureOf,
  installBrowserCapture,
  setBrowserMetadata,
} from '../browserCapture.ts'
import type { BrowserCapture } from '../browserCapture.ts'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { withBrowserPerformance } from './index.ts'
import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { installDomStubs } from '../test-helpers.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const setup = () => {
  const dom = installDomStubs()
  onTestFinished(() => dom.restore())
  const otel = reatomOpentelemetry({
    name: 'browser-performance-observer-spy',
    endpoint: null,
    skipGlobalExtension: true,
  })
  onTestFinished(() => otel.dispose())
  const log = vi.fn()
  const observers: Array<{
    callback: PerformanceObserverCallback
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }> = []
  let enabled = true
  let page = 'current'
  installBrowserCapture(otel, {
    ...browserCaptureOf(otel)!,
    enabled: () => enabled,
    snapshot: () => ({ attributes: { 'page.id': page }, context: {} }),
    log,
    isTransportUrl: (url: string) => url.includes('/collect'),
  } as unknown as BrowserCapture)
  class Observer {
    static supportedEntryTypes = ['navigation', 'resource']
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(public callback: PerformanceObserverCallback) {
      observers.push(this)
    }
  }
  vi.stubGlobal('PerformanceObserver', Observer)
  const deliver = (entry: Partial<PerformanceResourceTiming>) =>
    observers[0]!.callback(
      { getEntries: () => [entry] } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    )
  return {
    otel,
    log,
    setPage: (id: string) => {
      page = id
    },
    observers,
    deliver,
    setEnabled: (value: boolean) => {
      enabled = value
    },
  }
}
const entry = {
  entryType: 'resource',
  name: 'https://user:pass@site.test/file?secret=1#private',
  duration: 12,
  startTime: 2,
  domainLookupStart: 0,
  domainLookupEnd: 1,
  connectStart: 1,
  connectEnd: 2,
  requestStart: 3,
  responseStart: 5,
  responseEnd: 12,
  transferSize: 123,
  encodedBodySize: 100,
  decodedBodySize: 200,
  initiatorType: 'fetch',
}

const applyPerformance = (
  otel: ReatomOpentelemetry,
  options?: Parameters<typeof withBrowserPerformance>[0],
) => otel.extend(withBrowserPerformance(options)).browserPerformance

test('buffered resource measurements sanitize URLs, units, consent and transport exclusion', () => {
  const { otel, log, observers, deliver, setEnabled } = setup()
  const collector = applyPerformance(otel, { navigation: false })
  expect(observers[0]!.observe).toHaveBeenCalledWith({
    type: 'resource',
    buffered: true,
  })
  deliver(entry)
  const record = log.mock.calls[0]![0]
  expect(record.attributes['url.full']).toBe('https://site.test/file')
  expect(record.attributes['measurement.values']).toMatchObject({
    duration: 12,
    transfer_size: 123,
  })
  expect(record.attributes['measurement.units']).toMatchObject({
    duration: 'ms',
    transfer_size: 'By',
  })
  deliver({ ...entry, name: 'https://site.test/collect' })
  deliver({ ...entry, name: 'data:text/plain,secret' })
  setEnabled(false)
  deliver(entry)
  collector.setFalse()
  setEnabled(true)
  deliver(entry)
  expect(log).toHaveBeenCalledTimes(1)
  expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
})
test('duplicate preflight runs before observers, including when disabled', () => {
  const { otel, observers } = setup()
  const control = applyPerformance(otel)
  expect(control()).toBe(true)
  expect(() => applyPerformance(otel)).toThrow()
  expect(observers).toHaveLength(2)
  control.setFalse()
  expect(() =>
    applyPerformance(otel, { navigation: false, resources: false }),
  ).toThrow()
  expect(
    observers.every((observer) => observer.disconnect.mock.calls.length === 1),
  ).toBe(true)
  control.setTrue()
  expect(observers).toHaveLength(4)
})

test('real parent toggles and HMR disconnect owned observers; disposed parent cannot restart', () => {
  const { observers, deliver } = setup()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  context.start(() => {
    const options = {
      name: 'performance-real-lifetime',
      endpoint: null,
      serviceName: 'metrics',
      skipGlobalExtension: true,
    }
    const otel = reatomOpentelemetry(options)
    try {
      const control = applyPerformance(otel, { navigation: false })
      deliver(entry)
      expect(otel.records()).toHaveLength(1)
      control.setFalse()
      deliver(entry)
      expect(otel.records()).toHaveLength(1)
      expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
      expect(() => applyPerformance(otel)).toThrow()
      control.setTrue()
      control.setFalse()
      control.setTrue()
      expect(observers[1]!.disconnect).toHaveBeenCalledTimes(1)
      const replacement = reatomOpentelemetry(options)
      try {
        expect(observers[2]!.disconnect).toHaveBeenCalledTimes(1)
        applyPerformance(replacement)
        replacement.dispose()
        expect(() => applyPerformance(replacement)).toThrow()
        expect(() => context.start(() => control.setTrue())).toThrow()
        expect(control()).toBe(false)
        expect(observers).toHaveLength(5)
        expect(observers[3]!.disconnect).toHaveBeenCalledTimes(1)
        expect(observers[4]!.disconnect).toHaveBeenCalledTimes(1)
      } finally {
        replacement.dispose()
      }
    } finally {
      otel.dispose()
    }
  })
})

test('SSR does not construct PerformanceObserver', () => {
  const { otel, observers } = setup()
  vi.stubGlobal('window', undefined)
  applyPerformance(otel).setFalse()
  expect(observers).toHaveLength(0)
})

test('custom URL exclusion sees full URL, cannot mutate emitted URL, and throwing predicates skip entries', () => {
  const { otel, log, deliver } = setup()
  const ignoreUrl = vi.fn((url: URL) => {
    if (url.searchParams.has('exclude')) return true
    if (url.searchParams.has('throw')) throw new Error('predicate failed')
    expect(url.href).toBe(entry.name)
    expect(url.username).toBe('user')
    expect(url.searchParams.get('secret')).toBe('1')
    expect(url.hash).toBe('#private')
    url.pathname = '/mutated'
    return false
  })
  const collector = applyPerformance(otel, {
    navigation: false,
    ignoreUrl,
  })
  try {
    deliver({ ...entry, name: 'https://site.test/custom?exclude=1' })
    expect(() =>
      deliver({ ...entry, name: 'https://site.test/custom?throw=1' }),
    ).not.toThrow()
    deliver(entry)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]![0].attributes['url.full']).toBe(
      'https://site.test/file',
    )
    expect(ignoreUrl).toHaveBeenCalledTimes(3)
  } finally {
    collector.setFalse()
  }
})

test('real parent stops a delivered batch when ignoreUrl disables or toggles its collector', () => {
  const { observers } = setup()
  context.start(() => {
    const otel = reatomOpentelemetry({
      name: 'performance-reentrant-disable',
      endpoint: null,
      serviceName: 'metrics',
      skipGlobalExtension: true,
    })
    const batch = {
      getEntries: () => [entry, { ...entry, name: 'https://site.test/second' }],
    } as PerformanceObserverEntryList
    const deliver = (index: number) =>
      observers[index]!.callback(batch, {} as PerformanceObserver)
    let mode: 'disable' | 'toggle' | 'normal' = 'disable'
    let control: ReturnType<typeof applyPerformance>
    const ignoreUrl = vi.fn(() => {
      if (mode === 'disable') control.setFalse()
      if (mode === 'toggle') {
        mode = 'normal'
        control.setFalse()
        control.setTrue()
      }
      return false
    })
    try {
      control = applyPerformance(otel, { navigation: false, ignoreUrl })
      deliver(0)
      expect(ignoreUrl).toHaveBeenCalledTimes(1)
      expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
      expect(otel.records()).toHaveLength(0)
      deliver(0)
      expect(ignoreUrl).toHaveBeenCalledTimes(1)
      mode = 'toggle'
      control.setTrue()
      deliver(1)
      expect(ignoreUrl).toHaveBeenCalledTimes(2)
      expect(observers[1]!.disconnect).toHaveBeenCalledTimes(1)
      expect(otel.records()).toHaveLength(0)
      deliver(1)
      expect(ignoreUrl).toHaveBeenCalledTimes(2)
      const clearMetadata = setBrowserMetadata(otel, () => {
        control.setFalse()
        return {}
      })
      try {
        deliver(2)
        expect(observers[2]!.disconnect).toHaveBeenCalledTimes(1)
        expect(otel.records()).toHaveLength(0)
      } finally {
        clearMetadata()
      }
    } finally {
      otel.dispose()
    }
  })
})

test('buffered navigation keeps application snapshot across toggles while resources sample delivery', () => {
  const { otel, observers, log, setPage } = setup()
  const control = applyPerformance(otel)
  control.setFalse()
  setPage('new-login-page')
  control.setTrue()
  const navigation = {
    ...entry,
    entryType: 'navigation',
    type: 'navigate',
    domInteractive: 1,
    domContentLoadedEventEnd: 2,
    loadEventEnd: 3,
  }
  observers[2]!.callback(
    {
      getEntries: () => [navigation],
    } as unknown as PerformanceObserverEntryList,
    {} as PerformanceObserver,
  )
  observers[3]!.callback(
    { getEntries: () => [entry] } as unknown as PerformanceObserverEntryList,
    {} as PerformanceObserver,
  )
  expect(log).toHaveBeenCalledTimes(2)
  expect(log.mock.calls[0]![0].snapshot.attributes['page.id']).toBe('current')
  expect(log.mock.calls[1]![0].snapshot.attributes['page.id']).toBe(
    'new-login-page',
  )
})
