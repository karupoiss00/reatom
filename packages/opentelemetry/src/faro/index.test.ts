import { context, log } from '@reatom/core'
import { expect, test, vi } from 'vitest'

import { reatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { installDomStubs, withWarnSpy } from '../test-helpers.ts'
import { faroTransport, logMeasurement } from './index.ts'
import { toOtlpAttributes } from '../toOtlpValue.ts'
import type { OtlpAttrValue } from '../toOtlpValue.ts'

const setup = (
  extra: Partial<Parameters<typeof reatomOpentelemetry>[0]> = {},
) => {
  const requests: Array<{ body: any; init: RequestInit }> = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push({ body: JSON.parse(String(init!.body)), init: init! })
    return new Response('ok', { status: 202 })
  })
  const otel = reatomOpentelemetry({
    name: 'faro-test',
    endpoint: null,
    serviceName: 'shop',
    keepRecords: true,
    transports: [
      faroTransport({ endpoint: 'https://faro.test/collect', fetch }),
    ],
    ...extra,
  })
  return { otel, fetch, requests }
}

test('real captured queue maps measurements, analytics, exceptions and ordinary logs', async () => {
  const { otel, requests } = setup()
  try {
    context.start(() => {
      logMeasurement(otel, {
        type: 'checkout',
        values: { duration: 12.5 },
        context: { 'session.id': 'one', 'url.full': 'https://shop.test/a' },
      })
      otel.log('session.start', { 'session.id': 'two' })
      otel.log('app.page_view', {
        'session.id': 'two',
        'url.full': 'https://shop.test/b',
      })
      otel.log('exception', {
        'exception.type': 'TypeError',
        'exception.message': 'bad',
        'exception.stacktrace': 'opaque stack',
      })
      log('hello')
    })
    await otel.flush()
    const bodies = requests.map((r) => r.body)
    const measurement = bodies.find((b) => b.measurements)
    expect(measurement.meta).toMatchObject({
      app: { name: 'shop' },
      session: { id: 'one' },
      page: { url: 'https://shop.test/a' },
    })
    expect(measurement.measurements[0]).toMatchObject({
      type: 'checkout',
      values: { duration: 12.5 },
      trace: { trace_id: expect.any(String), span_id: expect.any(String) },
      timestamp: expect.stringMatching(/Z$/),
    })
    expect(
      requests.find((r) => r.body.measurements)!.init.headers,
    ).toMatchObject({
      'x-faro-session-id': 'one',
      'Content-Type': 'application/json',
    })
    expect(bodies.flatMap((b) => b.events ?? []).map((e) => e.name)).toEqual(
      expect.arrayContaining(['session_start', 'view_changed']),
    )
    expect(bodies.flatMap((b) => b.exceptions ?? [])[0]).toMatchObject({
      type: 'TypeError',
      value: 'bad',
      context: { 'exception.stacktrace': 'opaque stack' },
    })
    expect(bodies.flatMap((b) => b.logs ?? [])[0]).toMatchObject({
      level: 'info',
      message: expect.stringContaining('hello'),
    })
    expect(bodies.some((b) => b.traces?.resourceSpans.length)).toBe(true)
    expect(bodies.every((b) => !b.meta.user)).toBe(true)
  } finally {
    otel.dispose()
  }
})

test('measurement validation and context cannot replace reserved fields', () => {
  const target = { log: vi.fn() }
  for (const values of [{ x: NaN }, { x: Infinity }, { '': 1 }, {}])
    expect(() => logMeasurement(target, { type: 'x', values })).toThrow(
      TypeError,
    )
  expect(() => logMeasurement(target, { type: '', values: { x: 1 } })).toThrow(
    TypeError,
  )
  expect(() =>
    logMeasurement(target, {
      type: 'x',
      values: { x: 1 },
      context: { 'measurement.type': 'oops' },
    }),
  ).toThrow(TypeError)
  expect(target.log).not.toHaveBeenCalled()
})

test('capture policy is applied before conversion; disabled logs cannot leak measurements', async () => {
  const { otel, requests } = setup()

  try {
    context.start(() => {
      otel.set({ ...otel(), signals: { logs: false } })
      logMeasurement(otel, { type: 'secret', values: { balance: 10 } })
    })
    await otel.flush()
    expect(JSON.stringify(requests)).not.toContain('balance')
  } finally {
    otel.dispose()
  }
})

