import {
  context,
  notify,
  sleep,
  urlAtom,
  visibilityAtom,
  wrap,
} from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { parseLogRecords } from '../test-helpers.ts'
import {
  connectWebAnalytics,
  type NavigationSource,
  type WebAnalyticsCreateOptions,
} from './connectWebAnalytics.ts'

const ENGAGEMENT_EVENT = 'app.page.engagement'
const PAGE_VIEW_EVENT = 'app.page_view'
const VISIBLE_MS = 'app.engagement.visible_ms'
const ACTIVE_MS = 'app.engagement.active_ms'

type PageDocument = EventTarget & {
  visibilityState: DocumentVisibilityState
  hasFocus: () => boolean
  body: EventTarget
}

type PageHarness = {
  hide: () => void
  blur: () => void
  focus: () => void
}

const OPTIONS = {
  name: 'shop',
  endpoint: null,
  serviceName: 'shop-web',
  skipGlobalExtension: true as const,
  consent: true,
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

const installClock = (startMs = 1_700_000_000_000) => {
  let nowMs = startMs
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
  cleanups.push(() => spy.mockRestore())
  return {
    now: () => nowMs,
    advance(ms: number) {
      nowMs += ms
    },
    tickEachRead() {
      spy.mockImplementation(() => ++nowMs)
      return this
    },
  }
}

const installPage = (options?: {
  focused?: boolean
  navigationApi?: boolean
}): PageHarness => {
  let href = 'https://shop.test/home'
  let focused = options?.focused !== false
  const body = new EventTarget()
  const page = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    hasFocus: () => focused,
    body,
  }) satisfies PageDocument

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

  const windowStub = Object.assign(new EventTarget(), {
    location,
    history,
    document: page,
    ...(options?.navigationApi ? { navigation: new EventTarget() } : {}),
  })

  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', page)
  vi.stubGlobal('location', location)
  vi.stubGlobal('history', history)

  return {
    hide() {
      page.visibilityState = 'hidden'
      page.dispatchEvent(new Event('visibilitychange'))
    },
    blur() {
      focused = false
      windowStub.dispatchEvent(new Event('blur'))
    },
    focus() {
      focused = true
      windowStub.dispatchEvent(new Event('focus'))
    },
  }
}

const decodeOtlpValue = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const encoded = value as Record<string, unknown>
  if ('stringValue' in encoded) return encoded.stringValue
  if ('intValue' in encoded) {
    const raw = encoded.intValue
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
      const asNumber = Number(raw)
      return Number.isFinite(asNumber) ? asNumber : raw
    }
    return raw
  }
  if ('doubleValue' in encoded) return encoded.doubleValue
  if ('boolValue' in encoded) return encoded.boolValue
  if ('arrayValue' in encoded) {
    const values =
      (encoded.arrayValue as { values?: unknown[] } | undefined)?.values ?? []
    return values.map(decodeOtlpValue)
  }
  if ('kvlistValue' in encoded) {
    const entries =
      (
        encoded.kvlistValue as {
          values?: Array<{ key: string; value: unknown }>
        }
      )?.values ?? []
    return Object.fromEntries(
      entries.map(({ key, value: nested }) => [key, decodeOtlpValue(nested)]),
    )
  }
  return value
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const asNumberValue = Number(value)
    return Number.isFinite(asNumberValue) ? asNumberValue : undefined
  }
  return undefined
}

const attributesOf = (record: object): Record<string, unknown> => {
  const raw = 'attributes' in record ? record.attributes : undefined
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const key = 'key' in item ? item.key : undefined
      const value = 'value' in item ? decodeOtlpValue(item.value) : undefined
      if (typeof key === 'string') out[key] = value
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
): object[] => {
  const found: object[] = []
  const visit = (value: unknown) => {
    if (value === null || typeof value !== 'object') return
    if (eventNameOf(value) === eventName) found.push(value)
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    for (const nested of Object.values(value)) visit(nested)
  }
  for (const record of records) visit(record)
  return found
}

const collectEngagement = (records: readonly unknown[]): object[] =>
  collectNamed(records, ENGAGEMENT_EVENT)

const collectPageViews = (records: readonly unknown[]): object[] =>
  collectNamed(records, PAGE_VIEW_EVENT)

const snapshotRecords = (
  analytics: ReturnType<typeof connectWebAnalytics>,
): unknown[] => [...analytics.otel.records()]

const hideAndSettle = async (hide: () => void) => {
  hide()
  notify()
  await context.start(() => wrap(sleep()))
}

const connectShop = (overrides: Partial<WebAnalyticsCreateOptions> = {}) =>
  context.start(() => {
    const connected = remember(
      connectWebAnalytics({
        ...OPTIONS,
        consent: true,
        endpoint: null,
        ...overrides,
      }),
    )
    const stopVisibility = visibilityAtom.subscribe()
    cleanups.push(stopVisibility)
    return connected
  })

const engagementOf = (analytics: ReturnType<typeof connectWebAnalytics>) =>
  collectEngagement(snapshotRecords(analytics))

