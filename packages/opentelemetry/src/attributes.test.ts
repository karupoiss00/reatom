import {
  action,
  atom,
  bind,
  computed,
  context,
  log,
  notify,
  wrap,
} from '@reatom/core'
import { expect, test } from 'vitest'

import { withAttributes } from './attributes/index.ts'
import { browserCaptureOf } from './browserCapture.ts'
import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { reatomTestTelemetry } from './test-helpers.ts'

test('real atom settings, observable records, stats and disposal retain native identities', async () => {
  const otel = reatomOpentelemetry({
    name: 'real-atom',
    serviceName: 'shop',
  })
  expect(otel.name).toBe('otel.real-atom')
  expect(otel.instanceName).toBe('real-atom')
  expect(otel.resource['service.name']).toBe('shop')
  expect('options' in otel).toBe(false)
  expect(otel.records.set).toBeUndefined()
  const counts: number[] = []
  const stop = otel.stats.subscribe((stats) => counts.push(stats.active))
  const recordCounts: number[] = []
  const stopRecords = otel.records.subscribe((records) =>
    recordCounts.push(records.length),
  )
  const span = browserCaptureOf(otel)!.span({ name: 'HTTP', startTimeMs: 1 })!
  expect(otel.stats().active).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  span.finish({ endTimeMs: 2 })
  expect(otel.stats().active).toBe(0)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(counts).toContain(1)
  expect(recordCounts.some((count) => count > 0)).toBe(true)
  otel.set((current) => ({ ...current, keepRecords: true }))
  expect(otel().keepRecords).toBe(true)
  otel.dispose()
  expect(otel.disposed()).toBe(true)
  expect(otel.records()).toEqual([])
  stop()
  stopRecords()
})

test('operation identity is immutable across account switch and inherited by nested logs and HTTP snapshots', async () => {
  const user = atom<Record<string, any> | null>(
    { 'user.id': 'A', 'user.roles': ['reader'], 'app.tenant': 'first' },
    'auth.user',
  )
  const otel = reatomTestTelemetry({
    name: 'principal-operation',
    endpoint: null,
  }).extend(withAttributes(computed(() => user(), 'auth.attributes')))
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const operation = action(async () => {
    await wrap(gate)
    otel.log('nested.manual')
    log('nested core log')
    const http = browserCaptureOf(otel)!
    const span = http.span({
      name: 'HTTP',
      startTimeMs: 1,
      snapshot: http.snapshot(),
    })!
    span.finish({ endTimeMs: 2 })
    return 'result'
  }, 'app.pending-principal').extend(otel.withOTel())
  const pending = operation()
  user.set({ 'user.id': 'B', 'app.tenant': 'second' })
  release()
  expect(await pending).toBe('result')
  const records = otel.records() as any[]
  const inherited = records.filter(
    (record) =>
      record.name === 'app.pending-principal' ||
      record.name === 'HTTP' ||
      record.eventName === 'nested.manual' ||
      record.eventName === 'reatom.log',
  )
  expect(inherited).toHaveLength(4)
  expect(
    inherited.map((record) => record.name ?? record.eventName).sort(),
  ).toEqual(
    ['HTTP', 'app.pending-principal', 'nested.manual', 'reatom.log'].sort(),
  )
  for (const record of inherited) expect(record.attributes['user.id']).toBe('A')
  otel.log('independent.B')
  expect(
    (
      otel
        .records()
        .find((record: any) => record.eventName === 'independent.B') as any
    ).attributes['user.id'],
  ).toBe('B')
  otel.attributesVar.run({}, () => otel.log('explicit.empty'))
  expect(
    (
      otel
        .records()
        .find((record: any) => record.eventName === 'explicit.empty') as any
    ).attributes['user.id'],
  ).toBeUndefined()
  otel.dispose()
})

test('attribute sources bind to their attachment context, fail closed and preserve pending captures after null', () => {
  const user = atom('global', 'context.auth')
  const first = context.start(() => {
    user.set('first')
    return reatomTestTelemetry({
      name: 'principal-context-one',
      endpoint: null,
    }).extend(withAttributes(() => ({ 'user.id': user() })))
  })
  const second = context.start(() => {
    user.set('second')
    return reatomTestTelemetry({
      name: 'principal-context-two',
      endpoint: null,
    }).extend(withAttributes(() => ({ 'user.id': user() })))
  })
  first.log('one')
  second.log('two')
  expect(
    (first.records().find((r: any) => r.eventName === 'one') as any).attributes[
      'user.id'
    ],
  ).toBe('first')
  expect(
    (second.records().find((r: any) => r.eventName === 'two') as any)
      .attributes['user.id'],
  ).toBe('second')
  first.dispose()
  second.dispose()
  let source: any = { 'user.id': 'owned', 'user.roles': ['one'] }
  const otel = reatomTestTelemetry({
    name: 'principal-source-failure',
    endpoint: null,
  }).extend(withAttributes(() => source))
  const sink = browserCaptureOf(otel)!
  const pending = sink.span({
    name: 'pending',
    startTimeMs: 1,
    snapshot: sink.snapshot(),
  })!
  source['user.id'] = 'mutated'
  source['user.roles'].push('two')
  source = null
  pending.finish({ endTimeMs: 2 })
  expect(
    (otel.records().find((r: any) => r.name === 'pending') as any).attributes[
      'user.id'
    ],
  ).toBe('owned')
  source = Object.defineProperty({}, 'user.id', {
    enumerable: true,
    get() {
      throw new Error('secret marker')
    },
  })
  otel.log('source.failure')
  const failed = otel
    .records()
    .find((r: any) => r.eventName === 'source.failure') as any
  expect(failed.attributes['user.id']).toBeUndefined()
  expect(failed.attributes['reatom.attributes_error']).toBe('TypeError')
  expect(JSON.stringify(failed)).not.toContain('secret marker')
  otel.dispose()
})

