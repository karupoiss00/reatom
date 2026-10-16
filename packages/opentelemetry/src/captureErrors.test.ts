import { action, bind, context } from '@reatom/core'
import { expect, test } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { parseLogRecords, parseSpans } from './test-helpers.ts'

test.each([false, true])(
  'exception capture does not invoke accessors (opt-in=%s)',
  async (capture: boolean) => {
    const bodies: string[] = []
    const run = context.start(() => bind(<T>(callback: () => T) => callback()))
    const otel = reatomOpentelemetry({
      name: 'captureErrors',
      endpoint: 'https://collector.invalid',
      serviceName: 'error-capture',
      captureValues: capture ? {} : false,
      filter: (target) => target.name === 'capture.error',
      fetch: async (_url, init) => {
        bodies.push(String(init?.body))
        return new Response(null)
      },
    })
    const error = new Error()
    let reads = 0
    for (const key of ['name', 'constructor', 'message', 'stack'])
      Object.defineProperty(error, key, {
        configurable: true,
        get() {
          reads++
          return 'accessor-private-sentinel'
        },
      })
    try {
      const target = run(() =>
        action(() => {
          throw error
        }, 'capture.error'),
      )
      let caught = false
      try {
        run(target)
      } catch (value) {
        caught = true
        expect(value).toBe(error)
      }
      expect(caught).toBe(true)
      await otel.flush()
      const spans = bodies.flatMap(parseSpans)
      expect(spans.map((span) => span.name)).toEqual(['capture.error'])
      expect(spans[0]!.events).toEqual([])
      expect(spans[0]!.status?.code).toBe('error')
      const exceptions = bodies
        .flatMap(parseLogRecords)
        .filter((record) => record.eventName === 'exception')
      expect(exceptions).toHaveLength(1)
      expect(exceptions[0]!.severityNumber).toBe(17)
      expect(exceptions[0]!.traceId).toBe(spans[0]!.traceId)
      expect(exceptions[0]!.spanId).toBe(spans[0]!.spanId)
      expect(exceptions[0]!.attributes['exception.type']).toBe('Error')
      expect(exceptions[0]!.attributes).not.toHaveProperty('exception.message')
      expect(exceptions[0]!.attributes).not.toHaveProperty(
        'exception.stacktrace',
      )
      expect(reads).toBe(0)
      expect(bodies.join('')).not.toContain('accessor-private-sentinel')
    } finally {
      otel.dispose()
    }
  },
)

test.each(['named', 'native'])(
  'default abort captures its reason without exception metadata (%s)',
  async (kind: string) => {
    const bodies: string[] = []
    const run = context.start(() => bind(<T>(callback: () => T) => callback()))
    const otel = reatomOpentelemetry({
      name: 'captureErrors',
      endpoint: 'https://collector.invalid',
      serviceName: 'error-capture',
      filter: (target) => target.name === 'capture.abort',
      fetch: async (_url, init) => {
        bodies.push(String(init?.body))
        return new Response(null)
      },
    })
    const error =
      kind === 'native'
        ? new DOMException('abort-private-sentinel', 'AbortError')
        : Object.assign(new Error('abort-private-sentinel'), {
            name: 'AbortError',
          })
    try {
      const target = run(() =>
        action(() => {
          throw error
        }, 'capture.abort'),
      )
      let caught = false
      try {
        run(target)
      } catch (value) {
        caught = true
        expect(value).toBe(error)
      }
      expect(caught).toBe(true)
      await otel.flush()
      const spans = bodies.flatMap(parseSpans)
      expect(spans.map((span) => span.name)).toEqual(['capture.abort'])
      expect(spans[0]!.events).toEqual([])
      expect(spans[0]!.status).toBeUndefined()
      expect(spans[0]!.attributes).toEqual(
        expect.objectContaining({
          'reatom.payload': 'abort-private-sentinel',
          'reatom.name': 'capture.abort',
          'reatom.kind': 'action',
          'reatom.outcome': 'abort',
        }),
      )
    } finally {
      otel.dispose()
    }
  },
)