const pageViewsOf = (analytics: ReturnType<typeof connectWebAnalytics>) =>
  collectPageViews(snapshotRecords(analytics))

const expectEngagementMs = (
  record: object,
  expected: { visibleMs: number; activeMs: number },
) => {
  const attributes = attributesOf(record)
  expect(eventNameOf(record)).toBe(ENGAGEMENT_EVENT)
  expect('eventName' in record ? record.eventName : undefined).toBe(
    ENGAGEMENT_EVENT,
  )
  expect(attributes['event.name']).toBe(ENGAGEMENT_EVENT)
  const visibleMs = asNumber(attributes[VISIBLE_MS])
  const activeMs = asNumber(attributes[ACTIVE_MS])
  expect(visibleMs).toBe(expected.visibleMs)
  expect(activeMs).toBe(expected.activeMs)
  expect(Number.isFinite(visibleMs)).toBe(true)
  expect(Number.isFinite(activeMs)).toBe(true)
}

test('F-08 / WA-6 / spec 05: hide after connect records one app.page.engagement with visible/active ms', async () => {
  const clock = installClock()
  const page = installPage()

  const analytics = connectShop()
  context.start(() => {
    expect(visibilityAtom()).toBe('visible')
  })

  clock.advance(250)
  await hideAndSettle(() => page.hide())

  context.start(() => {
    expect(visibilityAtom()).toBe('hidden')
  })

  await analytics.otel.flush()

  const engagement = engagementOf(analytics)
  expect(engagement).toHaveLength(1)
  expectEngagementMs(engagement[0]!, { visibleMs: 250, activeMs: 250 })
})

test.each([
  'urlAtom',
  'popstate',
  'navigation-api',
] as const satisfies readonly NavigationSource[])(
  'WA-6: first auto page view (%s) does not emit engagement',
  async (navigation) => {
    installClock().tickEachRead()
    installPage({ navigationApi: navigation === 'navigation-api' })

    const analytics = connectShop({ navigation })
    await analytics.otel.flush()

    expect(engagementOf(analytics)).toEqual([])
    expect(pageViewsOf(analytics)).toHaveLength(1)
  },
)

test('WA-6: later pageView flushes engagement for the previous page', async () => {
  const clock = installClock()
  installPage()

  const analytics = connectShop({ navigation: 'popstate' })
  clock.advance(400)
  context.start(() => analytics.pageView())
  await analytics.otel.flush()

  const engagement = engagementOf(analytics)
  expect(engagement).toHaveLength(1)
  expectEngagementMs(engagement[0]!, { visibleMs: 400, activeMs: 400 })
})

test('WA-6 / F-08: dispose then reconnect flushes engagement per page instead of merging', async () => {
  const clock = installClock()
  installPage()

  const otel = context.start(() =>
    reatomOpentelemetry({
      name: 'engagement-reconnect-skip',
      endpoint: null,
      serviceName: 'shop-web',
      skipGlobalExtension: true,
    }),
  )
  cleanups.push(() => otel.dispose())

  const connect = () =>
    context.start(() => {
      const connected = remember(
        connectWebAnalytics(otel, {
          consent: true,
          navigation: 'popstate',
        }),
      )
      const stopVisibility = visibilityAtom.subscribe()
      cleanups.push(stopVisibility)
      return connected
    })

  const first = connect()
  expect(pageViewsOf(first)).toHaveLength(1)

  context.start(() => first.dispose())

  const second = connect()
  expect(pageViewsOf(second)).toHaveLength(1)

  clock.advance(400)
  context.start(() => second.pageView())
  expect(pageViewsOf(second)).toHaveLength(2)

  clock.advance(300)
  context.start(() => second.pageView())
  expect(pageViewsOf(second)).toHaveLength(3)

  await second.otel.flush()

  const engagement = engagementOf(second)
  expect(engagement).toHaveLength(2)
  expectEngagementMs(engagement[0]!, { visibleMs: 400, activeMs: 400 })
  expectEngagementMs(engagement[1]!, { visibleMs: 300, activeMs: 300 })
})

test('WA-6: unfocused visible time is not visible or active ms', async () => {
  const clock = installClock()
  const page = installPage({ focused: false })

  const unfocused = connectShop({ name: 'unfocused-start' })
  clock.advance(1_200)
  await hideAndSettle(() => page.hide())
  await unfocused.otel.flush()
  expect(engagementOf(unfocused)).toEqual([])

  vi.unstubAllGlobals()
  const focusedPage = installPage()
  const afterBlur = connectShop({ name: 'after-blur' })
  focusedPage.blur()
  clock.advance(1_800)
  await hideAndSettle(() => focusedPage.hide())
  await afterBlur.otel.flush()
  expect(engagementOf(afterBlur)).toEqual([])
})

