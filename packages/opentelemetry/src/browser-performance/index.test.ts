import { context } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'
import { installBrowserCapture, setBrowserMetadata } from '../browserCapture.ts'
import type { BrowserCapture } from '../browserCapture.ts'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { connectBrowserPerformance } from './index.ts'
import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { installDomStubs } from '../test-helpers.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
const setup = () => {
  const otel = {} as ReatomOpentelemetry
  const log = vi.fn()
  const observers: Array<{
    callback: PerformanceObserverCallback
    observe: ReturnType<typeof vi.fn>
    disconnect: ReturnType<typeof vi.fn>
  }> = []
  let cleanup = () => {}
  let enabled = true
  installBrowserCapture(otel, {
    attach: (next: () => void) => {
      cleanup()
      cleanup = next
      return next
    },
    enabled: () => enabled,
    snapshot: () => ({ attributes: { 'page.id': 'current' }, context: {} }),
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
  vi.stubGlobal('window', {})
  vi.stubGlobal('PerformanceObserver', Observer)
  const deliver = (entry: Partial<PerformanceResourceTiming>) =>
    observers[0]!.callback(
      { getEntries: () => [entry] } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    )
  return {
    otel,
    log,
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

test('buffered resource measurements sanitize URLs, units, consent and transport exclusion', () => {
  const { otel, log, observers, deliver, setEnabled } = setup()
  const collector = connectBrowserPerformance(otel, { navigation: false })
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
  collector.dispose()
  setEnabled(true)
  deliver(entry)
  expect(log).toHaveBeenCalledTimes(1)
  expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
})
test('reconnection disconnects previous observers and unsupported types are skipped', () => {
  const { otel, observers } = setup()
  connectBrowserPerformance(otel)
  connectBrowserPerformance(otel, {
    navigation: false,
    resources: false,
  }).dispose()
  expect(observers).toHaveLength(2)
  expect(
    observers.every((observer) => observer.disconnect.mock.calls.length === 1),
  ).toBe(true)
})

test('real parent disconnects native observers on explicit dispose, reconnect, parent disposal and HMR', () => {
  const { observers, deliver } = setup()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const dom = installDomStubs()
  try {
    context.start(() => {
      const options = {
        name: 'performance-real-lifetime',
        endpoint: null,
        serviceName: 'metrics',
        skipGlobalExtension: true,
      }
      const otel = reatomOpentelemetry(options)
      try {
        const first = connectBrowserPerformance(otel, { navigation: false })
        deliver(entry)
        expect(otel.records()).toHaveLength(1)
        first.dispose()
        deliver(entry)
        expect(otel.records()).toHaveLength(1)
        expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
        connectBrowserPerformance(otel)
        connectBrowserPerformance(otel)
        expect(observers[1]!.disconnect).toHaveBeenCalledTimes(1)
        expect(observers[2]!.disconnect).toHaveBeenCalledTimes(1)
        const replacement = reatomOpentelemetry(options)
        try {
          expect(observers[3]!.disconnect).toHaveBeenCalledTimes(1)
          expect(observers[4]!.disconnect).toHaveBeenCalledTimes(1)
          connectBrowserPerformance(replacement)
          replacement.dispose()
          connectBrowserPerformance(replacement).dispose()
          expect(observers).toHaveLength(7)
          expect(observers[5]!.disconnect).toHaveBeenCalledTimes(1)
          expect(observers[6]!.disconnect).toHaveBeenCalledTimes(1)
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

test('SSR does not construct PerformanceObserver', () => {
  const { otel, observers } = setup()
  vi.stubGlobal('window', undefined)
  connectBrowserPerformance(otel).dispose()
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
  const collector = connectBrowserPerformance(otel, {
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
    collector.dispose()
  }
})

test('real parent stops a delivered batch when ignoreUrl disposes or replaces its collector', () => {
  const { observers } = setup()
  const dom = installDomStubs()
  try {
    context.start(() => {
      const otel = reatomOpentelemetry({
        name: 'performance-reentrant-dispose',
        endpoint: null,
        serviceName: 'metrics',
        skipGlobalExtension: true,
      })
      const batch = {
        getEntries: () => [
          entry,
          { ...entry, name: 'https://site.test/second' },
        ],
      } as PerformanceObserverEntryList
      const deliver = (index: number) =>
        observers[index]!.callback(batch, {} as PerformanceObserver)
      try {
        let collector: { dispose(): void }
        const ignoreUrl = vi.fn(() => {
          collector.dispose()
          return false
        })
        collector = connectBrowserPerformance(otel, {
          navigation: false,
          ignoreUrl,
        })
        deliver(0)
        expect(ignoreUrl).toHaveBeenCalledTimes(1)
        expect(observers[0]!.disconnect).toHaveBeenCalledTimes(1)
        expect(otel.records()).toHaveLength(0)
        deliver(0)
        expect(ignoreUrl).toHaveBeenCalledTimes(1)
        const replace = vi.fn(() => {
          connectBrowserPerformance(otel, { navigation: false })
          return false
        })
        connectBrowserPerformance(otel, {
          navigation: false,
          ignoreUrl: replace,
        })
        deliver(1)
        expect(replace).toHaveBeenCalledTimes(1)
        expect(observers[1]!.disconnect).toHaveBeenCalledTimes(1)
        expect(otel.records()).toHaveLength(0)
        deliver(1)
        expect(replace).toHaveBeenCalledTimes(1)
        const snapshotCollector = connectBrowserPerformance(otel, {
          navigation: false,
        })
        const clearMetadata = setBrowserMetadata(otel, () => {
          snapshotCollector.dispose()
          return {}
        })
        try {
          deliver(3)
          expect(observers[3]!.disconnect).toHaveBeenCalledTimes(1)
          expect(otel.records()).toHaveLength(0)
        } finally {
          clearMetadata()
        }
      } finally {
        otel.dispose()
      }
    })
  } finally {
    dom.restore()
  }
})
