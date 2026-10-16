import { action, atom, context, notify, urlAtom, wrap } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomGDPR } from '../gdpr/reatomGDPR.ts'
import { withWarnSpy } from '../test-helpers.ts'
import { connectWebAnalytics } from './index.ts'
import { sessionStorageKey, visitorStorageKey } from './identity.ts'

// F-10 / spec 03 test 4 / WA-4 / R11: omitted or false consent stores nothing
// and sends no analytics OTLP. Categories toggle synchronously.

type AnalyticsModel = ReturnType<typeof connectWebAnalytics>
type ManualApiKeys = Extract<keyof AnalyticsModel, 'trackEvent' | 'record'>
type AssertNever<T extends never> = T
type _NoTrackEventOrRecord = AssertNever<ManualApiKeys>

const OPTIONS = {
  name: 'site',
  endpoint: 'https://collector.invalid/otel',
  serviceName: 'site-web',
  skipGlobalExtension: true as const,
}

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

const remember = <T extends { dispose?: { (): void } | (() => void) }>(
  analytics: T,
): T => {
  if (typeof analytics.dispose === 'function') {
    const dispose = analytics.dispose.bind(analytics)
    cleanups.push(() => dispose())
  }
  return analytics
}

const installShopWindow = (options?: { navigationApi?: boolean }) => {
  let href = 'https://shop.test/home'
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

test('spec 03.5: two analytics instances do not share queue, visitor, or session', () => {
  installShopWindow()

  const host = context.start(() =>
    remember(
      connectWebAnalytics({
        ...OPTIONS,
        name: 'host',
        endpoint: 'https://collector.invalid/otel-host',
        serviceName: 'host-web',
      }),
    ),
  )
  const widget = context.start(() =>
    remember(
      connectWebAnalytics({
        ...OPTIONS,
        name: 'widget',
        endpoint: 'https://collector.invalid/otel-widget',
        serviceName: 'widget-web',
      }),
    ),
  )

  expect(host).not.toBe(widget)
  expect(host.otel).not.toBe(widget.otel)
  expect(host.visitorAtom).not.toBe(widget.visitorAtom)
  expect(host.sessionAtom).not.toBe(widget.sessionAtom)
  expect(host.otel.stats).not.toBe(widget.otel.stats)
  expect(host.otel.stats()).not.toBe(widget.otel.stats())
})

test('spec 03.9 / F-09: React Router-shaped pushState and link click keep the same URL sequence', () => {
  const control = installShopWindow()
  const withoutAnalytics = (() => {
    control.clickSpaLink('/product/1')
    control.clickSpaLink('/cart')
    return [...control.sequence]
  })()
  vi.unstubAllGlobals()

  const shop = installShopWindow()

  context.start(() => {
    const catchLinksBefore = urlAtom.catchLinks()
    const syncBefore = urlAtom.sync()
    remember(connectWebAnalytics(OPTIONS))
    expect(urlAtom.catchLinks()).toBe(catchLinksBefore)
    expect(urlAtom.sync()).toBe(syncBefore)
    shop.clickSpaLink('/product/1')
    shop.clickSpaLink('/cart')
  })

  expect(shop.sequence).toEqual(withoutAnalytics)
  expect(shop.body.addEventListener).not.toHaveBeenCalledWith(
    'click',
    expect.any(Function),
  )
})

test('spec 03.12 / F-08: connectWebAnalytics without window is a no-op and never throws', async () => {
  const globalObject = globalThis as {
    window?: unknown
    document?: unknown
  }
  const hadWindow = 'window' in globalThis
  const hadDocument = 'document' in globalThis
  const windowRef = globalObject.window
  const documentRef = globalObject.document

  await withWarnSpy((warn) => {
    try {
      delete globalObject.window
      delete globalObject.document
      expect(typeof window).toBe('undefined')
      expect(() =>
        context.start(() => connectWebAnalytics(OPTIONS)),
      ).not.toThrow()
    } finally {
      if (hadWindow) globalObject.window = windowRef
      else delete globalObject.window
      if (hadDocument) globalObject.document = documentRef
      else delete globalObject.document
    }
    expect(
      warn.mock.calls.flat().some((arg) => String(arg).length > 0),
    ).toBe(true)
  })
})

test('spec 03.15 / F-09: options-only connect exposes analytics.otel and a purchase shares the page-view traceId', () => {
  installShopWindow()

  context.start(() => {
    const analytics = remember(
      connectWebAnalytics({
        ...OPTIONS,
        name: 'purchase-trace',
        endpoint: null,
        consent: true,
      }),
    )

    expect(analytics.otel).toBeDefined()
    expect(typeof analytics.otel.withOTel).toBe('function')

    const purchase = action(
      (order: { total: number }) => order,
      'app.purchase',
    ).extend(
      analytics.otel.withOTel({
        attributes: ({ payload }) => ({ 'app.order.value': payload.total }),
      }),
    )

    expect(typeof purchase).toBe('function')
    expect(purchase({ total: 42 })).toEqual({ total: 42 })

    const snapshot = [...analytics.otel.records()]
    const views = collectNamed(snapshot, 'app.page_view')
    expect(views).toHaveLength(1)
    expect(typeof views[0]!.traceId).toBe('string')

    const purchaseSpan = spanNamed(snapshot, 'app.purchase')
    expect(purchaseSpan).toBeDefined()
    expect(purchaseSpan!.traceId).toBe(views[0]!.traceId)
  })
})

test('spec 03.16: default navigation is not urlAtom when no Reatom routes exist', async () => {
  const shop = installShopWindow()

  await withWarnSpy((warn) => {
    context.start(() => {
      const catchLinksBefore = urlAtom.catchLinks()
      const syncBefore = urlAtom.sync()
      remember(connectWebAnalytics(OPTIONS))
      expect(urlAtom.catchLinks()).toBe(catchLinksBefore)
      expect(urlAtom.sync()).toBe(syncBefore)
    })

    expect(shop.body.addEventListener).not.toHaveBeenCalledWith(
      'click',
      expect.any(Function),
    )
    expect(Object.keys(urlAtom.routes)).toEqual([])

    const rendered = warn.mock.calls
      .flat()
      .map((arg) => String(arg))
      .join('\n')
    expect(rendered).not.toMatch(/catchLinks/)
    expect(rendered).not.toMatch(/urlAtom\.sync/)
  })
})

test('spec 03.16: explicit urlAtom without catchLinks/sync off warns once in dev', async () => {
  installShopWindow()
  expect(context.start(() => urlAtom.catchLinks())).toBe(true)
  expect(Object.keys(urlAtom.routes)).toEqual([])

  await withWarnSpy((warn) => {
    context.start(() =>
      remember(connectWebAnalytics({ ...OPTIONS, navigation: 'urlAtom' })),
    )

    expect(warn).toHaveBeenCalledTimes(1)
    const rendered = warn.mock.calls
      .flat()
      .map((arg) => String(arg))
      .join('\n')
    expect(rendered).toMatch(/catchLinks/)
    expect(rendered).toMatch(/sync/)
  })
})

test('spec 03.16: navigation-api sees foreign pushState and does not call setupUrlAtomNavigation', () => {
  const shop = installShopWindow()

  context.start(() => {
    const catchLinksBefore = urlAtom.catchLinks()
    const syncBefore = urlAtom.sync()
    remember(
      connectWebAnalytics({ ...OPTIONS, navigation: 'navigation-api' }),
    )
    expect(urlAtom.catchLinks()).toBe(catchLinksBefore)
    expect(urlAtom.catchLinks()).toBe(true)
    expect(urlAtom.sync()).toBe(syncBefore)
  })

  expect(shop.navigation?.addEventListener).toHaveBeenCalledWith(
    'currententrychange',
    expect.any(Function),
  )
  expect(shop.body.addEventListener).not.toHaveBeenCalledWith(
    'click',
    expect.any(Function),
  )

  shop.clickSpaLink('/foreign')
  shop.fireNavigationChange()
  expect(shop.sequence).toEqual(['https://shop.test/foreign'])
})

test('spec 03.16: popstate source exposes pageView', () => {
  installShopWindow({ navigationApi: false })

  const analytics = context.start(() =>
    remember(connectWebAnalytics({ ...OPTIONS, navigation: 'popstate' })),
  )

  expect(typeof analytics.pageView).toBe('function')
  expect(() => context.start(() => analytics.pageView())).not.toThrow()
})

test('F-08: double connectWebAnalytics on one instance errors with a clear message', () => {
  installShopWindow()

  const analytics = context.start(() => remember(connectWebAnalytics(OPTIONS)))

  expect(() =>
    context.start(() => connectWebAnalytics(analytics.otel)),
  ).toThrowError(/analytics/i)
})

test('F-09: trackEvent and record are not on the analytics model', () => {
  installShopWindow()

  const analytics = context.start(() => remember(connectWebAnalytics(OPTIONS)))

  // @ts-expect-error no trackEvent — manual facts use traced actions (R21, spec 03 А9)
  const trackEvent = analytics.trackEvent
  // @ts-expect-error no record — there is no record(eventName) API
  const record = analytics.record

  expect(trackEvent).toBeUndefined()
  expect(record).toBeUndefined()
})

const ANALYTICS_EVENTS = [
  'app.page_view',
  'session.start',
  'app.page.engagement',
  'exception',
  'exception.suppressed',
] as const

const CONSENT_OPTIONS = {
  name: 'consent-site',
  endpoint: null as const,
  serviceName: 'consent-web',
  skipGlobalExtension: true as const,
  navigation: 'popstate' as const,
  useBeacon: false as const,
  batchInterval: 100_000,
}

const createMemoryStorage = (): Storage => {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key(index) {
      return [...map.keys()][index] ?? null
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key, value) {
      map.set(String(key), String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    clear() {
      map.clear()
    },
  }
}

const installClock = (startMs = 1_700_000_000_000) => {
  let nowMs = startMs
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
  cleanups.push(() => spy.mockRestore())
  return {
    advance(ms: number) {
      nowMs += ms
    },
  }
}

type ConsentPage = {
  hide: () => void
  localStorage: Storage
}

const installConsentPage = (): ConsentPage => {
  let href = 'https://shop.test/home?utm_source=google'
  const localStorage = createMemoryStorage()
  const sessionStorage = createMemoryStorage()
  const body = new EventTarget()
  const page = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    hasFocus: () => true,
    body,
    referrer: '',
  })

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

  const windowStub = Object.assign(new EventTarget(), {
    location,
    history: {
      pushState(_state: unknown, _title: string, url?: string | URL | null) {
        href = new URL(String(url ?? href), href).href
      },
      replaceState(_state: unknown, _title: string, url?: string | URL | null) {
        href = new URL(String(url ?? href), href).href
      },
    },
    document: page,
    localStorage,
    sessionStorage,
  })

  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', page)
  vi.stubGlobal('location', location)
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('sessionStorage', sessionStorage)

  return {
    localStorage,
    hide() {
      page.visibilityState = 'hidden'
      page.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

const decodeOtlpValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const encoded = value as Record<string, unknown>
  if ('stringValue' in encoded) return encoded.stringValue
  if ('intValue' in encoded) return encoded.intValue
  if ('boolValue' in encoded) return encoded.boolValue
  if ('doubleValue' in encoded) return encoded.doubleValue
  return value
}

const attributesOf = (record: object): Record<string, unknown> => {
  const raw = 'attributes' in record ? record.attributes : undefined
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const key = 'key' in item ? item.key : undefined
      const nested = 'value' in item ? item.value : undefined
      if (typeof key === 'string') out[key] = decodeOtlpValue(nested)
    }
    return out
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  return {}
}

const eventNameOf = (record: object): string | undefined => {
  if ('eventName' in record && typeof record.eventName === 'string') {
    return record.eventName
  }
  const name = attributesOf(record)['event.name']
  return typeof name === 'string' ? name : undefined
}

const collectNamed = (
  records: readonly unknown[],
  eventName: string,
): Array<{
  eventName?: string
  attributes: Record<string, unknown>
  traceId?: string
}> => {
  const found: Array<{
    eventName?: string
    attributes: Record<string, unknown>
    traceId?: string
  }> = []
  const visit = (value: unknown) => {
    if (value === null || typeof value !== 'object') return
    if (eventNameOf(value) === eventName) {
      found.push({
        eventName:
          'eventName' in value && typeof value.eventName === 'string'
            ? value.eventName
            : undefined,
        attributes: attributesOf(value),
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

const spanNamed = (
  records: readonly unknown[],
  name: string,
):
  | {
      name: string
      traceId?: string
      attributes?: Record<string, unknown>
    }
  | undefined => {
  let found:
    | {
        name: string
        traceId?: string
        attributes?: Record<string, unknown>
      }
    | undefined
  const visit = (value: unknown) => {
    if (found || value === null || typeof value !== 'object') return
    const recordName = 'name' in value ? value.name : undefined
    const spanId = 'spanId' in value ? value.spanId : undefined
    if (typeof recordName === 'string' && recordName === name && typeof spanId === 'string') {
      found = {
        name: recordName,
        traceId:
          'traceId' in value && typeof value.traceId === 'string'
            ? value.traceId
            : undefined,
        attributes: attributesOf(value),
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

const analyticsRecordsOf = (
  otel: ReturnType<typeof connectWebAnalytics>['otel'],
) => {
  const snapshot = [...otel.records()]
  return ANALYTICS_EVENTS.flatMap((eventName) =>
    collectNamed(snapshot, eventName),
  )
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const storageKeys = (storage: Storage) => {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (typeof key === 'string') keys.push(key)
  }
  return keys
}

const identityStorageKeys = (storage: Storage) =>
  storageKeys(storage).filter(
    (key) => key.endsWith('.visitor') || key.endsWith('.session'),
  )

test('WA-4 / R11: consent atom false then true emits the first identified page view with RAM engagement', () => {
  const clock = installClock()
  installConsentPage()
  const fetchMock = vi.fn<typeof fetch>(
    async () => new Response('{}', { status: 200 }),
  )

  context.start(() => {
    const consent = atom(false, 'wa4.consent')
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-atom-flip',
        endpoint: 'https://collector.test',
        keepRecords: true,
        fetch: fetchMock,
        consent,
      }),
    )
    const memorySession = analytics.sessionAtom().id
    expect(typeof memorySession).toBe('string')
    expect(analytics.visitorAtom()).toBeUndefined()
    expect(analyticsRecordsOf(analytics.otel)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()

    clock.advance(1_200)
    consent.set(true)
    notify()

    const visitorId = analytics.visitorAtom()
    const sessionId = analytics.sessionAtom().id
    expect(typeof visitorId).toBe('string')
    expect(typeof sessionId).toBe('string')
    expect(sessionId).not.toBe(memorySession)

    const views = collectNamed([...analytics.otel.records()], 'app.page_view')
    expect(views).toHaveLength(1)
    expect(views[0]!.attributes['app.visitor.id']).toBe(visitorId)
    expect(views[0]!.attributes['session.id']).toBe(sessionId)
    expect(views[0]!.attributes['session.id']).not.toBe(memorySession)
    expect(views[0]!.attributes['app.analytics.consent']).toBe('granted')

    const engagement = collectNamed(
      [...analytics.otel.records()],
      'app.page.engagement',
    )
    const engagementOnView = asNumber(
      views[0]!.attributes['app.engagement.visible_ms'],
    )
    const visibleMs =
      engagementOnView ??
      asNumber(engagement[0]?.attributes['app.engagement.visible_ms'])
    const activeMs =
      asNumber(views[0]!.attributes['app.engagement.active_ms']) ??
      asNumber(engagement[0]?.attributes['app.engagement.active_ms'])
    expect(visibleMs).toBeGreaterThanOrEqual(1_200)
    expect(activeMs).toBeGreaterThanOrEqual(1_200)
    expect(analyticsRecordsOf(analytics.otel).length).toBeGreaterThan(0)
  })
})

test('WA-4: reatomGDPR analytics submit grants identifiers on the first page view', async () => {
  const page = installConsentPage()

  await context.start(async () => {
    const consent = reatomGDPR({
      name: `wa4-gdpr-${Math.random().toString(16).slice(2)}`,
      persist: false,
      categories: { diagnostics: false, analytics: false, marketing: false },
    })
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-gdpr-submit',
        consent,
      }),
    )
    const memorySession = analytics.sessionAtom().id
    expect(analyticsRecordsOf(analytics.otel)).toEqual([])
    expect(analytics.visitorAtom()).toBeUndefined()

    consent.fields.analytics.change(true)
    notify()
    expect(analyticsRecordsOf(analytics.otel)).toEqual([])
    expect(analytics.visitorAtom()).toBeUndefined()
    expect(identityStorageKeys(page.localStorage)).toEqual([])
    expect(page.localStorage.getItem(visitorStorageKey('wa4-gdpr-submit'))).toBe(
      null,
    )
    expect(page.localStorage.getItem(sessionStorageKey('wa4-gdpr-submit'))).toBe(
      null,
    )

    await wrap(consent.submit())
    notify()

    const views = collectNamed([...analytics.otel.records()], 'app.page_view')
    expect(views).toHaveLength(1)
    expect(typeof analytics.visitorAtom()).toBe('string')
    expect(views[0]!.attributes['app.visitor.id']).toBe(analytics.visitorAtom())
    expect(views[0]!.attributes['session.id']).toBe(analytics.sessionAtom().id)
    expect(views[0]!.attributes['session.id']).not.toBe(memorySession)
    expect(views[0]!.attributes['app.analytics.consent']).toBe('analytics')
  })
})

test('WA-4 / R11: diagnostics-only true sends no page view and no visitor id', async () => {
  installConsentPage()

  await context.start(async () => {
    const consent = reatomGDPR({
      name: `wa4-diag-${Math.random().toString(16).slice(2)}`,
      persist: false,
      categories: { diagnostics: true, analytics: false, marketing: false },
    })
    await wrap(consent.submit())
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-diagnostics-only',
        consent,
      }),
    )
    notify()
    expect(collectNamed([...analytics.otel.records()], 'app.page_view')).toEqual(
      [],
    )
    expect(analytics.visitorAtom()).toBeUndefined()
    expect(
      analyticsRecordsOf(analytics.otel).some(
        (record) => record.attributes['app.visitor.id'] != null,
      ),
    ).toBe(false)
  })
})

test('WA-4 / R11: navigation without consent drops RAM engagement so grant is only the current page', () => {
  const clock = installClock()
  installConsentPage()

  context.start(() => {
    const consent = atom(false, 'wa4.nav-drop')
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-nav-drop',
        consent,
      }),
    )
    clock.advance(1_000)
    analytics.pageView()
    clock.advance(250)
    consent.set(true)
    notify()

    const views = collectNamed([...analytics.otel.records()], 'app.page_view')
    expect(views).toHaveLength(1)
    const engagement = collectNamed(
      [...analytics.otel.records()],
      'app.page.engagement',
    )
    const visibleMs =
      asNumber(views[0]!.attributes['app.engagement.visible_ms']) ??
      asNumber(engagement[0]?.attributes['app.engagement.visible_ms'])
    const activeMs =
      asNumber(views[0]!.attributes['app.engagement.active_ms']) ??
      asNumber(engagement[0]?.attributes['app.engagement.active_ms'])
    expect(visibleMs).toBe(250)
    expect(activeMs).toBe(250)
  })
})