test('transport-only pagehide uses keepalive even with beacon configured', async () => {
  const dom = installDomStubs()
  const beacon = vi.fn(() => true)
  const { otel, requests } = setup({ useBeacon: true, sendBeacon: beacon })
  try {
    context.start(() =>
      logMeasurement(otel, { type: 'x', values: { duration: 1 } }),
    )
    dom.windowListeners.get('pagehide')!()
    await vi.waitFor(() =>
      expect(requests.some((r) => r.body.measurements)).toBe(true),
    )
    expect(requests.every((r) => r.init.keepalive)).toBe(true)
    expect(beacon).not.toHaveBeenCalled()
  } finally {
    otel.dispose()
    dom.restore()
  }
})

test('Faro 202 succeeds, OTLP 200 fails and abort stops delivery', async () => {
  const abort = new AbortController()
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch,
    headers: { 'content-type': 'bad' },
  })
  const batch = {
    signal: 'logs' as const,
    payload: {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { version: 'test' },
              logRecords: [
                {
                  eventName: 'business',
                  timeUnixNano: '1000000',
                  traceId: 'a',
                  spanId: 'b',
                  attributes: [],
                  severityNumber: 9,
                },
              ],
            },
          ],
        },
      ],
    },
    keepalive: false,
    abort: abort.signal,
    itemCount: 1,
  }
  expect(await transport(batch)).toMatchObject({ accepted: 0, rejected: 1 })
  abort.abort()
  expect(await transport(batch)).toMatchObject({ accepted: 0, rejected: 1 })
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('captured metadata never changes to the last page or session in the flush', async () => {
  const { otel, requests } = setup()
  try {
    context.start(() => {
      otel.log('business.first', {
        'session.id': 'a',
        'url.full': '/first',
        'app.visitor.id': 'visitor',
      })
      otel.log('business.second', { 'session.id': 'b', 'url.full': '/second' })
      otel.log('reatom.update', { 'reatom.name': 'counter' })
    })
    await otel.flush()
    const first = requests.find((r) =>
      r.body.events?.some((e: any) => e.name === 'business.first'),
    )!
    const second = requests.find((r) =>
      r.body.events?.some((e: any) => e.name === 'business.second'),
    )!
    expect(first.body.meta).toMatchObject({
      session: { id: 'a' },
      page: { url: '/first' },
    })
    expect(second.body.meta).toMatchObject({
      session: { id: 'b' },
      page: { url: '/second' },
    })
    expect(first.body.meta.user).toBeUndefined()
    expect(first.body.events[0].attributes['app.visitor.id']).toBe('visitor')
    expect(
      requests
        .flatMap((r) => r.body.logs ?? [])
        .some((l: any) => l.context['event.name'] === 'reatom.update'),
    ).toBe(true)
  } finally {
    otel.dispose()
  }
})

test('invalid Faro sessions reject and expired deadlines never fetch', async () => {
  const fetch = vi.fn(
    async () =>
      new Response('ok', {
        status: 202,
        headers: { 'X-Faro-Session-Status': 'invalid' },
      }),
  )
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch,
  })
  const batch = {
    signal: 'logs' as const,
    payload: {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { version: 'test' },
              logRecords: [
                {
                  eventName: 'business',
                  timeUnixNano: '1000000',
                  traceId: 'a',
                  spanId: 'b',
                  attributes: [],
                  severityNumber: 9,
                },
              ],
            },
          ],
        },
      ],
    },
    keepalive: false,
    abort: new AbortController().signal,
    itemCount: 1,
  }
  expect(await transport(batch)).toMatchObject({
    accepted: 0,
    rejected: 1,
    errorMessage: expect.stringContaining('session invalid'),
  })
  expect(await transport({ ...batch, deadline: Date.now() - 1 })).toMatchObject(
    { accepted: 0, rejected: 1 },
  )
  expect(fetch).toHaveBeenCalledTimes(1)
})

