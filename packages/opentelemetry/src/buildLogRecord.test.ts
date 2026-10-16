import { expect, test, vi } from 'vitest'

import { buildExportPayload } from './buildExportPayload.ts'
import {
  buildLogRecord,
  buildLogsPayload,
  logsUrl,
  selectLogsUnloadBatch,
} from './buildLogRecord.ts'
import { buildSpan } from './buildSpan.ts'
import { selectUnloadBatch } from './selectUnloadBatch.ts'
import type { SpanId, TraceId } from './traceContext.ts'
import { tracesUrl } from './tracesUrl.ts'
import { availableUnloadBytes, reserveUnloadBytes } from './unloadBudget.ts'

const TRACE_ID = '5b8efff798038103d269b633813fc60c' as TraceId
const SPAN_ID = 'eee19b7ec3c1b174' as SpanId
const LIMIT = 60 * 1024
const utf8Bytes = (body: string) => new TextEncoder().encode(body).length

const installDocument = () => {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', page)
  return page as unknown as Document
}

test('builds log record with eventName, span context and INFO severity', () => {
  const record = buildLogRecord({
    eventName: 'reatom.atom.update',
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    timeMs: 1544712660000,
    body: { items: 3 },
    attributes: {
      'reatom.name': 'cart.summary',
      'reatom.frame.id': '813',
    },
  })

  expect(record.eventName).toBe('reatom.atom.update')
  expect(record.traceId).toBe(TRACE_ID)
  expect(record.spanId).toBe(SPAN_ID)
  expect(record.timeUnixNano).toBe('1544712660000000000')
  expect(record.severityNumber).toBe(9)
  expect(record.body).toEqual({
    kvlistValue: {
      values: [{ key: 'items', value: { intValue: '3' } }],
    },
  })
  expect(record.attributes).toEqual([
    { key: 'event.name', value: { stringValue: 'reatom.atom.update' } },
    { key: 'reatom.name', value: { stringValue: 'cart.summary' } },
    { key: 'reatom.frame.id', value: { stringValue: '813' } },
  ])
})

test.each([
  'reatom.atom.update',
  'reatom.computed.update',
  'reatom.log',
  'exception.suppressed',
] as const)('severityNumber is INFO (9) for %s', (eventName) => {
  const record = buildLogRecord({
    eventName,
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    timeMs: 0,
  })
  expect(record.severityNumber).toBe(9)
  expect(record.eventName).toBe(eventName)
  expect(record.attributes[0]).toEqual({
    key: 'event.name',
    value: { stringValue: eventName },
  })
})

test('exception records use ERROR (17) with the same span context', () => {
  const record = buildLogRecord({
    eventName: 'exception',
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    timeMs: 1761000000123,
    attributes: {
      'exception.type': 'TypeError',
      'exception.message': 'boom',
    },
  })
  expect(record.eventName).toBe('exception')
  expect(record.severityNumber).toBe(17)
  expect(record.traceId).toBe(TRACE_ID)
  expect(record.spanId).toBe(SPAN_ID)
  expect(record.timeUnixNano).toBe('1761000000123000000')
  expect('body' in record).toBe(false)
  expect(JSON.stringify(record)).not.toContain('"body"')
  expect(record.attributes).toEqual([
    { key: 'event.name', value: { stringValue: 'exception' } },
    { key: 'exception.type', value: { stringValue: 'TypeError' } },
    { key: 'exception.message', value: { stringValue: 'boom' } },
  ])
})

test('logsUrl is the tracesUrl sibling under /v1/logs', () => {
  const endpoint = 'https://c.example/otel?token=abc#frag'
  expect(tracesUrl(endpoint)).toBe(
    'https://c.example/otel/v1/traces?token=abc#frag',
  )
  expect(logsUrl(endpoint)).toBe(
    'https://c.example/otel/v1/logs?token=abc#frag',
  )
  expect(logsUrl('https://c.example/')).toBe('https://c.example/v1/logs')
})