test('WA-4: re-grant after withdraw does not flush withdrawn-period engagement', () => {
  const clock = installClock()
  const page = installConsentPage()

  context.start(() => {
    const consent = atom(true, 'wa4.regrant')
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-regrant',
        consent,
      }),
    )
    expect(collectNamed([...analytics.otel.records()], 'app.page_view')).toHaveLength(
      1,
    )

    clock.advance(100)
    consent.set(false)
    notify()
    clock.advance(5_000)
    consent.set(true)
    notify()
    clock.advance(200)
    page.hide()
    notify()

    const engagement = collectNamed(
      [...analytics.otel.records()],
      'app.page.engagement',
    )
    expect(engagement).toHaveLength(1)
    expect(asNumber(engagement[0]!.attributes['app.engagement.visible_ms'])).toBe(
      200,
    )
  })
})

test('WA-4: withdrawing analytics stops further pageView and hide OTLP', () => {
  const page = installConsentPage()

  context.start(() => {
    const consent = atom(true, 'wa4.withdraw')
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-withdraw',
        consent,
      }),
    )
    const before = analyticsRecordsOf(analytics.otel)
    expect(collectNamed([...analytics.otel.records()], 'app.page_view')).toHaveLength(
      1,
    )

    consent.set(false)
    notify()
    analytics.pageView()
    page.hide()
    notify()

    expect(analyticsRecordsOf(analytics.otel)).toEqual(before)
  })
})