test('converted unload bytes are checked before any request', async () => {
  const fetch = vi.fn(async () => new Response('ok', { status: 202 }))
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch,
  })
  const payload = {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            scope: { version: 'test' },
            logRecords: [
              {
                eventName: 'business',
                timeUnixNano: '1000000',
                traceId: 'a',
                spanId: 'b',
                attributes: [
                  {
                    key: 'context',
                    value: { stringValue: 'x'.repeat(61 * 1024) },
                  },
                ],
                severityNumber: 9,
              },
            ],
          },
        ],
      },
    ],
  }
  await expect(
    transport({
      signal: 'logs',
      payload: undefined,
      body: JSON.stringify(payload),
      keepalive: true,
      abort: new AbortController().signal,
      itemCount: 1,
    }),
  ).rejects.toThrow('keepalive budget')
  expect(fetch).not.toHaveBeenCalled()
})

test('receiver measurement fixture matches the official Faro envelope shape', async () => {
  const fixture = (await import('./fixtures/receiver.json')).default
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual(fixture)
    return new Response('ok', { status: 202 })
  })
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch,
  })
  const attr = (key: string, stringValue: string) => ({
    key,
    value: { stringValue },
  })
  const payload = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            attr('service.name', 'shop'),
            attr('service.version', '1'),
          ],
        },
        scopeLogs: [
          {
            scope: { version: 'test' },
            logRecords: [
              {
                eventName: 'measurement',
                timeUnixNano: '1000000',
                traceId: '0123456789abcdef0123456789abcdef',
                spanId: '0123456789abcdef',
                attributes: [
                  attr('session.id', 'session-a'),
                  attr('url.full', 'https://shop.test/a'),
                  attr('measurement.type', 'checkout'),
                  {
                    key: 'measurement.values',
                    value: {
                      kvlistValue: {
                        values: [
                          { key: 'duration_ms', value: { doubleValue: 12.5 } },
                        ],
                      },
                    },
                  },
                ],
                severityNumber: 9,
              },
            ],
          },
        ],
      },
    ],
  }
  expect(
    await transport({
      signal: 'logs',
      payload,
      keepalive: false,
      abort: new AbortController().signal,
      itemCount: 1,
    }),
  ).toEqual({ accepted: 1, rejected: 0 })
})

test.each([
  [503, {}],
  [202, { 'X-Faro-Session-Status': 'invalid' }],
] as const)(
  'secondary Faro HTTP %s failure warns while OTLP primary controls accounting',
  async (status, headers) => {
    await withWarnSpy(async (warn) => {
      const secondaryFetch = vi.fn(
        async () => new Response('response', { status, headers }),
      )
      const primaryFetch = vi.fn(
        async () => new Response('{}', { status: 200 }),
      )
      const otel = reatomOpentelemetry({
        name: 'fanout',
        endpoint: 'https://collector.test',
        serviceName: 'shop',
        fetch: primaryFetch,
        transports: [
          faroTransport({
            endpoint: 'https://faro.test/collect',
            fetch: secondaryFetch,
          }),
        ],
      })
      try {
        context.start(() =>
          logMeasurement(otel, { type: 'checkout', values: { duration: 1 } }),
        )
        await otel.flush()
        expect(primaryFetch).toHaveBeenCalled()
        expect(secondaryFetch).toHaveBeenCalled()
        expect(
          warn.mock.calls.some((call) =>
            String(call[0]).includes(
              'Additional transport reported delivery failure',
            ),
          ),
        ).toBe(true)
        expect(otel.stats().exported).toBeGreaterThan(0)
        expect(otel.stats().droppedByReason.export).toBe(0)
      } finally {
        otel.dispose()
      }
    })
  },
)

test('all unload metadata envelopes start before any response resolves', async () => {
  const settle: Array<(response: Response) => void> = []
  const fetch = vi.fn(
    (_url: unknown, _init?: RequestInit) =>
      new Promise<Response>((resolve) => settle.push(resolve)),
  )
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch,
  })
  const log = (page: string) => ({
    eventName: 'business',
    timeUnixNano: '1000000',
    traceId: 'a',
    spanId: 'b',
    severityNumber: 9,
    attributes: [{ key: 'url.full', value: { stringValue: page } }],
  })
  const pending = transport({
    signal: 'logs',
    payload: {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [
            {
              scope: { version: 'test' },
              logRecords: [log('/first'), log('/second')],
            },
          ],
        },
      ],
    },
    keepalive: true,
    abort: new AbortController().signal,
    itemCount: 2,
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(settle).toHaveLength(2)
  settle[0]!(new Response('ok', { status: 202 }))
  settle[1]!(new Response('failed', { status: 503 }))
  expect(await pending).toMatchObject({
    accepted: 1,
    rejected: 1,
    errorMessage: 'Faro HTTP 503',
  })
})