test('WA-6 / R9: time outside 5s of last input is not active; load and refocus count as input', async () => {
  const clock = installClock()
  const page = installPage()

  const idle = connectShop({ name: 'idle-window' })
  clock.advance(8_000)
  await hideAndSettle(() => page.hide())
  await idle.otel.flush()
  const idleEngagement = engagementOf(idle)
  expect(idleEngagement).toHaveLength(1)
  expectEngagementMs(idleEngagement[0]!, { visibleMs: 8_000, activeMs: 5_000 })

  vi.unstubAllGlobals()
  const refocusPage = installPage()
  const refocus = connectShop({ name: 'refocus-input' })
  clock.advance(8_000)
  refocusPage.blur()
  refocusPage.focus()
  clock.advance(1_500)
  await hideAndSettle(() => refocusPage.hide())
  await refocus.otel.flush()
  const refocusEngagement = engagementOf(refocus)
  expect(refocusEngagement).toHaveLength(1)
  expectEngagementMs(refocusEngagement[0]!, {
    visibleMs: 9_500,
    activeMs: 6_500,
  })
})

test('WA-6 / R11: consent omitted emits no engagement OTLP or records', async () => {
  const clock = installClock()
  const page = installPage()
  const fetchMock = vi.fn<typeof globalThis.fetch>(
    async () => new Response('{}', { status: 200 }),
  )

  const analytics = connectShop({
    name: 'consent-omitted',
    consent: undefined,
    endpoint: 'https://collector.test',
    keepRecords: true,
    fetch: fetchMock,
    useBeacon: false,
    batchInterval: 100_000,
  })

  clock.advance(300)
  await hideAndSettle(() => page.hide())
  await analytics.otel.flush()

  expect(engagementOf(analytics)).toEqual([])

  const exportedEngagement = fetchMock.mock.calls.flatMap((call) => {
    const init = call[1]
    const body = init && typeof init === 'object' ? init.body : undefined
    if (body === undefined || body === null) return []
    try {
      return parseLogRecords(body).filter(
        (log) =>
          log.eventName === ENGAGEMENT_EVENT ||
          log.attributes['event.name'] === ENGAGEMENT_EVENT,
      )
    } catch {
      const rendered = String(body)
      return rendered.includes(ENGAGEMENT_EVENT) ? [{ eventName: rendered }] : []
    }
  })
  expect(exportedEngagement).toEqual([])
})

test('WA-6 / R9: later hide with both clocks 0 does not emit an empty record', async () => {
  const clock = installClock()
  const page = installPage()

  const analytics = connectShop()
  clock.advance(180)
  await hideAndSettle(() => page.hide())
  await analytics.otel.flush()

  const afterFirst = engagementOf(analytics)
  expect(afterFirst).toHaveLength(1)
  expectEngagementMs(afterFirst[0]!, { visibleMs: 180, activeMs: 180 })

  await hideAndSettle(() => page.hide())
  await analytics.otel.flush()
  expect(engagementOf(analytics)).toHaveLength(1)
})

test('WA-6 / R11: consent false emits no engagement OTLP or records', async () => {
  const page = installPage()
  const fetchMock = vi.fn<typeof globalThis.fetch>(
    async () => new Response('{}', { status: 200 }),
  )

  const analytics = context.start(() => {
    const connected = remember(
      connectWebAnalytics({
        ...OPTIONS,
        consent: false,
        endpoint: 'https://collector.test',
        keepRecords: true,
        fetch: fetchMock,
        useBeacon: false,
        batchInterval: 100_000,
      }),
    )
    const stopVisibility = visibilityAtom.subscribe()
    cleanups.push(stopVisibility)
    return connected
  })

  await hideAndSettle(() => page.hide())
  await analytics.otel.flush()

  expect(collectEngagement(snapshotRecords(analytics))).toEqual([])

  const exportedEngagement = fetchMock.mock.calls.flatMap((call) => {
    const init = call[1]
    const body = init && typeof init === 'object' ? init.body : undefined
    if (body === undefined || body === null) return []
    try {
      return parseLogRecords(body).filter(
        (log) =>
          log.eventName === ENGAGEMENT_EVENT ||
          log.attributes['event.name'] === ENGAGEMENT_EVENT,
      )
    } catch {
      const rendered = String(body)
      return rendered.includes(ENGAGEMENT_EVENT) ? [{ eventName: rendered }] : []
    }
  })
  expect(exportedEngagement).toEqual([])
})

test('WA-6 / F-09: engagement hide does not hijack urlAtom.catchLinks', async () => {
  const page = installPage()

  await context.start(async () => {
    const catchLinksBefore = urlAtom.catchLinks()
    const connected = remember(
      connectWebAnalytics({
        ...OPTIONS,
        consent: true,
        endpoint: null,
      }),
    )
    expect(urlAtom.catchLinks()).toBe(catchLinksBefore)
    expect(urlAtom.catchLinks()).toBe(true)

    const stopVisibility = visibilityAtom.subscribe()
    cleanups.push(stopVisibility)
    await hideAndSettle(() => page.hide())
    expect(urlAtom.catchLinks()).toBe(catchLinksBefore)
    expect(urlAtom.catchLinks()).toBe(true)
    return connected
  })
})
