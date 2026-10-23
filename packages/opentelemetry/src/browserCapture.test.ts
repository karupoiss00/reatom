import { expect, test } from 'vitest'
import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { browserCaptureOf, setBrowserMetadata } from './browserCapture.ts'
import { attrsOf } from './test-helpers.ts'

test('diagnostic capture reserves client spans and preserves capture-time page metadata', () => {
  const otel = reatomOpentelemetry({ name: 'capture-seam', endpoint: null })
  let page = '/before'
  setBrowserMetadata(otel, () => ({
    'session.id': 'trusted-session',
    'page.url': page,
  }))
  const capture = browserCaptureOf(otel)!
  const snapshot = capture.snapshot()
  const span = capture.span({
    name: 'GET',
    kind: 'client',
    startTimeMs: 10,
    snapshot,
    attributes: { 'url.full': 'https://api.test/task' },
  })!
  page = '/after'
  span.finish({ endTimeMs: 20 })
  const record = otel
    .records()
    .find((record: any) => record.spanId === span.context.spanId) as any
  expect(record.kind).toBe(3)
  expect(attrsOf(record)['page.url']).toBe('/before')
  expect(attrsOf(record)['url.full']).toBe('https://api.test/task')
  expect(attrsOf(record)['session.id']).toBe('trusted-session')
  otel.dispose()
})

test('diagnostic logs follow diagnostics while public logs stay independent', () => {
  const otel = reatomOpentelemetry({ name: 'capture-consent', endpoint: null })
  otel.set((current) => ({
    ...current,
    consent: { diagnostics: false },
  }))
  const capture = browserCaptureOf(otel)!
  const initial = otel.records().length
  capture.log({ eventName: 'custom.diagnostic', timeMs: 1, severityNumber: 13 })
  expect(otel.records().length).toBe(initial)
  otel.log('manual.event')
  expect(otel.records().length).toBeGreaterThan(0)
  otel.dispose()
})

test('keyed cleanup and instance disposal suppress late completion', () => {
  const otel = reatomOpentelemetry({ name: 'capture-dispose', endpoint: null })
  const capture = browserCaptureOf(otel)!
  let stopped = 0
  capture.attach(() => stopped++, 'same')
  capture.attach(() => stopped++, 'same')
  expect(stopped).toBe(1)
  const pending = capture.span({ name: 'pending', startTimeMs: 1 })!
  otel.dispose()
  pending.finish({ endTimeMs: 2 })
  expect(otel.records()).toEqual([])
  expect(stopped).toBe(2)
  capture.attach(() => stopped++)
  expect(stopped).toBe(3)
})

test('custom diagnostic names are excluded at export after consent revocation', async () => {
  const sent: unknown[] = []
  const otel = reatomOpentelemetry({
    name: 'capture-export-policy',
    endpoint: null,
    batchInterval: 100000,
    transports: [
      async (batch) => {
        sent.push(batch)
        return { accepted: batch.itemCount, rejected: 0 }
      },
    ],
  })
  const capture = browserCaptureOf(otel)!
  capture.log({ eventName: 'custom.diagnostic', timeMs: 1 })
  otel.log('custom.public')
  otel.set((current) => ({
    ...current,
    consent: { diagnostics: false },
  }))
  await otel.flush()
  const wire = JSON.stringify(sent)
  expect(wire).not.toContain('custom.diagnostic')
  expect(wire).toContain('custom.public')
  otel.dispose()
})

test('snapshot session identity is stripped when analytics consent disappears', () => {
  const otel = reatomOpentelemetry({
    name: 'capture-session-revoke',
    endpoint: null,
  })
  let consent = true
  setBrowserMetadata(otel, () =>
    consent ? { 'session.id': 'private-session' } : {},
  )
  const capture = browserCaptureOf(otel)!
  const snapshot = capture.snapshot()
  consent = false
  capture.log({ eventName: 'browser.test', timeMs: 1, snapshot })
  const entry = otel
    .records()
    .find((record: any) => record.eventName === 'browser.test') as any
  expect(attrsOf(entry)['session.id']).toBeUndefined()
  otel.dispose()
})

test('span completion releases reservations when capture or record-building callbacks throw', async () => {
  const { context } = await import('@reatom/core')
  const otel = reatomOpentelemetry({
    name: 'capture-terminal-errors',
    endpoint: null,
  })
  const capture = browserCaptureOf(otel)!
  const throwing = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('attribute callback failed')
      },
    },
  )
  const first = capture.span({ name: 'capture-fails', startTimeMs: 1 })!
  expect(otel.stats().active).toBe(1)
  first.finish({ endTimeMs: 2, attributes: throwing })
  expect(otel.stats().active).toBe(0)
  const dropped = otel.stats().dropped
  first.finish({ endTimeMs: 3 })
  first.cancel()
  expect(otel.stats().dropped).toBe(dropped)
  const second = capture.span({ name: 'builder-fails', startTimeMs: 3 })!
  context.start(() =>
    otel.attributesVar.run(throwing, () => second.finish({ endTimeMs: 4 })),
  )
  expect(otel.stats().active).toBe(0)
  const recovered = capture.span({ name: 'recovered', startTimeMs: 5 })!
  expect(recovered).toBeTruthy()
  recovered.finish({ endTimeMs: 6 })
  expect(otel.stats().active).toBe(0)
  otel.dispose()
})
