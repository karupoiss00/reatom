import {
  action,
  atom,
  computed,
  context,
  log as LOG,
  toAbortError,
  wrap,
} from '@reatom/core'
import { expect, test } from 'vitest'

import {
  HEX_SPAN_ID,
  HEX_TRACE_ID,
  installDomStubs,
  type ParsedSpan,
  parseSpans,
  reatomTestTelemetry,
} from './test-helpers.ts'

const UNLOAD_BUDGET = 60 * 1024
const SEVERITY_INFO = 9
const SEVERITY_ERROR = 17

interface OtlpValue {
  stringValue?: string
  intValue?: string
  boolValue?: boolean
  doubleValue?: number | 'NaN' | 'Infinity' | '-Infinity'
  bytesValue?: string
  arrayValue?: { values: OtlpValue[] }
  kvlistValue?: { values: Array<{ key: string; value: OtlpValue }> }
}

const decodeValue = (value: OtlpValue | undefined): unknown => {
  if (!value) return undefined
  if (value.stringValue !== undefined) return value.stringValue
  if (value.intValue !== undefined) {
    const asNumber = Number(value.intValue)
    return Number.isSafeInteger(asNumber) && String(asNumber) === value.intValue
      ? asNumber
      : value.intValue
  }
  if (value.boolValue !== undefined) return value.boolValue
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.bytesValue !== undefined) return { bytes: value.bytesValue }
  if (value.arrayValue) return value.arrayValue.values.map(decodeValue)
  if (value.kvlistValue) {
    const record: Record<string, unknown> = {}
    for (const { key, field } of value.kvlistValue.values.map((item) => ({
      key: item.key,
      field: item.value,
    })))
      record[key] = decodeValue(field)
    return record
  }
  return undefined
}

const decodeAttrs = (
  kv: Array<{ key: string; value: OtlpValue }> | undefined,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const { key, value } of kv ?? []) out[key] = decodeValue(value)
  return out
}

interface ParsedLog {
  timeUnixNano?: string
  eventName?: string
  traceId?: string
  spanId?: string
  severityNumber?: number
  body?: unknown
  attributes: Record<string, unknown>
}

const parseLogRecords = (body: string | unknown): ParsedLog[] => {
  const raw = typeof body === 'string' ? JSON.parse(String(body)) : body
  if (!raw || typeof raw !== 'object') return []
  return ((raw as { resourceLogs?: unknown[] }).resourceLogs ?? []).flatMap(
    (resourceLogs) => {
      const groups =
        resourceLogs && typeof resourceLogs === 'object'
          ? ((resourceLogs as { scopeLogs?: unknown[] }).scopeLogs ?? [])
          : []
      return groups.flatMap((scopeLogs) => {
        const records =
          scopeLogs && typeof scopeLogs === 'object'
            ? ((scopeLogs as { logRecords?: unknown[] }).logRecords ?? [])
            : []
        return records.map((record): ParsedLog => {
          const row = record as {
            timeUnixNano?: string
            eventName?: string
            traceId?: string
            spanId?: string
            severityNumber?: number
            body?: OtlpValue
            attributes?: Array<{ key: string; value: OtlpValue }>
          }
          return {
            timeUnixNano: row.timeUnixNano,
            eventName: row.eventName,
            traceId: row.traceId,
            spanId: row.spanId,
            severityNumber: row.severityNumber,
            body: decodeValue(row.body),
            attributes: decodeAttrs(row.attributes),
          }
        })
      })
    },
  )
}

const readBody = async (body: BodyInit | null | undefined): Promise<string> => {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (body instanceof Blob) return body.text()
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
  return String(body)
}

interface ExportCall {
  url: string
  body: string
  keepalive: boolean
}

const setup = (
  overrides: Partial<Parameters<typeof reatomTestTelemetry>[0]> = {},
) => {
  const calls: ExportCall[] = []
  const otel = reatomTestTelemetry({
    name: 'logRecords',
    endpoint: 'https://collector.invalid',
    serviceName: 'log-records',
    batchInterval: 100_000,
    maxBatchSize: 50,
    maxQueueSize: 100,
    exportTimeoutMs: 30_000,
    retry: { maxRetries: 0 },
    captureValues: {},
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        body: await readBody(init?.body ?? null),
        keepalive: init?.keepalive === true,
      })
      return new Response(null)
    },
    ...overrides,
  })
  return { otel, calls }
}

const exported = (calls: ExportCall[]) => {
  const bodies = calls.map((call) => call.body)
  return {
    spans: bodies.flatMap((body) => {
      try {
        return parseSpans(body)
      } catch {
        return []
      }
    }),
    logs: bodies.flatMap(parseLogRecords),
  }
}

const eventNameOf = (log: ParsedLog) =>
  log.eventName ?? (log.attributes['event.name'] as string | undefined)

const logsNamed = (logs: ParsedLog[], name: string) =>
  logs.filter((log) => eventNameOf(log) === name)

