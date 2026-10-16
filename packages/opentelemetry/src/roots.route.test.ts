import {
  action,
  context,
  noop,
  reatomRoute,
  sleep,
  urlAtom,
  wrap,
} from '@reatom/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import {
  HEX_SPAN_ID,
  HEX_TRACE_ID,
  type ParsedSpan,
  parseSpans,
} from './test-helpers.ts'

type RootKind = 'route' | 'mount' | 'action' | 'atom'

type V2FactoryInput = Parameters<typeof reatomOpentelemetry>[0] & {
  name?: string
  roots?: ReadonlyArray<RootKind>
  route?: 'child' | 'link'
}

type V2Instance = ReturnType<typeof reatomOpentelemetry> & {
  createTrace: (options?: { name?: string }) => unknown
  traceVar: { set: (value: unknown) => void }
}

type OtlpLink = {
  traceId: string
  spanId: string
  attributes?: Array<{ key: string; value: { stringValue?: string } }>
}

const cleanups: Array<() => void> = []

beforeEach(() => {
  urlAtom.routes = {}
})

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  urlAtom.routes = {}
})

const setupUrl = () => {
  urlAtom.sync.set(() => noop)
  urlAtom.set(new URL('http://localhost/'))
}

const setup = (overrides: Partial<V2FactoryInput> = {}) => {
  const bodies: string[] = []
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body))
    return new Response('{}', { status: 200 })
  })
  const otel = reatomOpentelemetry({
    name: 'roots.route',
    endpoint: 'https://traces.example.com',
    serviceName: 'route-watershed',
    batchInterval: 50,
    maxBatchSize: 100,
    maxQueueSize: 1000,
    retry: { maxRetries: 0 },
    fetch: fetchMock,
    useBeacon: false,
    ...overrides,
  } as Parameters<typeof reatomOpentelemetry>[0])
  cleanups.push(otel.dispose)
  return { otel: otel as V2Instance, bodies, fetchMock }
}

const spansOf = (bodies: readonly string[]): ParsedSpan[] =>
  bodies.flatMap(parseSpans)

const namedSpans = (spans: readonly ParsedSpan[], name: string) =>
  spans.filter((span) => span.name === name)

const linksOf = (bodies: readonly string[], name: string): OtlpLink[] => {
  for (const body of bodies) {
    const raw = JSON.parse(body) as {
      resourceSpans?: Array<{
        scopeSpans?: Array<{
          spans?: Array<{ name: string; links?: OtlpLink[] }>
        }>
      }>
    }
    for (const resource of raw.resourceSpans ?? []) {
      for (const scope of resource.scopeSpans ?? []) {
        const span = scope.spans?.find((candidate) => candidate.name === name)
        if (span) return span.links ?? []
      }
    }
  }
  return []
}

const linkReason = (link: OtlpLink) =>
  link.attributes?.find((attribute) => attribute.key === 'reatom.link.reason')
    ?.value.stringValue

test('a route with loaders gives one short route root and one traceId including post-loader actions', async () => {
  const { otel, bodies } = setup({ name: 'shop' })

  await context.start(async () => {
    setupUrl()
    const fetchGoods = action(async (category: string) => {
      await wrap(sleep(5))
      return [{ id: category }]
    }, 'goods.fetch')

    const goodsRoute = reatomRoute(
      {
        path: 'goods/:category',
        async loader({ category }) {
          return await wrap(fetchGoods(category))
        },
      },
      'goods',
    )

    const afterLoad = action(() => 'ready', 'goods.afterLoad')

    goodsRoute.go({ category: 'tech' })
    expect(await wrap(goodsRoute.loader())).toEqual([{ id: 'tech' }])
    expect(afterLoad()).toBe('ready')
  })

  await otel.flush()

  const spans = spansOf(bodies)
  const routeSpans = namedSpans(spans, 'route goods')
  expect(routeSpans).toHaveLength(1)

  const routeSpan = routeSpans[0]!
  expect(routeSpan.traceId).toMatch(HEX_TRACE_ID)
  expect(routeSpan.spanId).toMatch(HEX_SPAN_ID)
  expect(routeSpan.parentSpanId).toBeUndefined()
  expect(routeSpan.endTimeUnixNano).toEqual(expect.any(String))
  expect(routeSpan.attributes['reatom.kind']).toBe('route')
  expect(routeSpan.attributes['reatom.parent.reason']).toBe('root')

  const fetchSpan = namedSpans(spans, 'goods.fetch')[0]
  const afterSpan = namedSpans(spans, 'goods.afterLoad')[0]
  expect(fetchSpan).toBeDefined()
  expect(afterSpan).toBeDefined()
  expect(fetchSpan!.traceId).toBe(routeSpan.traceId)
  expect(afterSpan!.traceId).toBe(routeSpan.traceId)
  expect(afterSpan!.attributes['reatom.parent.reason']).toBe('route')
  expect(fetchSpan!.attributes['reatom.parent.reason']).toBe('route')
  expect(BigInt(routeSpan.endTimeUnixNano)).toBeGreaterThanOrEqual(
    BigInt(fetchSpan!.endTimeUnixNano),
  )
  expect(BigInt(routeSpan.endTimeUnixNano)).toBeLessThanOrEqual(
    BigInt(afterSpan!.startTimeUnixNano),
  )
})