test('web-vitals measurements retain lowercase values and native Faro context aliases', async () => {
  const { otel, requests } = setup()
  try {
    logMeasurement(otel, {
      type: 'web-vitals',
      values: { cls: 0.12, delta: 0.02 },
      context: {
        'web_vital.id': 'vital-one',
        'web_vital.rating': 'needs-improvement',
        'web_vital.navigation_type': 'navigate',
        'app.extra': 'retained',
      },
    })
    await otel.flush()
    const measurement = requests.find((request) => request.body.measurements)
      ?.body.measurements[0]
    expect(measurement.type).toBe('web-vitals')
    expect(measurement.values).toEqual({ cls: 0.12, delta: 0.02 })
    expect(measurement.context).toMatchObject({
      id: 'vital-one',
      rating: 'needs-improvement',
      navigation_type: 'navigate',
      'web_vital.id': 'vital-one',
      'app.extra': 'retained',
    })
    expect(measurement.context.navigation_entry_id).toBeUndefined()
  } finally {
    otel.dispose()
  }
})

test('captured record users split every Faro signal even with identical app, session and page', async () => {
  const envelopes: any[] = []
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch: async (_url, init) => {
      envelopes.push(JSON.parse(String(init?.body)))
      return new Response('ok', { status: 202 })
    },
  })
  const resource = {
    attributes: toOtlpAttributes({
      'service.name': 'shop',
      'session.id': 'shared-session',
      'page.url': 'https://shop.test/same',
    }),
  }
  const users = [
    {
      'user.id': 'A',
      'user.name': 'alice',
      'user.email': 'alice@example.test',
      'user.full_name': 'Alice Example',
      'user.hash': 'hash-A',
      'user.roles': ['admin', 'operator'],
    },
    { 'user.id': 'B' },
  ] satisfies Array<Record<string, OtlpAttrValue>>
  const logRecords = users.flatMap((user) =>
    [
      { eventName: 'reatom.log', attributes: toOtlpAttributes(user) },
      { eventName: 'business.event', attributes: toOtlpAttributes(user) },
      {
        eventName: 'measurement',
        attributes: toOtlpAttributes({
          ...user,
          'measurement.type': 'custom',
          'measurement.values': { duration: 10 },
        }),
      },
      {
        eventName: 'exception',
        attributes: toOtlpAttributes({
          ...user,
          'exception.type': 'Error',
          'exception.message': 'example',
        }),
      },
    ].map((record) => ({
      ...record,
      timeUnixNano: '1000000',
      traceId: 'trace',
      spanId: 'span',
      severityNumber: 9,
    })),
  )
  const logsPayload = {
    resourceLogs: [
      { resource, scopeLogs: [{ scope: { version: 'test' }, logRecords }] },
    ],
  }
  expect(
    await transport({
      signal: 'logs',
      payload: logsPayload,
      keepalive: false,
      abort: new AbortController().signal,
      itemCount: 8,
    }),
  ).toEqual({ accepted: 8, rejected: 0 })
  expect(envelopes).toHaveLength(2)
  for (const body of envelopes) {
    expect(body.meta.app).toEqual({ name: 'shop' })
    expect(body.meta.session).toEqual({ id: 'shared-session' })
    expect(body.meta.page).toEqual({ url: 'https://shop.test/same' })
    for (const kind of ['logs', 'events', 'measurements', 'exceptions'])
      expect(body[kind]).toHaveLength(1)
  }
  expect(envelopes[0].meta.user).toEqual({
    id: 'A',
    username: 'alice',
    email: 'alice@example.test',
    fullName: 'Alice Example',
    hash: 'hash-A',
    roles: 'admin,operator',
  })
  expect(envelopes[1].meta.user).toEqual({ id: 'B' })
  expect(envelopes[0].logs[0].context['user.roles']).toBe(
    '["admin","operator"]',
  )
  expect(envelopes[1].events[0].attributes['user.id']).toBe('B')
  envelopes.length = 0
  const spans = users.map((user) => ({
    name: 'operation',
    traceId: 'trace',
    spanId: 'span',
    startTimeUnixNano: '1000000',
    endTimeUnixNano: '2000000',
    attributes: toOtlpAttributes(user),
  }))
  const tracesPayload = {
    resourceSpans: [
      { resource, scopeSpans: [{ scope: { version: 'test' }, spans }] },
    ],
  }
  const before = JSON.stringify(tracesPayload)
  expect(
    await transport({
      signal: 'traces',
      payload: tracesPayload,
      keepalive: false,
      abort: new AbortController().signal,
      itemCount: 2,
    }),
  ).toEqual({ accepted: 2, rejected: 0 })
  expect(envelopes).toHaveLength(2)
  expect(envelopes[0].meta.user.id).toBe('A')
  expect(envelopes[1].meta.user).toEqual({ id: 'B' })
  for (const body of envelopes)
    expect(body.traces.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1)
  expect(
    envelopes[0].traces.resourceSpans[0].scopeSpans[0].spans[0].attributes.find(
      (attr: any) => attr.key === 'user.roles',
    ).value,
  ).toEqual({
    arrayValue: {
      values: [{ stringValue: 'admin' }, { stringValue: 'operator' }],
    },
  })
  expect(JSON.stringify(tracesPayload)).toBe(before)
})

