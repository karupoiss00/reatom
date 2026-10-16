import { context, noop, reatomRoute, urlAtom, wrap } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import {
  connectWebAnalytics,
  type WebAnalyticsCreateOptions,
} from './connectWebAnalytics.ts'

const LANDING =
  'https://shop.test/home?utm_source=google&gclid=abc#promo'
const STRIPPED_FULL = 'https://shop.test/home'
const STRIPPED_PATH = '/home'

const OPTIONS = {
  name: 'site',
  endpoint: null as const,
  serviceName: 'site-web',
  skipGlobalExtension: true as const,
  useBeacon: false as const,
  batchInterval: 100_000,
  maxBatchSize: 100,
  maxQueueSize: 100,
}

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) {
    const stop = cleanups.pop()!
    context.start(() => stop())
  }
  urlAtom.routes = {}
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

const installShopWindow = (options?: {
  href?: string
  navigationApi?: boolean
}) => {
  let href = options?.href ?? LANDING
  const sequence: string[] = []
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
      sequence.push(href)
    },
    replaceState(_state: unknown, _title: string, url?: string | URL | null) {
      href = new URL(String(url ?? href), href).href
      sequence.push(href)
    },
  }

  const body = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }

  const navigation =
    options?.navigationApi === false
      ? undefined
      : {
          addEventListener: vi.fn((type: string, fn: (event?: Event) => void) => {
            const set = navigationListeners.get(type) ?? new Set()
            set.add(fn)
            navigationListeners.set(type, set)
          }),
          removeEventListener: vi.fn(
            (type: string, fn: (event?: Event) => void) => {
              navigationListeners.get(type)?.delete(fn)
            },
          ),
        }

  const windowStub = {
    location,
    history,
    navigation,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    document: {
      visibilityState: 'visible' as const,
      body,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  }

  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', windowStub.document)
  vi.stubGlobal('location', location)
  vi.stubGlobal('history', history)
  if (navigation) vi.stubGlobal('navigation', navigation)

  return {
    sequence,
    history,
    location,
    navigation,
    body,
    clickSpaLink(path: string) {
      history.pushState({}, '', path)
    },
    fireNavigationChange() {
      navigationListeners.get('currententrychange')?.forEach((fn) => fn())
    },
  }
}

const decodeOtlpValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const rec = value as Record<string, unknown>
  if ('stringValue' in rec) return rec.stringValue
  if ('intValue' in rec) return rec.intValue
  if ('boolValue' in rec) return rec.boolValue
  if ('doubleValue' in rec) return rec.doubleValue
  if ('arrayValue' in rec) {
    const values =
      (rec.arrayValue as { values?: unknown[] } | undefined)?.values ?? []
    return values.map(decodeOtlpValue)
  }
  if ('kvlistValue' in rec) {
    const entries =
      (
        rec.kvlistValue as {
          values?: Array<{ key: string; value: unknown }>
        }
      )?.values ?? []
    return Object.fromEntries(
      entries.map(({ key, value: nested }) => [key, decodeOtlpValue(nested)]),
    )
  }
  return value
}

const attrsOf = (record: object): Record<string, unknown> => {
  const raw = 'attributes' in record ? record.attributes : undefined
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const key = 'key' in item ? item.key : undefined
      const value = 'value' in item ? item.value : undefined
      if (typeof key === 'string') out[key] = decodeOtlpValue(value)
    }
    return out
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  return {}
}

const eventNameOf = (record: object): string | undefined => {
  const fromField =
    'eventName' in record && typeof record.eventName === 'string'
      ? record.eventName
      : undefined
  const fromAttr = attrsOf(record)['event.name']
  return fromField ?? (typeof fromAttr === 'string' ? fromAttr : undefined)
}

type PageViewLog = {
  eventName?: string
  attributes: Record<string, unknown>
  traceId?: string
}

