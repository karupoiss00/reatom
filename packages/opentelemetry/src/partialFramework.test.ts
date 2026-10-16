
import { action, atom, bind, context, wrap } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { connectWebAnalytics } from './web-analytics/index.ts'

const nativeFetch = globalThis.fetch
const VENDOR_NAME = /(?:^|[."'])(vendor\.|vue\.|react\.)/

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    const stop = cleanups.pop()!
    context.start(() => stop())
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(
    globalThis,
    Symbol.for('reatom.opentelemetry.analytics.pageViews'),
  )
})

const installHostWindow = () => {
  let href = 'https://host.test/island'
  const navigationListeners = new Map<string, Set<(event?: Event) => void>>()
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
  const history = {
    pushState(_state: unknown, _title: string, url?: string | URL | null) {
      href = new URL(String(url ?? href), href).href
    },
    replaceState(_state: unknown, _title: string, url?: string | URL | null) {
      href = new URL(String(url ?? href), href).href
    },
  }
  const navigation = {
    addEventListener: vi.fn((type: string, fn: (event?: Event) => void) => {
      const set = navigationListeners.get(type) ?? new Set()
      set.add(fn)
      navigationListeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, fn: (event?: Event) => void) => {
      navigationListeners.get(type)?.delete(fn)
    }),
  }
  const documentStub = {
    visibilityState: 'visible' as const,
    body: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const windowStub = {
    location,
    history,
    navigation,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    document: documentStub,
  }
  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', documentStub)
  vi.stubGlobal('location', location)
  vi.stubGlobal('history', history)
  vi.stubGlobal('navigation', navigation)
}

const isIslandTarget = (target: { name: string }) =>
  target.name.startsWith('island.')

const otlpStringAttrs = (record: object): Record<string, string> => {
  const raw = 'attributes' in record ? record.attributes : undefined
  if (!Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const key = 'key' in item ? item.key : undefined
    const value = 'value' in item ? item.value : undefined
    const stringValue =
      value && typeof value === 'object' && 'stringValue' in value
        ? value.stringValue
        : undefined
    if (typeof key === 'string' && typeof stringValue === 'string') {
      out[key] = stringValue
    }
  }
  return out
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

const collectNames = (records: readonly unknown[]): string[] => {
  const names = new Set<string>()
  visitRecords(records, (record) => {
    if ('name' in record && typeof record.name === 'string') {
      names.add(record.name)
    }
    if ('eventName' in record && typeof record.eventName === 'string') {
      names.add(record.eventName)
    }
    const attrs = otlpStringAttrs(record)
    if (attrs['reatom.name']) names.add(attrs['reatom.name'])
    if (attrs['event.name']) names.add(attrs['event.name'])
  })
  return [...names]
}

const vendorNamesOf = (names: readonly string[]): string[] =>
  names.filter((name) => VENDOR_NAME.test(name))

const islandActionSpans = (records: readonly unknown[]): object[] => {
  const spans: object[] = []
  visitRecords(records, (record) => {
    const spanId = 'spanId' in record ? record.spanId : undefined
    const name = 'name' in record ? record.name : undefined
    const attrs = otlpStringAttrs(record)
    if (typeof spanId !== 'string' || typeof name !== 'string') return
    if (!('startTimeUnixNano' in record)) return
    if (name.startsWith('island.') || attrs['reatom.name']?.startsWith('island.')) {
      spans.push(record)
    }
  })
  return spans
}

const pageViewRecords = (records: readonly unknown[]): object[] => {
  const views: object[] = []
  visitRecords(records, (record) => {
    const eventName =
      'eventName' in record && typeof record.eventName === 'string'
        ? record.eventName
        : otlpStringAttrs(record)['event.name']
    if (eventName === 'app.page_view') views.push(record)
  })
  return views
}

const atomUpdateNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  visitRecords(records, (record) => {
    const eventName =
      'eventName' in record && typeof record.eventName === 'string'
        ? record.eventName
        : otlpStringAttrs(record)['event.name']
    if (
      eventName !== 'reatom.atom.update' &&
      eventName !== 'reatom.computed.update'
    ) {
      return
    }
    const reatomName = otlpStringAttrs(record)['reatom.name']
    if (reatomName) names.push(reatomName)
  })
  return names
}

test('F-14: island action spans appear while filter silences vendor names and fetch stays unpatched', async () => {
  expect(globalThis.fetch).toBe(nativeFetch)
  installHostWindow()

  const appFetch = vi.fn<typeof fetch>(
    async () => new Response('hits', { status: 200 }),
  )
  const islandTransportFetch = vi.fn<typeof fetch>(
    async () => new Response('{}', { status: 200 }),
  )
  const analyticsTransportFetch = vi.fn<typeof fetch>(
    async () => new Response('{}', { status: 200 }),
  )

  const islandOtel = context.start(() => {
    const otel = reatomOpentelemetry({
      name: 'island',
      endpoint: null,
      serviceName: 'island-web',
      skipGlobalExtension: false,
      filter: isIslandTarget,
      fetch: islandTransportFetch,
      useBeacon: false,
      retry: { maxRetries: 0 },
      batchInterval: 100_000,
      maxBatchSize: 100,
      maxQueueSize: 100,
    })
    cleanups.push(() => otel.dispose())
    return otel
  })

  const analytics = context.start(() => {
    const model = connectWebAnalytics({
      name: 'site',
      endpoint: null,
      serviceName: 'site-web',
      skipGlobalExtension: true,
      consent: true,
      navigation: 'navigation-api',
      fetch: analyticsTransportFetch,
      useBeacon: false,
      retry: { maxRetries: 0 },
      batchInterval: 100_000,
      maxBatchSize: 100,
      maxQueueSize: 100,
    })
    cleanups.push(() => model.dispose())
    return model
  })

  expect(globalThis.fetch).toBe(nativeFetch)

  const run = context.start(() => bind(<T>(callback: () => T) => callback()))
  const models = run(() => {
    const islandQuery = atom('', 'island.query')
    const searchIsland = action(async () => {
      const response = await wrap(
        appFetch('https://api.island.test/search'),
      )
      const payload = await wrap(response.text())
      islandQuery.set(payload)
      return islandQuery()
    }, 'island.search')
    const vendorReactStore = atom('idle', 'vendor.react.store')
    const vueCounter = atom(0, 'vue.counter')
    const vendorFrameworkTick = action(() => {
      vendorReactStore.set('ticked')
      vueCounter.set((count) => count + 1)
      return vendorReactStore()
    }, 'vendor.framework.tick')
    return {
      islandQuery,
      searchIsland,
      vendorReactStore,
      vueCounter,
      vendorFrameworkTick,
    }
  })

  expect(run(() => models.vendorFrameworkTick())).toBe('ticked')
  expect(run(() => models.vueCounter())).toBe(1)
  expect(await run(models.searchIsland)).toBe('hits')
  expect(run(() => models.islandQuery())).toBe('hits')

  await context.start(() => islandOtel.flush())
  await context.start(() => analytics.otel.flush())

  expect(globalThis.fetch).toBe(nativeFetch)
  expect(appFetch).toHaveBeenCalledTimes(1)
  expect(appFetch.mock.calls[0]![0]).toBe('https://api.island.test/search')
  expect(islandTransportFetch).not.toHaveBeenCalled()
  expect(analyticsTransportFetch).not.toHaveBeenCalled()

  const islandRecords = [...islandOtel.records()]
  const analyticsRecords = [...analytics.otel.records()]
  const islandSpans = islandActionSpans(islandRecords)
  const views = pageViewRecords(analyticsRecords)
  const islandNames = collectNames(islandRecords)
  const islandVendorNames = vendorNamesOf(islandNames)

  expect(islandSpans.length).toBeGreaterThan(0)
  expect(
    islandSpans.some((span) => {
      const name = 'name' in span ? span.name : undefined
      const attrs = otlpStringAttrs(span)
      return name === 'island.search' || attrs['reatom.name'] === 'island.search'
    }),
  ).toBe(true)
  expect(islandNames).toContain('island.search')
  expect(islandVendorNames).toEqual([])
  expect(views.length).toBeGreaterThan(0)
  expect(atomUpdateNames(islandRecords)).not.toContain('vendor.react.store')
  expect(atomUpdateNames(islandRecords)).not.toContain('vue.counter')
})