test('F-10: reatomGDPR withdraw stops pageView OTLP and new events lack visitor id', async () => {
  const page = installConsentPage()

  await context.start(async () => {
    const consent = reatomGDPR({
      name: `f10-gdpr-withdraw-${Math.random().toString(16).slice(2)}`,
      persist: false,
      categories: { diagnostics: false, analytics: false, marketing: false },
    })
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'f10-gdpr-withdraw',
        consent,
      }),
    )

    consent.fields.analytics.change(true)
    notify()
    expect(analyticsRecordsOf(analytics.otel)).toEqual([])
    await wrap(consent.submit())
    notify()

    const viewsAfterGrant = collectNamed(
      [...analytics.otel.records()],
      'app.page_view',
    )
    expect(viewsAfterGrant).toHaveLength(1)
    const visitorId = analytics.visitorAtom()
    expect(typeof visitorId).toBe('string')
    expect(viewsAfterGrant[0]!.attributes['app.visitor.id']).toBe(visitorId)

    consent.fields.analytics.change(false)
    await wrap(consent.submit())
    notify()
    const withdrawnAnalytics = consent.snapshot()?.categories.analytics
    expect(withdrawnAnalytics).toBe(false)

    const afterWithdraw = analyticsRecordsOf(analytics.otel)
    analytics.pageView()
    page.hide()
    notify()
    expect(analyticsRecordsOf(analytics.otel)).toEqual(afterWithdraw)

    const viewsAfterWithdraw = collectNamed(
      [...analytics.otel.records()],
      'app.page_view',
    )
    expect(viewsAfterWithdraw).toHaveLength(1)

    consent.fields.analytics.change(true)
    await wrap(consent.submit())
    notify()
    analytics.pageView()
    notify()
    const viewsAfterRestore = collectNamed(
      [...analytics.otel.records()],
      'app.page_view',
    )
    expect(viewsAfterRestore).toHaveLength(2)
    expect(viewsAfterRestore[1]!.attributes['app.visitor.id']).toBe(
      analytics.visitorAtom(),
    )
    expect(viewsAfterRestore[1]!.attributes['app.analytics.consent']).toBe(
      'analytics',
    )

  })
})

test('WA-4: diagnostics category object is not a back door for analytics identifiers', () => {
  installConsentPage()

  context.start(() => {
    const categories = {
      analytics: atom(false, 'wa4.cat.analytics'),
      diagnostics: atom(true, 'wa4.cat.diagnostics'),
    }
    const analytics = remember(
      connectWebAnalytics({
        ...CONSENT_OPTIONS,
        name: 'wa4-category-object',
        consent: categories,
      }),
    )
    notify()
    expect(collectNamed([...analytics.otel.records()], 'app.page_view')).toEqual(
      [],
    )
    expect(analytics.visitorAtom()).toBeUndefined()
  })
})