const spanNamed = (
  records: readonly unknown[],
  name: string,
): { name: string; traceId?: string } | undefined => {
  let found: { name: string; traceId?: string } | undefined
  const visit = (value: unknown) => {
    if (found || value === null || typeof value !== 'object') return
    const recordName = 'name' in value ? value.name : undefined
    if (typeof recordName === 'string' && recordName === name) {
      found = {
        name: recordName,
        traceId:
          'traceId' in value && typeof value.traceId === 'string'
            ? value.traceId
            : undefined,
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  for (const record of records) visit(record)
  return found
}

const spanNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  const visit = (value: unknown) => {
    if (value === null || typeof value !== 'object') return
    const recordName = 'name' in value ? value.name : undefined
    const spanId = 'spanId' in value ? value.spanId : undefined
    if (typeof recordName === 'string' && typeof spanId === 'string') {
      names.push(recordName)
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  for (const record of records) visit(record)
  return names
}

const collectPageViews = (records: readonly unknown[]): PageViewLog[] => {
  const found: PageViewLog[] = []
  const visit = (value: unknown) => {
    if (value === null || typeof value !== 'object') return
    if (eventNameOf(value) === 'app.page_view') {
      found.push({
        eventName:
          'eventName' in value && typeof value.eventName === 'string'
            ? value.eventName
            : undefined,
        attributes: attrsOf(value),
        traceId:
          'traceId' in value && typeof value.traceId === 'string'
            ? value.traceId
            : undefined,
      })
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  for (const record of records) visit(record)
  return found
}

const readRecords = (
  otel: ReturnType<typeof connectWebAnalytics>['otel'],
): readonly unknown[] => {
  expect(typeof otel.records).toBe('function')
  const snapshot = otel.records()
  expect(Array.isArray(snapshot)).toBe(true)
  return snapshot
}

const fetchUrls = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetchMock.mock.calls.map(([input]) =>
    String(input instanceof Request ? input.url : input),
  )

const fetchBodies = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetchMock.mock.calls.map(([, init]) => {
    const body = init?.body
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return new TextDecoder().decode(body)
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
    return String(body)
  })

const pageViewsInFetch = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) =>
  fetchBodies(fetchMock).flatMap((body) => {
    if (!body) return []
    try {
      return collectPageViews([JSON.parse(body)])
    } catch {
      return body.includes('app.page_view') ? [{ attributes: {} }] : []
    }
  })

const expectOtelFetchUrlsOnly = (urls: string[]) => {
  for (const url of urls) {
    expect(url, `unexpected analytics URL ${url}`).toMatch(
      /\/v1\/(logs|traces)(?:\?|$)/,
    )
  }
}

const connectSite = (
  overrides: Partial<WebAnalyticsCreateOptions> = {},
  fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })),
) => {
  const analytics = remember(
    connectWebAnalytics({
      ...OPTIONS,
      fetch: fetchMock,
      ...overrides,
    }),
  )
  return { analytics, fetchMock }
}

test('WA-2 / F-08: consent true records one app.page_view with stripped url and UTM/click ids', () => {
  installShopWindow()
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response('{}', { status: 200 }),
  )

  const analytics = context.start(() =>
    connectSite(
      {
        name: 'page-view-consent',
        consent: true,
      },
      fetchMock,
    ).analytics,
  )

  const views = collectPageViews(readRecords(analytics.otel))
  expect(views).toHaveLength(1)
  const view = views[0]!

  expect(view.eventName).toBe('app.page_view')
  expect(view.attributes['event.name']).toBe('app.page_view')
  expect(view.attributes['url.path']).toBe(STRIPPED_PATH)
  expect(view.attributes['url.full']).toBe(STRIPPED_FULL)
  expect(String(view.attributes['url.full'])).not.toMatch(/[?#]/)
  expect(String(view.attributes['url.full'])).not.toMatch(/utm_source|gclid/)
  expect(String(view.attributes['url.path'])).not.toMatch(/[?#]/)
  expect(view.attributes['app.utm.source']).toBe('google')
  expect(view.attributes['app.click_id.gclid']).toBe('abc')

  expectOtelFetchUrlsOnly(fetchUrls(fetchMock))
})

test.each([false, undefined] as const)(
  'WA-2 / R11: consent %s must not emit or fetch app.page_view',
  async (consent) => {
    installShopWindow()
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('{}', { status: 200 }),
    )
    const overrides =
      consent === undefined
        ? {
            name: 'page-view-no-consent',
            endpoint: 'https://collector.test',
            keepRecords: true as const,
          }
        : {
            name: 'page-view-consent-false',
            endpoint: 'https://collector.test',
            keepRecords: true as const,
            consent,
          }

    const analytics = context.start(() => connectSite(overrides, fetchMock).analytics)

    expect(collectPageViews(readRecords(analytics.otel))).toEqual([])

    await context.start(() => analytics.otel.flush())

    expect(collectPageViews(readRecords(analytics.otel))).toEqual([])
    expect(pageViewsInFetch(fetchMock)).toEqual([])
    expectOtelFetchUrlsOnly(fetchUrls(fetchMock))
  },
)

test('WA-2: navigation-api foreign pushState emits a second app.page_view', () => {
  const shop = installShopWindow()

  const analytics = context.start(() =>
    connectSite({
      name: 'page-view-nav',
      consent: true,
      navigation: 'navigation-api',
    }).analytics,
  )

  expect(collectPageViews(readRecords(analytics.otel))).toHaveLength(1)

  shop.clickSpaLink('/product/1')
  shop.fireNavigationChange()

  const views = collectPageViews(readRecords(analytics.otel))
  expect(views.length).toBeGreaterThanOrEqual(2)
  expect(views.every((view) => view.attributes['event.name'] === 'app.page_view')).toBe(
    true,
  )
})

test('WA-2: connect once does not emit two app.page_view logs for one load', () => {
  installShopWindow()

  const analytics = context.start(() =>
    connectSite({
      name: 'page-view-once',
      consent: true,
    }).analytics,
  )

  expect(collectPageViews(readRecords(analytics.otel))).toHaveLength(1)
})

test('WA-2 / F-09: a second connectWebAnalytics on a new instance is a new page view', () => {
  installShopWindow()

  const first = context.start(() =>
    connectSite({
      name: 'page-view-first',
      consent: true,
    }).analytics,
  )
  const second = context.start(() =>
    connectSite({
      name: 'page-view-second',
      consent: true,
    }).analytics,
  )

  expect(first.otel).not.toBe(second.otel)
  expect(collectPageViews(readRecords(first.otel))).toHaveLength(1)
  expect(collectPageViews(readRecords(second.otel))).toHaveLength(1)
})

test('WA-2 / F-09: double connectWebAnalytics on the same instance still throws', () => {
  installShopWindow()

  const analytics = context.start(() =>
    connectSite({
      name: 'page-view-double',
      consent: true,
    }).analytics,
  )

  expect(collectPageViews(readRecords(analytics.otel))).toHaveLength(1)
  expect(() =>
    context.start(() =>
      connectWebAnalytics(analytics.otel, { consent: true }),
    ),
  ).toThrowError(/analytics/i)
  expect(collectPageViews(readRecords(analytics.otel))).toHaveLength(1)
})

test('F-08: dispose then reconnect on the same path records one app.page_view; a new path records another', () => {
  const shop = installShopWindow()

  const otel = context.start(() =>
    reatomOpentelemetry({
      name: 'page-view-strict-mode',
      endpoint: null,
      serviceName: 'site-web',
      skipGlobalExtension: true,
      useBeacon: false,
      batchInterval: 100_000,
      maxBatchSize: 100,
      maxQueueSize: 100,
    }),
  )
  cleanups.push(() => otel.dispose())

  const connect = () =>
    context.start(() =>
      remember(
        connectWebAnalytics(otel, {
          consent: true,
          navigation: 'popstate',
        }),
      ),
    )

  const first = connect()
  expect(collectPageViews(readRecords(otel))).toHaveLength(1)

  context.start(() => first.dispose())

  const second = connect()
  expect(collectPageViews(readRecords(otel))).toHaveLength(1)

  shop.clickSpaLink('/product/1')
  context.start(() => second.pageView())
  expect(collectPageViews(readRecords(otel))).toHaveLength(2)
  expect(
    collectPageViews(readRecords(otel))[1]!.attributes['url.path'],
  ).toBe('/product/1')

  shop.clickSpaLink('/home')
  context.start(() => second.pageView())
  const views = collectPageViews(readRecords(otel))
  expect(views).toHaveLength(3)
  expect(views[2]!.attributes['url.path']).toBe('/home')
})

test('WA-2 / F-08: consented page view joins the route watershed traceId', async () => {
  installShopWindow({ href: 'https://shop.test/goods/tech' })

  await context.start(async () => {
    urlAtom.sync.set(() => noop)
    urlAtom.set(new URL('http://localhost/'))

    const otel = reatomOpentelemetry({
      name: 'page-view-route',
      endpoint: null,
      serviceName: 'site-web',
      useBeacon: false,
      batchInterval: 100_000,
      maxBatchSize: 100,
      maxQueueSize: 100,
      filter: (t) => !t.name.startsWith('analytics.'),
    })
    cleanups.push(() => otel.dispose())

    const goodsRoute = reatomRoute(
      {
        path: 'goods/:category',
      },
      'goods',
    )
    await wrap(Promise.resolve())

    goodsRoute.go({ category: 'tech' })
    await wrap(goodsRoute.loader())
    await wrap(Promise.resolve())
    expect(goodsRoute.match()).toBe(true)

    const analytics = remember(
      connectWebAnalytics(otel, {
        consent: true,
        autoPageViews: false,
        navigation: 'popstate',
      }),
    )

    expect(otel.traceVar.get()).toBeUndefined()
    expect(otel.pageTrace()).toBeDefined()

    analytics.pageView()

    const records = readRecords(otel)
    const views = collectPageViews(records)
    expect(views).toHaveLength(1)

    const routeSpan = spanNamed(records, 'route goods')
    expect(routeSpan).toBeDefined()
    expect(views[0]!.traceId).toBe(routeSpan!.traceId)

    const pageViewRoots = spanNames(records).filter((name) =>
      name.startsWith('page_view '),
    )
    expect(pageViewRoots).toEqual([])
  })
})

test('WA-2: page views use the instance pipeline, never a unique analytics URL', async () => {
  installShopWindow()
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response('{}', { status: 200 }),
  )

  const analytics = context.start(() =>
    connectSite(
      {
        name: 'page-view-pipeline',
        endpoint: 'https://collector.test',
        keepRecords: true,
        consent: true,
      },
      fetchMock,
    ).analytics,
  )

  expect(collectPageViews(readRecords(analytics.otel))).toHaveLength(1)

  await context.start(() => analytics.otel.flush())

  const urls = fetchUrls(fetchMock)
  expect(urls.length).toBeGreaterThan(0)
  expectOtelFetchUrlsOnly(urls)
  expect(urls.some((url) => url.includes('/v1/logs'))).toBe(true)
  expect(pageViewsInFetch(fetchMock).length).toBeGreaterThan(0)
})
