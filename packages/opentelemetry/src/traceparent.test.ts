
import { action, bind, context, wrap } from '@reatom/core'
import { expect, test } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { HEX_SPAN_ID, HEX_TRACE_ID } from './test-helpers.ts'

const W3C_TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
const SAMPLED_PARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const nativeFetch = globalThis.fetch

type TraceContext = { traceId: string; spanId: string }

type V2Otel = ReturnType<typeof reatomOpentelemetry> & {
  traceVar: { set: (context: TraceContext) => void }
  createTrace: (options?: { name?: string }) => TraceContext
  traceparent: () => string | undefined
  parseTraceparent: (
    header: string | null | undefined,
  ) => TraceContext | undefined
}

type FactoryInput = Parameters<typeof reatomOpentelemetry>[0] & {
  name?: string
  endpoint?: string | null
}

const partsOf = (header: string) => {
  const [version, traceId, spanId, flags] = header.split('-')
  return { version, traceId, spanId, flags }
}

const start = (extra: Partial<FactoryInput> = {}) => {
  const run = context.start(() => bind(<T>(callback: () => T) => callback()))
  const otel = reatomOpentelemetry({
    name: 't018-traceparent',
    endpoint: null,
    serviceName: 't018-traceparent',
    filter: (target) =>
      target.name.startsWith('tp.') ||
      target.name.startsWith('chat.') ||
      target.name.startsWith('ws.'),
    retry: { maxRetries: 0 },
    batchInterval: 100_000,
    ...extra,
  } as Parameters<typeof reatomOpentelemetry>[0]) as V2Otel
  return { run, otel }
}

test('traceparent() is a W3C string inside a trace and undefined outside', () => {
  const { run, otel } = start()
  try {
    expect(otel.traceparent()).toBeUndefined()
    let inside: string | undefined
    const work = run(() =>
      action(() => {
        otel.traceVar.set(otel.createTrace({ name: 'tp.manual' }))
        inside = otel.traceparent()
        return 1
      }, 'tp.work'),
    )
    expect(run(work)).toBe(1)
    expect(inside).toMatch(W3C_TRACEPARENT)
    const parsed = partsOf(inside!)
    expect(parsed.version).toBe('00')
    expect(parsed.traceId).toMatch(HEX_TRACE_ID)
    expect(parsed.spanId).toMatch(HEX_SPAN_ID)
    expect(parsed.flags).toMatch(/^[0-9a-f]{2}$/)
    expect(otel.traceparent()).toBeUndefined()
  } finally {
    otel.dispose()
  }
})

test('F-04: createTrace then fetch with traceparent shares one trace after await wrap', async () => {
  const { run, otel } = start()
  let outgoing: string | undefined
  let afterAwait: string | undefined
  let ackHeader: string | undefined
  const appFetch = async (_url: string, init?: RequestInit) => {
    outgoing = new Headers(init?.headers).get('traceparent') ?? undefined
    return new Response('{}', { status: 200 })
  }
  try {
    const ack = run(() =>
      action(() => {
        ackHeader = otel.traceparent()
        return 'acked'
      }, 'chat.ack'),
    )
    const sendMessage = run(() =>
      action(async () => {
        otel.traceVar.set(otel.createTrace({ name: 'send message' }))
        const header = otel.traceparent()
        await wrap(
          appFetch('https://api.example.test/messages', {
            headers: { traceparent: header! },
          }),
        )
        afterAwait = otel.traceparent()
        return ack()
      }, 'chat.sendMessage'),
    )
    expect(await run(sendMessage)).toBe('acked')
    expect(outgoing).toMatch(W3C_TRACEPARENT)
    expect(afterAwait).toMatch(W3C_TRACEPARENT)
    expect(ackHeader).toMatch(W3C_TRACEPARENT)
    expect(partsOf(afterAwait!).traceId).toBe(partsOf(outgoing!).traceId)
    expect(partsOf(ackHeader!).traceId).toBe(partsOf(outgoing!).traceId)
    expect(otel.traceparent()).toBeUndefined()
    await otel.flush()
    const dumped = run(() => [...otel.records()]) as Array<{
      name?: string
      traceId?: string
      spanId?: string
      parentSpanId?: string
      flags?: number
    }>
    const parent = dumped.find((span) => span.name === 'send message')
    const child = dumped.find((span) => span.name === 'chat.ack')
    expect(parent).toBeDefined()
    expect(child?.traceId).toBe(parent?.traceId)
  } finally {
    otel.dispose()
  }
})