const spanNamed = (spans: ParsedSpan[], name: string) =>
  spans.filter((span) => span.name === name)

test('LOG outside any action emits reatom.log on the app-session trace, never a span, never dropped', async () => {
  const { windowListeners, restore } = installDomStubs()
  const { otel, calls } = setup({
    filter: () => false,
    maxQueueSize: 1,
  })
  const payload = { n: 1 }
  try {
    context.start(() => {
      LOG('debug', payload)
      LOG.label('fetch payload', payload)
    })
    await otel.flush()
    windowListeners.get('pagehide')?.()
    await otel.flush()

    const { spans, logs } = exported(calls)
    const reatomLogs = logsNamed(logs, 'reatom.log')
    expect(reatomLogs.length).toBeGreaterThanOrEqual(2)
    expect(otel.otlp.stats().dropped).toBe(0)

    for (const record of reatomLogs) {
      expect(record.severityNumber).toBe(SEVERITY_INFO)
      expect(record.traceId).toMatch(HEX_TRACE_ID)
      expect(record.spanId).toMatch(HEX_SPAN_ID)
    }

    const unlabeled = reatomLogs.find(
      (record) => record.attributes['reatom.log.label'] !== 'fetch payload',
    )
    expect(unlabeled).toBeDefined()
    expect(unlabeled!.body).toEqual(['debug', payload])

    const labeled = reatomLogs.find(
      (record) => record.attributes['reatom.log.label'] === 'fetch payload',
    )
    expect(labeled).toBeDefined()
    expect(labeled!.body).toEqual([payload])

    expect(spanNamed(spans, 'LOG')).toEqual([])
    expect(spanNamed(spans, 'LOG.label')).toEqual([])
    expect(spanNamed(spans, 'reatom.log')).toEqual([])

    const session = spanNamed(spans, 'app.session')
    expect(session).toHaveLength(1)
    expect(session[0]!.attributes['reatom.kind']).toBe('session')
    for (const record of reatomLogs) {
      expect(record.traceId).toBe(session[0]!.traceId)
      expect(record.spanId).toBe(session[0]!.spanId)
    }
  } finally {
    otel.dispose()
    restore()
  }
})

test('thrown Error emits exception log severity ERROR with span context, not a span event', async () => {
  const { otel, calls } = setup()
  const failure = new TypeError('boom')
  Object.defineProperty(failure, 'stack', {
    value: 'captured-stack: boom at throw-error',
    configurable: true,
  })
  try {
    const explode = action(() => {
      throw failure
    }, 'explode')
    let caught: unknown
    context.start(() => {
      try {
        explode()
      } catch (error) {
        caught = error
      }
    })
    expect(caught).toBe(failure)
    await otel.flush()

    const { spans, logs } = exported(calls)
    const actionSpans = spanNamed(spans, 'explode')
    expect(actionSpans).toHaveLength(1)
    const actionSpan = actionSpans[0]!
    expect(actionSpan.status?.code).toBe('error')
    expect(
      actionSpan.events.filter((event) => event.name === 'exception'),
    ).toEqual([])

    const exceptions = logsNamed(logs, 'exception')
    expect(exceptions).toHaveLength(1)
    const record = exceptions[0]!
    expect(record.severityNumber).toBe(SEVERITY_ERROR)
    expect(record.traceId).toBe(actionSpan.traceId)
    expect(record.spanId).toBe(actionSpan.spanId)
    expect(record.attributes['exception.type']).toBe('TypeError')
    expect(record.attributes['exception.message']).toBe('boom')
    expect(record.attributes['exception.stacktrace']).toBe(
      'captured-stack: boom at throw-error',
    )
    expect(record.attributes['event.name']).toBe('exception')
  } finally {
    otel.dispose()
  }
})

test('AbortError and thrown Promise set reatom.outcome abort/suspense with unset status', async () => {
  const { otel, calls } = setup()
  const aborted = toAbortError('user cancel')
  const suspension = Promise.resolve('suspense')
  try {
    const cancel = action(() => {
      throw aborted
    }, 'cancel')
    const suspend = action(() => {
      throw suspension
    }, 'suspend')

    let abortCaught: unknown
    let suspendCaught: unknown
    await context.start(async () => {
      try {
        cancel()
      } catch (error) {
        abortCaught = error
      }
      try {
        await wrap(Promise.resolve(suspend()))
      } catch (error) {
        suspendCaught = error
      }
    })
    expect(abortCaught).toBe(aborted)
    expect(suspendCaught).toBe(suspension)
    await otel.flush()

    const { spans, logs } = exported(calls)
    expect(logsNamed(logs, 'exception')).toEqual([])

    const abortSpan = spanNamed(spans, 'cancel')
    expect(abortSpan).toHaveLength(1)
    expect(abortSpan[0]!.status).toBeUndefined()
    expect(abortSpan[0]!.attributes['reatom.outcome']).toBe('abort')
    expect(abortSpan[0]!.attributes['reatom.importance']).toBe('low')

    const suspenseSpan = spanNamed(spans, 'suspend')
    expect(suspenseSpan).toHaveLength(1)
    expect(suspenseSpan[0]!.status).toBeUndefined()
    expect(suspenseSpan[0]!.attributes['reatom.outcome']).toBe('suspense')
    expect(suspenseSpan[0]!.attributes['reatom.importance']).toBe('low')
  } finally {
    otel.dispose()
  }
})