test('withOTel({ boundary: false }) modal stays in the page trace with its own short span', async () => {
  const { otel, bodies } = setup({ name: 'shop' })

  await context.start(async () => {
    setupUrl()
    const shopRoute = reatomRoute(
      {
        path: 'shop',
        async loader() {
          await wrap(sleep(5))
          return { ok: true }
        },
      },
      'shop',
    )

    const dialogRoute = shopRoute
      .reatomRoute(
        {
          params(arg: { open?: boolean }) {
            return arg.open ? { open: true } : null
          },
        },
        'dialog',
      )
      .extend(
        otel.withOTel({
          boundary: false,
        } as Parameters<typeof otel.withOTel>[0]),
      )

    shopRoute.go()
    expect(await wrap(shopRoute.loader())).toEqual({ ok: true })
    dialogRoute.go({ open: true })
    expect(dialogRoute()).toEqual({ open: true })
  })

  await otel.flush()

  const spans = spansOf(bodies)
  const pageSpan = namedSpans(spans, 'route shop')[0]
  const dialogSpan = namedSpans(spans, 'route dialog')[0]
  expect(pageSpan).toBeDefined()
  expect(dialogSpan).toBeDefined()
  expect(dialogSpan!.traceId).toBe(pageSpan!.traceId)
  expect(dialogSpan!.endTimeUnixNano).toEqual(expect.any(String))
  expect(dialogSpan!.attributes['reatom.kind']).toBe('route')
})

test('roots: [] creates no automatic route root while traceVar.set(createTrace()) still works', async () => {
  const { otel, bodies } = setup({ name: 'shop', roots: [] })

  await context.start(async () => {
    setupUrl()
    const goodsRoute = reatomRoute(
      {
        path: 'goods/:category',
        async loader({ category }) {
          await wrap(sleep(1))
          return { category }
        },
      },
      'goods',
    )
    const afterLoad = action(() => 'ready', 'goods.afterLoad')

    goodsRoute.go({ category: 'tech' })
    expect(await wrap(goodsRoute.loader())).toEqual({ category: 'tech' })
    expect(afterLoad()).toBe('ready')
  })

  await otel.flush()

  const automaticSpans = spansOf(bodies)
  expect(namedSpans(automaticSpans, 'route goods')).toHaveLength(0)
  expect(namedSpans(automaticSpans, 'goods.afterLoad')).toHaveLength(0)

  bodies.length = 0

  await context.start(() => {
    const send = action(() => 'sent', 'checkout.send')
    otel.traceVar.set(otel.createTrace({ name: 'checkout' }))
    expect(send()).toBe('sent')
  })

  await otel.flush()

  const manualSpans = spansOf(bodies)
  const checkoutRoot = namedSpans(manualSpans, 'checkout')[0]
  const sendSpan = namedSpans(manualSpans, 'checkout.send')[0]
  expect(checkoutRoot).toBeDefined()
  expect(sendSpan).toBeDefined()
  expect(sendSpan!.traceId).toBe(checkoutRoot!.traceId)
})

test("route: 'link' gives each top-level action its own traceId with a link to the route span", async () => {
  const { otel, bodies } = setup({ name: 'shop', route: 'link' })

  await context.start(async () => {
    setupUrl()
    const shopRoute = reatomRoute(
      {
        path: 'shop',
        async loader() {
          await wrap(sleep(5))
          return { ok: true }
        },
      },
      'shop',
    )
    const add = action(() => 'added', 'shop.add')
    const checkout = action(() => 'paid', 'shop.checkout')

    shopRoute.go()
    expect(await wrap(shopRoute.loader())).toEqual({ ok: true })
    expect(add()).toBe('added')
    expect(checkout()).toBe('paid')
  })

  await otel.flush()

  const spans = spansOf(bodies)
  const routeSpans = namedSpans(spans, 'route shop')
  expect(routeSpans).toHaveLength(1)

  const routeSpan = routeSpans[0]!
  const addSpan = namedSpans(spans, 'shop.add')[0]
  const checkoutSpan = namedSpans(spans, 'shop.checkout')[0]
  expect(addSpan).toBeDefined()
  expect(checkoutSpan).toBeDefined()
  expect(addSpan!.traceId).not.toBe(routeSpan.traceId)
  expect(checkoutSpan!.traceId).not.toBe(routeSpan.traceId)
  expect(addSpan!.traceId).not.toBe(checkoutSpan!.traceId)

  const addLinks = linksOf(bodies, 'shop.add')
  const checkoutLinks = linksOf(bodies, 'shop.checkout')
  expect(addLinks).toEqual([
    expect.objectContaining({
      traceId: routeSpan.traceId,
      spanId: routeSpan.spanId,
    }),
  ])
  expect(checkoutLinks).toEqual([
    expect.objectContaining({
      traceId: routeSpan.traceId,
      spanId: routeSpan.spanId,
    }),
  ])
  expect(linkReason(addLinks[0]!)).toBe('route.page')
  expect(linkReason(checkoutLinks[0]!)).toBe('route.page')
})