test('F-16: a WebSocket message with traceparent continues the external trace', () => {
  const { run, otel } = start()
  let continued: string | undefined
  try {
    const react = run(() =>
      action(() => {
        continued = otel.traceparent()
        return 'ok'
      }, 'ws.react'),
    )
    const onMessage = run(() =>
      action((header: string | null) => {
        const remote = otel.parseTraceparent(header)
        if (remote) otel.traceVar.set(remote)
        return react()
      }, 'ws.onMessage'),
    )
    expect(run(() => onMessage(SAMPLED_PARENT))).toBe('ok')
    expect(continued).toMatch(W3C_TRACEPARENT)
    expect(partsOf(continued!).traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(otel.stats()).toMatchObject({ invalidParent: 0 })
  } finally {
    otel.dispose()
  }
})

test('F-16: an invalid incoming header starts a new traceId and increments stats.invalidParent', () => {
  const { run, otel } = start()
  let started: string | undefined
  let parsed: TraceContext | undefined
  try {
    const react = run(() =>
      action(() => {
        started = otel.traceparent()
        return 'ok'
      }, 'ws.react'),
    )
    const onMessage = run(() =>
      action((header: string | null) => {
        parsed = otel.parseTraceparent(header)
        if (parsed) otel.traceVar.set(parsed)
        return react()
      }, 'ws.onMessage'),
    )
    expect(run(() => onMessage('not-a-traceparent'))).toBe('ok')
    expect(parsed).toBeUndefined()
    expect(started).toMatch(W3C_TRACEPARENT)
    expect(partsOf(started!).traceId).not.toBe(
      '4bf92f3577b34da6a3ce929d0e0e4736',
    )
    expect(otel.stats()).toMatchObject({ invalidParent: 1 })
  } finally {
    otel.dispose()
  }
})

test('a later context does not stay on the first remote parent', () => {
  const { otel } = start()
  try {
    const first = context.start(() => {
      const remote = otel.parseTraceparent(SAMPLED_PARENT)
      if (remote) otel.traceVar.set(remote)
      const react = action(() => otel.traceparent(), 'ws.first')
      return react()
    })
    const second = context.start(() => {
      const later = action(() => otel.traceparent(), 'ws.later')
      return later()
    })
    expect(first).toBeDefined()
    expect(partsOf(first!).traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(second).toBeDefined()
    expect(partsOf(second!).traceId).not.toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  } finally {
    otel.dispose()
  }
})

test('a missing incoming header does not increment stats.invalidParent', () => {
  const { run, otel } = start()
  try {
    const onMessage = run(() =>
      action((header: string | null | undefined) => {
        const remote = otel.parseTraceparent(header)
        if (remote) otel.traceVar.set(remote)
        return remote
      }, 'ws.onMessage'),
    )
    expect(run(() => onMessage(null))).toBeUndefined()
    expect(run(() => onMessage(undefined))).toBeUndefined()
    expect(otel.stats()).toMatchObject({ invalidParent: 0 })
  } finally {
    otel.dispose()
  }
})

test('default path does not patch fetch', () => {
  expect(globalThis.fetch).toBe(nativeFetch)
  const { otel } = start()
  try {
    expect(globalThis.fetch).toBe(nativeFetch)
  } finally {
    otel.dispose()
  }
  expect(globalThis.fetch).toBe(nativeFetch)
})