test('user projection ignores resource identity, preserves explicit record bundles and omits invalid roles', async () => {
  const bodies: any[] = []
  const transport = faroTransport({
    endpoint: 'https://faro.test/collect',
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('ok', { status: 202 })
    },
  })
  const records: Array<Record<string, OtlpAttrValue>> = [
    { 'user.id': 'B' },
    { 'user.email': 'only@example.test' },
    {
      'app.visitor.id': 'anonymous-visitor',
      'session.id': 'anonymous-session',
    },
    { 'user.roles': ['admin,operator'] },
    { 'user.roles': [1, 'operator'] },
    { 'user.roles': [] },
    { 'user.roles': [''] },
    { 'user.roles': 'admin,operator' },
    { 'user.id': 123, 'user.name': false },
  ]
  for (const fields of records) {
    bodies.length = 0
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: toOtlpAttributes({
              'user.id': 'resource-A',
              'user.name': 'resource-name',
              'user.email': 'resource@example.test',
            }),
          },
          scopeLogs: [
            {
              scope: { version: 'test' },
              logRecords: [
                {
                  eventName: 'business',
                  timeUnixNano: '1000000',
                  traceId: 'trace',
                  spanId: 'span',
                  severityNumber: 9,
                  attributes: toOtlpAttributes(fields),
                },
              ],
            },
          ],
        },
      ],
    }
    const before = JSON.stringify(payload)
    await transport({
      signal: 'logs',
      payload,
      keepalive: false,
      abort: new AbortController().signal,
      itemCount: 1,
    })
    expect(bodies).toHaveLength(1)
    if (fields['user.id'] === 'B')
      expect(bodies[0].meta.user).toEqual({ id: 'B' })
    else if (fields['user.email'] === 'only@example.test')
      expect(bodies[0].meta.user).toEqual({ email: 'only@example.test' })
    else expect(bodies[0].meta.user).toBeUndefined()
    expect(JSON.stringify(payload)).toBe(before)
  }
})

test('manual captured user.id reaches Faro metadata and event attributes without analytics identity', async () => {
  const { otel, requests } = setup()
  try {
    expect(otel().endpoint).toBeNull()
    otel.set((current) => ({
      ...current,
      headers: { 'x-test': 'native-config' },
    }))
    expect(otel().headers?.['x-test']).toBe('native-config')
    context.start(() =>
      otel.log('manual.identity', { 'user.id': 'manual-user' }),
    )
    await otel.flush()
    const envelope = requests.find((request) =>
      request.body.events?.some(
        (event: any) => event.name === 'manual.identity',
      ),
    )!.body
    expect(envelope.meta.user).toEqual({ id: 'manual-user' })
    expect(envelope.events[0].attributes['user.id']).toBe('manual-user')
    expect(envelope.meta.session).toBeUndefined()
    expect(envelope.meta.page).toBeUndefined()
    expect(JSON.stringify(envelope)).not.toContain('app.visitor.id')
  } finally {
    otel.dispose()
  }
})