test('mixed traces and logs unload stay under 60 KiB UTF-8 newest-first', () => {
  const document = installDocument()
  try {
    expect(availableUnloadBytes(document)).toBe(LIMIT)

    const makeTraceGroup = (name: string, pad: string) =>
      buildExportPayload({
        groups: [
          {
            resourceAttributes: { 'service.name': 'mixed' },
            version: '1.0.0',
            spans: [
              buildSpan({
                traceId: TRACE_ID,
                spanId: SPAN_ID,
                name,
                startTimeMs: 0,
                endTimeMs: 1,
                attributes: { pad },
              }),
            ],
          },
        ],
      }).resourceSpans[0]!

    const makeLogGroup = (eventName: string, pad: string) =>
      buildLogsPayload({
        groups: [
          {
            resourceAttributes: { 'service.name': 'mixed' },
            version: '1.0.0',
            logs: [
              buildLogRecord({
                eventName,
                traceId: TRACE_ID,
                spanId: SPAN_ID,
                timeMs: 0,
                body: pad,
              }),
            ],
          },
        ],
      }).resourceLogs[0]!

    const grow = <T>(minBytes: number, make: (pad: string) => T): T => {
      let count = Math.ceil(minBytes / 3)
      let group = make('界'.repeat(count))
      while (utf8Bytes(JSON.stringify(group)) < minBytes) {
        count += 256
        group = make('界'.repeat(count))
      }
      return group
    }

    const newerTrace = grow(22 * 1024, (pad) =>
      makeTraceGroup('newer-trace', pad),
    )
    const olderTrace = grow(42 * 1024, (pad) =>
      makeTraceGroup('older-trace', pad),
    )
    const newerLog = grow(22 * 1024, (pad) =>
      makeLogGroup('reatom.atom.update', pad),
    )
    const olderLog = grow(42 * 1024, (pad) => makeLogGroup('reatom.log', pad))

    expect(utf8Bytes(JSON.stringify(olderTrace))).toBeGreaterThan(
      JSON.stringify(olderTrace).length,
    )
    expect(utf8Bytes(JSON.stringify(olderLog))).toBeGreaterThan(
      JSON.stringify(olderLog).length,
    )

    const tracesResult = selectUnloadBatch({
      items: [olderTrace, newerTrace],
      maxBytes: availableUnloadBytes(document),
      encode: (item) => JSON.stringify(item),
    })
    const tracesBytes = utf8Bytes(tracesResult.body)
    expect(tracesBytes).toBeLessThanOrEqual(LIMIT)
    expect(tracesBytes).toBeGreaterThan(0)
    reserveUnloadBytes(document, tracesBytes)

    const logsResult = selectLogsUnloadBatch({
      items: [olderLog, newerLog],
      maxBytes: availableUnloadBytes(document),
      encode: (item) => JSON.stringify(item),
    })
    const logsBytes = utf8Bytes(logsResult.body)
    expect(logsBytes).toBeLessThanOrEqual(availableUnloadBytes(document))
    expect(logsBytes).toBeGreaterThan(0)
    reserveUnloadBytes(document, logsBytes)

    const combined = tracesBytes + logsBytes
    expect(combined).toBeLessThanOrEqual(LIMIT)
    expect(combined).toBeGreaterThan(tracesBytes)
    expect(availableUnloadBytes(document)).toBe(LIMIT - combined)
    expect(() =>
      reserveUnloadBytes(document, availableUnloadBytes(document) + 1),
    ).toThrow(RangeError)

    const tracesPayload = JSON.parse(tracesResult.body) as {
      resourceSpans: Array<{
        scopeSpans: Array<{ spans: Array<{ name: string }> }>
      }>
    }
    expect(tracesPayload).toHaveProperty('resourceSpans')
    expect(
      tracesPayload.resourceSpans.flatMap((entry) =>
        entry.scopeSpans.flatMap((scope) =>
          scope.spans.map((span) => span.name),
        ),
      ),
    ).toEqual(['newer-trace'])
    expect(tracesResult.keptCount).toBe(1)
    expect(tracesResult.droppedCount).toBe(1)

    const logsPayload = JSON.parse(logsResult.body) as {
      resourceLogs: Array<{
        scopeLogs: Array<{
          logRecords: Array<{ eventName: string; severityNumber: number }>
        }>
      }>
    }
    expect(logsPayload).toHaveProperty('resourceLogs')
    expect('resourceSpans' in logsPayload).toBe(false)
    const logRecords = logsPayload.resourceLogs.flatMap((entry) =>
      entry.scopeLogs.flatMap((scope) => scope.logRecords),
    )
    expect(logRecords.map((record) => record.eventName)).toEqual([
      'reatom.atom.update',
    ])
    expect(logRecords.map((record) => record.severityNumber)).toEqual([9])
    expect(logsResult.keptCount).toBe(1)
    expect(logsResult.droppedCount).toBe(1)
  } finally {
    vi.unstubAllGlobals()
  }
})