test('pending async at pagehide exports outcome=pending inside a 60 KiB unload body', async () => {
  const { windowListeners, restore } = installDomStubs()
  const { otel, calls } = setup()
  const never = new Promise<never>(() => {})
  try {
    const hang = action(() => never, 'hang')
    context.start(() => {
      const hung = hang()
      expect(hung).toBeInstanceOf(Promise)
      expect(hung).not.toBe(never)
    })
    expect(otel.otlp.stats().active).toBeGreaterThan(0)

    windowListeners.get('pagehide')!()
    await otel.flush()

    const unload = calls.filter((call) => call.keepalive)
    expect(unload.length).toBeGreaterThan(0)
    const body = unload[0]!.body
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
      UNLOAD_BUDGET,
    )

    const pending = parseSpans(body).filter((span) => span.name === 'hang')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.status).toBeUndefined()
    expect(pending[0]!.attributes['reatom.outcome']).toBe('pending')
    expect(pending[0]!.endTimeUnixNano).toMatch(/^\d+$/)
  } finally {
    otel.dispose()
    restore()
  }
})

test('LOG.state with an unchanged value emits no record', async () => {
  const { otel, calls } = setup({ filter: () => false })
  const name = `t020-user-${Math.random().toString(16).slice(2)}`
  const first = { id: 1 }
  const second = { id: 2 }
  try {
    context.start(() => {
      expect(LOG.state(name, first)).toBe(first)
      expect(LOG.state(name, first)).toBe(first)
    })
    await otel.flush()
    const afterSame = logsNamed(exported(calls).logs, 'reatom.log').filter(
      (record) => record.attributes['reatom.log.state'] === name,
    )
    expect(afterSame).toHaveLength(1)
    expect(afterSame[0]!.severityNumber).toBe(SEVERITY_INFO)
    expect(afterSame[0]!.body).toEqual([name, first])

    context.start(() => {
      expect(LOG.state(name, second)).toBe(second)
      expect(LOG.state(name, second)).toBe(second)
    })
    await otel.flush()
    const afterChange = logsNamed(exported(calls).logs, 'reatom.log').filter(
      (record) => record.attributes['reatom.log.state'] === name,
    )
    expect(afterChange).toHaveLength(2)
    expect(afterChange[1]!.body).toEqual([name, second])
  } finally {
    otel.dispose()
  }
})

test('instance filter rejects atom and computed update logs; LOG still records', async () => {
  const { otel, calls } = setup({
    filter: (target) => target.name === 'visible.write',
  })
  try {
    context.start(() => {
      const hidden = atom(0, 'hidden.count')
      const doubled = computed(() => hidden() * 2, 'hidden.doubled')
      doubled.subscribe(() => {})
      const write = action(() => {
        hidden.set(1)
        LOG('kept')
        return doubled()
      }, 'visible.write')
      expect(write()).toBe(2)
    })
    await otel.flush()
    const { spans, logs } = exported(calls)
    expect(spanNamed(spans, 'visible.write')).toHaveLength(1)
    expect(logsNamed(logs, 'reatom.atom.update')).toEqual([])
    expect(logsNamed(logs, 'reatom.computed.update')).toEqual([])
    expect(logsNamed(logs, 'reatom.log').length).toBeGreaterThan(0)
  } finally {
    otel.dispose()
  }
})

test('withRetry with 3 attempts gives 3 child spans with reatom.attempt', async () => {
  const { otel, calls } = setup()
  let attempts = 0
  try {
    const probe = action(() => {
      attempts++
      if (attempts < 3) throw new Error(`fail-${attempts}`)
      return 'ok'
    }, 'probe')
    const load = action(() => {
      let last: unknown
      for (let i = 0; i < 3; i++) {
        try {
          return probe()
        } catch (error) {
          last = error
        }
      }
      throw last
    }, 'load')

    context.start(() => {
      expect(load()).toBe('ok')
    })
    expect(attempts).toBe(3)
    await otel.flush()

    const { spans } = exported(calls)
    const parent = spanNamed(spans, 'load')
    expect(parent).toHaveLength(1)
    const children = spanNamed(spans, 'probe')
    expect(children).toHaveLength(3)
    expect(children.map((span) => span.parentSpanId)).toEqual([
      parent[0]!.spanId,
      parent[0]!.spanId,
      parent[0]!.spanId,
    ])
    expect(children.map((span) => span.attributes['reatom.attempt'])).toEqual([
      '1',
      '2',
      '3',
    ])
  } finally {
    otel.dispose()
  }
})