test('readonly attributes observe the attachment source reactively across consumer contexts', async () => {
  const user = atom('outer', 'bound.attributes.user')
  let change!: (value: string) => void
  const otel = context.start(() => {
    user.set('owned')
    change = bind((value: string) => {
      user.set(value)
    })
    return reatomTestTelemetry({
      name: 'public-bound-attributes',
      endpoint: null,
    }).extend(withAttributes(() => ({ 'user.id': user() })))
  })
  const seen: unknown[] = []
  const stop = otel.attributes.subscribe((value) => seen.push(value['user.id']))
  expect(otel.attributes()['user.id']).toBe('owned')
  change('changed')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(otel.attributes()['user.id']).toBe('changed')
  expect(seen).toContain('changed')
  otel.dispose()
  expect(otel.attributes()).toEqual({})
  expect(typeof change).toBe('function')
  stop()
})

test('deferred reactive updates keep complete common snapshots including anonymous and explicit empty scopes', () => {
  const { otel, source, changed } = (() => {
    let source: Record<string, string> | null = null
    const otel = reatomTestTelemetry({
      name: 'deferred-common-identity',
      endpoint: null,
    }).extend(withAttributes(() => source))
    const value = atom(0, 'review.identity.value')
    const changed = action(
      () => value.set(value() + 1),
      'review.identity.change',
    ).extend(otel.withOTel())
    return {
      otel,
      changed,
      source: (next: Record<string, string> | null) => {
        source = next
      },
    }
  })()
  source(null)
  changed()
  source({ 'user.id': 'B', 'user.email': 'b@example.test' })
  // Reatom hooks deliberately run after the attribute capture boundary.
  notify()
  let updates = (otel.records() as any[]).filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates).not.toHaveLength(0)
  expect(updates.at(-1).attributes['user.id']).toBeUndefined()
  source({ 'user.id': 'A' })
  changed()
  source({ 'user.id': 'B', 'user.email': 'b@example.test' })
  notify()
  updates = (otel.records() as any[]).filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates.at(-1).attributes['user.id']).toBe('A')
  expect(updates.at(-1).attributes['user.email']).toBeUndefined()
  otel.attributesVar.run({}, changed)
  notify()
  updates = (otel.records() as any[]).filter(
    (record) => record.eventName === 'reatom.atom.update',
  )
  expect(updates.at(-1).attributes['user.id']).toBeUndefined()
  otel.dispose()
})

test('computed diamond identity is captured before deferred hooks and never augmented by later login', () => {
  let user: Record<string, string> | null = { 'user.id': 'A' }
  const otel = reatomTestTelemetry({
    name: 'diamond-identity',
    endpoint: null,
  }).extend(withAttributes(() => user))
  const qty = atom(1, 'review.qty')
  const price = atom(10, 'review.price')
  const total = computed(() => qty() * price(), 'review.total')
  const stop = total.subscribe(() => {})
  const setQty = action(() => qty.set(2), 'review.setQty').extend(
    otel.withOTel(),
  )
  const setPrice = action(() => price.set(20), 'review.setPrice').extend(
    otel.withOTel(),
  )
  otel.traceVar.set(otel.createTrace({ name: 'qty-root' }))
  setQty()
  otel.traceVar.set(otel.createTrace({ name: 'price-root' }))
  setPrice()
  expect(total()).toBe(40)
  user = { 'user.id': 'B', 'user.email': 'b@example.test' }
  notify()
  const diamonds = (otel.records() as any[]).filter(
    (record) => record.name === 'review.total',
  )
  expect(diamonds).toHaveLength(1)
  expect(diamonds[0].attributes['user.id']).toBe('A')
  expect(diamonds[0].attributes['user.email']).toBeUndefined()
  stop()
  otel.dispose()
})

test('attribute extension reserves its member before readers execute and releases the only subscription', () => {
  const user = atom('A', 'reentrant.attribute.user')
  const otel = reatomTestTelemetry({
    name: 'reentrant-attributes',
    endpoint: null,
  })
  let reads = 0,
    nestedReads = 0,
    duplicate: unknown
  otel.extend(
    withAttributes(() => {
      reads++
      if (reads === 1) {
        try {
          otel.extend(
            withAttributes(() => {
              nestedReads++
              return { 'user.id': 'nested' }
            }),
          )
        } catch (error) {
          duplicate = error
        }
      }
      return { 'user.id': user() }
    }),
  )
  expect(String(duplicate)).toContain('already installed')
  expect(nestedReads).toBe(0)
  user.set('B')
  notify()
  const before = reads
  otel.dispose()
  user.set('C')
  notify()
  expect(reads).toBe(before)
})
