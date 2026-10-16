import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import {
  LOCAL_VALUES,
  localValuesOf,
  reatomOtlpStore,
} from './ingest.ts'
import type { AdminRecord } from './ingest.ts'
import { recordValues } from './values.ts'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'))

const INSTANCE_RESOURCE = {
  'service.name': 'reatom-admin-test',
  'service.instance.id': 'local',
  'telemetry.sdk.name': '@reatom/opentelemetry',
  'telemetry.sdk.language': 'webjs',
  'telemetry.sdk.version': '1000.15.2',
}

const successSpan = readFixture('success-span.json') as {
  traceId: string
  spanId: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
}

const atomUpdate = readFixture('atom-update.json') as {
  span: {
    traceId: string
    spanId: string
    name: string
    startTimeUnixNano: string
    attributes: {
      'reatom.name': string
    }
  }
  log: {
    eventName: string
    traceId: string
    spanId: string
    body: unknown
    attributes: {
      'event.name': string
      'reatom.name': string
      'reatom.kind': string
      'reatom.frame.id': string
      'reatom.cause.ids': string[]
    }
  }
}

const recordsSnapshot = readFixture('records-snapshot.json') as Array<{
  eventName?: string
  name?: string
  traceId: string
  spanId: string
  parentSpanId?: string
  links?: Array<{ traceId: string; spanId: string }>
}>

const diamondLinks = readFixture('diamond-links.json') as {
  diamond: {
    name: string
    traceId: string
    spanId: string
    parentSpanId: string
    attributes: {
      'reatom.name': string
      'reatom.kind': string
      'reatom.frame.id': string
      'reatom.cause.ids': string[]
    }
  }
  links: Array<{
    traceId: string
    spanId: string
    reason: { 'reatom.link.reason': string }
  }>
}

const exceptionJoin = readFixture('exception-join.json') as {
  span: {
    traceId: string
    spanId: string
    name: string
    startTimeUnixNano: string
  }
  log: {
    eventName: string
    traceId: string
    spanId: string
    timeUnixNano: string
    body: unknown
    attributes: Array<{ key: string; value: unknown }>
  }
}

const unixNanoToMs = (nano: string) => Number(BigInt(nano) / 1_000_000n)

const createStore = (onClear?: () => void) =>
  ADMIN_FRAME.run(() =>
    reatomOtlpStore({
      sourceId: 'local',
      resource: INSTANCE_RESOURCE,
      onClear,
    }),
  )

const ingest = (
  store: ReturnType<typeof reatomOtlpStore>,
  records: readonly unknown[],
) => {
  ADMIN_FRAME.run(() => store.ingest(records))
}

const listRecords = (store: ReturnType<typeof reatomOtlpStore>) =>
  ADMIN_FRAME.run(() => store.records() as AdminRecord[])

test('ingest one action span into an AdminRecord kind span', () => {
  const store = createStore()
  ingest(store, [successSpan])

  const records = listRecords(store)
  expect(records).toHaveLength(1)

  const record = records[0]!
  expect(record.kind).toBe('span')
  expect(record.name).toBe(successSpan.name)
  expect(record.reatomKind).toBe('action')
  expect(record.frameId).toBe('1')
  expect(record.traceId).toBe(successSpan.traceId)
  expect(record.spanId).toBe(successSpan.spanId)
  expect(record.start).toBe(unixNanoToMs(successSpan.startTimeUnixNano))
  expect(record.end).toBe(unixNanoToMs(successSpan.endTimeUnixNano))
  expect(typeof record.start).toBe('number')
  expect(typeof record.end).toBe('number')
  expect(String(record.start)).not.toBe(successSpan.startTimeUnixNano)
  expect(String(record.end)).not.toBe(successSpan.endTimeUnixNano)
  expect(record.sourceId).toBe('local')
  expect(record.id).toEqual(expect.any(String))
  expect(record.id.length).toBeGreaterThan(0)
  expect(record.resource).toEqual(INSTANCE_RESOURCE)
  expect(record.atomName).toBe('devtools.ping')
  expect(record.outcome).toBe('ok')
})

test('otlp intValue becomes a number or bigint and keeps the null sentinel', () => {
  const store = createStore()
  ingest(store, [
    {
      traceId: 'trace-int',
      spanId: 'span-int',
      eventName: 'reatom.atom.update',
      timeUnixNano: '1000000',
      body: {
        kvlistValue: {
          values: [
            { key: 'wins', value: { intValue: '7' } },
            { key: 'max', value: { intValue: '9007199254740991' } },
            { key: 'past', value: { intValue: '9007199254740993' } },
            { key: 'huge', value: { intValue: '9223372036854775807' } },
            { key: 'empty', value: { stringValue: '[Null]' } },
          ],
        },
      },
      attributes: {
        'event.name': 'reatom.atom.update',
        'reatom.name': 'score',
        'reatom.kind': 'atom',
        'reatom.frame.id': '1',
      },
    },
  ])
  expect(listRecords(store)[0]?.body).toEqual({
    wins: 7,
    max: 9007199254740991,
    past: 9007199254740993n,
    huge: 9223372036854775807n,
    empty: '[Null]',
  })
})

test('ingest an atom-update log with cause ids and derived atomName', () => {
  const store = createStore()
  ingest(store, [atomUpdate.log])

  const records = listRecords(store)
  expect(records).toHaveLength(1)

  const record = records[0]!
  expect(record.kind).toBe('log')
  expect(record.eventName).toBe('reatom.atom.update')
  expect(record.causeIds).toEqual(atomUpdate.log.attributes['reatom.cause.ids'])
  expect(record.atomName).toBe(atomUpdate.log.attributes['reatom.name'])
  expect(record.reatomKind).toBe('atom')
  expect(record.frameId).toBe(atomUpdate.log.attributes['reatom.frame.id'])
  expect(record.traceId).toBe(atomUpdate.log.traceId)
  expect(record.spanId).toBe(atomUpdate.log.spanId)
  expect(record.body).toBe(true)
  expect(record.resource).toEqual(INSTANCE_RESOURCE)
})

test('indexes look up records by traceId, spanId, and frameId', () => {
  const store = createStore()
  ingest(store, [atomUpdate.span, atomUpdate.log])

  ADMIN_FRAME.run(() => {
    const byTrace = store.byTrace(atomUpdate.span.traceId) as AdminRecord[]
    expect(byTrace).toHaveLength(2)
    expect(byTrace.map((record) => record.kind).sort()).toEqual(['log', 'span'])

    const bySpan = store.bySpan(atomUpdate.span.spanId) as AdminRecord[]
    expect(bySpan).toHaveLength(2)

    const actionByFrame = store.byFrame('1') as AdminRecord[]
    expect(actionByFrame).toHaveLength(1)
    expect(actionByFrame[0]!.kind).toBe('span')
    expect(actionByFrame[0]!.reatomKind).toBe('action')

    const logByFrame = store.byFrame('2') as AdminRecord[]
    expect(logByFrame).toHaveLength(1)
    expect(logByFrame[0]!.kind).toBe('log')
    expect(logByFrame[0]!.atomName).toBe('tree.checked')
  })
})

test('clear empties the list and indexes', () => {
  let cleared = 0
  const store = createStore(() => {
    cleared += 1
  })
  ingest(store, [atomUpdate.span, atomUpdate.log])

  const held = listRecords(store)
  expect(held).toHaveLength(2)
  const heldFirst = held[0]

  ADMIN_FRAME.run(() => store.clear())

  expect(listRecords(store)).toEqual([])
  expect(cleared).toBe(1)
  ADMIN_FRAME.run(() => {
    expect(store.byTrace(atomUpdate.span.traceId)).toEqual([])
    expect(store.bySpan(atomUpdate.span.spanId)).toEqual([])
    expect(store.byFrame('1')).toEqual([])
    expect(store.byFrame('2')).toEqual([])
    expect(store.byAtom('tree.checked')).toEqual([])
    expect(store.byName(atomUpdate.span.name)).toEqual([])
    expect(store.records()).not.toContain(heldFirst)
  })
})

test('mixed records() batch preserves order, newest last', () => {
  const store = createStore()
  ingest(store, recordsSnapshot)

  const records = listRecords(store)
  expect(records).toHaveLength(3)

  expect(records[0]!.kind).toBe('span')
  expect(records[0]!.name).toBe('devtools.ping')
  expect(records[0]!.traceId).toBe(recordsSnapshot[0]!.traceId)
  expect(records[0]!.resource).toEqual(INSTANCE_RESOURCE)

  expect(records[1]!.kind).toBe('log')
  expect(records[1]!.eventName).toBe('reatom.atom.update')
  expect(records[1]!.atomName).toBe('tree.checked')
  expect(records[1]!.body).toBe(true)
  expect(records[1]!.resource).toEqual(INSTANCE_RESOURCE)

  expect(records[2]!.kind).toBe('span')
  expect(records[2]!.name).toBe('cart.total')
  expect(records[2]!.reatomKind).toBe('computed')
  expect(records[2]!.parentSpanId).toBe(recordsSnapshot[2]!.parentSpanId)
  expect(records[2]!.links).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        traceId: recordsSnapshot[2]!.links![0]!.traceId,
        spanId: recordsSnapshot[2]!.links![0]!.spanId,
        reason: 'computed.dependency',
      }),
    ]),
  )
  expect(records[2]!.resource).toEqual(INSTANCE_RESOURCE)
})

test('ingest does not require Reporter AdminFrame.pubIds', () => {
  expect(JSON.stringify(atomUpdate.log)).not.toContain('pubIds')
  expect(JSON.stringify(recordsSnapshot)).not.toContain('pubIds')

  const store = createStore()
  ingest(store, [atomUpdate.log, recordsSnapshot[1]])

  const records = listRecords(store)
  expect(records.length).toBeGreaterThan(0)
  for (const record of records) {
    expect(record).not.toHaveProperty('pubIds')
    expect(record.causeIds).toEqual(['1'])
    expect(record.kind).toBe('log')
    expect(record.body).toBe(true)
  }
})

test('indexes look up records by atomName and name', () => {
  const store = createStore()
  ingest(store, [atomUpdate.span, atomUpdate.log, successSpan])

  ADMIN_FRAME.run(() => {
    const checked = store.byAtom('tree.checked')
    expect(checked).toHaveLength(1)
    expect(checked[0]!.kind).toBe('log')
    expect(checked[0]!.eventName).toBe('reatom.atom.update')
    expect(checked[0]!.body).toBe(true)

    const toggle = store.byAtom(atomUpdate.span.attributes['reatom.name'])
    expect(toggle).toHaveLength(1)
    expect(toggle[0]!.kind).toBe('span')
    expect(toggle[0]!.name).toBe(atomUpdate.span.name)

    const byToggleName = store.byName(atomUpdate.span.name)
    expect(byToggleName).toHaveLength(1)
    expect(byToggleName[0]!.atomName).toBe(
      atomUpdate.span.attributes['reatom.name'],
    )

    const ping = store.byName(successSpan.name)
    expect(ping).toHaveLength(1)
    expect(ping[0]!.spanId).toBe(successSpan.spanId)
    expect(store.byAtom('devtools.ping')[0]!.spanId).toBe(successSpan.spanId)

    expect(store.byAtom('missing.atom')).toEqual([])
    expect(store.byName('missing.name')).toEqual([])
  })
})

test('stamps resource from the connected instance, not the sink item', () => {
  expect(successSpan).not.toHaveProperty('resource')
  expect(atomUpdate.log).not.toHaveProperty('resource')

  const store = createStore()
  ingest(store, [
    successSpan,
    atomUpdate.log,
    { ...successSpan, resource: { 'service.name': 'other-instance' } },
  ])

  const records = listRecords(store)
  expect(records).toHaveLength(3)
  for (const record of records) {
    expect(record.resource).toEqual(INSTANCE_RESOURCE)
    expect(record.resource).not.toEqual({ 'service.name': 'other-instance' })
    expect(record.resource['service.name']).toBe('reatom-admin-test')
    expect(record.resource['service.instance.id']).toBe('local')
    expect(record.resource['telemetry.sdk.name']).toBe('@reatom/opentelemetry')
    expect(record.resource['telemetry.sdk.language']).toBe('webjs')
    expect(record.resource['telemetry.sdk.version']).toBe('1000.15.2')
  }
})

test('joins an exception log to the action span with the same spanId', () => {
  const store = createStore()
  ingest(store, [exceptionJoin.log, exceptionJoin.span])

  const records = listRecords(store)
  expect(records).toHaveLength(2)

  const logRecord = records[0]!
  expect(logRecord.kind).toBe('log')
  expect(logRecord.eventName).toBe('exception')
  expect(logRecord.body).toBe('TypeError: boom')
  expect(logRecord.spanId).toBe(exceptionJoin.span.spanId)
  expect(logRecord.resource).toEqual(INSTANCE_RESOURCE)

  const spanRecord = records[1]!
  expect(spanRecord.kind).toBe('span')
  expect(spanRecord.name).toBe('explode')
  expect(spanRecord.reatomKind).toBe('action')
  expect(spanRecord.outcome).toBe('error')
  expect(spanRecord.start).toBe(
    unixNanoToMs(exceptionJoin.span.startTimeUnixNano),
  )
  expect(spanRecord.error).toEqual({
    type: 'TypeError',
    message: 'boom',
    stack: 'TypeError: boom\n    at explode',
  })
  expect(spanRecord.resource).toEqual(INSTANCE_RESOURCE)
  expect(logRecord.start).toBe(unixNanoToMs(exceptionJoin.log.timeUnixNano))
  expect(typeof logRecord.start).toBe('number')
  expect(typeof spanRecord.start).toBe('number')

  ADMIN_FRAME.run(() => {
    expect(store.bySpan(exceptionJoin.span.spanId)).toHaveLength(2)
    expect(store.byName('explode')).toHaveLength(1)
    expect(store.byName('exception')).toHaveLength(1)
    expect(store.byAtom('explode')[0]!.error).toEqual(spanRecord.error)
  })
})

test('joins an exception log onto a span ingested in an earlier batch', () => {
  const store = createStore()
  ingest(store, [exceptionJoin.span])
  ingest(store, [exceptionJoin.log])

  const records = listRecords(store)
  const spanRecord = records.find((record) => record.kind === 'span')
  expect(spanRecord?.error).toEqual({
    type: 'TypeError',
    message: 'boom',
    stack: 'TypeError: boom\n    at explode',
  })
})

test('joins an earlier exception log when the span arrives in a later batch', () => {
  const store = createStore()
  ingest(store, [exceptionJoin.log])
  ingest(store, [exceptionJoin.span])

  const records = listRecords(store)
  const spanRecord = records.find((record) => record.kind === 'span')
  expect(spanRecord?.error).toEqual({
    type: 'TypeError',
    message: 'boom',
    stack: 'TypeError: boom\n    at explode',
  })
})

test('two logs that share span and frame keep unique record ids', () => {
  const store = createStore()
  const shared = {
    traceId: exceptionJoin.log.traceId,
    spanId: exceptionJoin.log.spanId,
    timeUnixNano: exceptionJoin.log.timeUnixNano,
    attributes: {
      'reatom.frame.id': '1',
    },
  }

  ingest(store, [
    { ...shared, eventName: 'exception', body: 'TypeError: boom' },
    { ...shared, eventName: 'reatom.log', body: 'logged' },
  ])

  const records = listRecords(store)
  expect(records).toHaveLength(2)
  expect(records[0]!.id).not.toBe(records[1]!.id)
  expect(new Set(records.map((record) => record.id)).size).toBe(2)
  expect(records[0]!.id).toContain('exception')
  expect(records[1]!.id).toContain('reatom.log')
  expect(records[0]!.spanId).toBe(records[1]!.spanId)
  expect(records[0]!.frameId).toBe(records[1]!.frameId)
})

test('diamond computed span keeps cause ids and computed.dependency links', () => {
  const store = createStore()
  ingest(store, [recordsSnapshot[2]])

  const records = listRecords(store)
  expect(records).toHaveLength(1)
  const record = records[0]!
  expect(record.name).toBe(diamondLinks.diamond.name)
  expect(record.traceId).toBe(diamondLinks.diamond.traceId)
  expect(record.spanId).toBe(diamondLinks.diamond.spanId)
  expect(record.parentSpanId).toBe(diamondLinks.diamond.parentSpanId)
  expect(record.atomName).toBe(diamondLinks.diamond.attributes['reatom.name'])
  expect(record.reatomKind).toBe(diamondLinks.diamond.attributes['reatom.kind'])
  expect(record.frameId).toBe(
    diamondLinks.diamond.attributes['reatom.frame.id'],
  )
  expect(record.causeIds).toEqual(
    diamondLinks.diamond.attributes['reatom.cause.ids'],
  )
  expect(record.links).toEqual([
    {
      traceId: diamondLinks.links[0]!.traceId,
      spanId: diamondLinks.links[0]!.spanId,
      reason: diamondLinks.links[0]!.reason['reatom.link.reason'],
    },
  ])
  expect(record.resource).toEqual(INSTANCE_RESOURCE)
})

const liveLog = (spanId: string) => ({
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  spanId,
  eventName: 'reatom.atom.update',
  timeUnixNano: '1000000000000000',
  body: '***',
  attributes: {
    'reatom.name': `score.${spanId}`,
    'reatom.kind': 'atom',
    'reatom.frame.id': spanId,
    'reatom.params': '["***"]',
    'reatom.payload': '"***"',
  },
})

test('ingest attaches live values and JSON exports stay masked', () => {
  const secret = 'raw-secret-text'
  const raw = liveLog('live1')
  const values = {
    params: [secret],
    payload: { token: secret },
    state: { token: secret },
  }
  const store = ADMIN_FRAME.run(() =>
    reatomOtlpStore({
      sourceId: 'local',
      resource: INSTANCE_RESOURCE,
      localValues: (item) => (item === raw ? values : undefined),
    }),
  )
  ingest(store, [raw])
  const record = listRecords(store)[0]!
  expect(localValuesOf(record)).toBe(values)
  expect(record.attributes['reatom.payload']).toBe('"***"')
  expect(record.body).toBe('***')
  const exported = JSON.stringify(listRecords(store))
  expect(exported).toContain('***')
  expect(exported).not.toContain(secret)
  expect(Object.entries(record).join(' ')).not.toContain(secret)

  const held = record
  ingest(store, [held])
  const copy = listRecords(store)[1]!
  expect(copy).not.toBe(held)
  expect(copy[LOCAL_VALUES]).toBe(values)
})

test('local values limit drops the oldest and clear resets the flag', () => {
  const raws = [liveLog('a'), liveLog('b'), liveLog('c')]
  const secrets = raws.map((raw, index) => ({
    raw,
    values: { payload: `secret-${index}` },
  }))
  const store = ADMIN_FRAME.run(() =>
    reatomOtlpStore({
      sourceId: 'local',
      resource: INSTANCE_RESOURCE,
      localValuesLimit: 2,
      localValues: (item) =>
        secrets.find((entry) => entry.raw === item)?.values,
    }),
  )
  ingest(store, raws)
  const records = listRecords(store)
  expect(localValuesOf(records[0]!)).toBeUndefined()
  expect(localValuesOf(records[1]!)?.payload).toBe('secret-1')
  expect(localValuesOf(records[2]!)?.payload).toBe('secret-2')
  expect(ADMIN_FRAME.run(() => store.localValuesTrimmed())).toBe(true)
  expect(JSON.stringify(records)).not.toContain('secret-')

  const snapshot = records.slice()
  ADMIN_FRAME.run(() => store.clear())
  expect(listRecords(store)).toEqual([])
  expect(ADMIN_FRAME.run(() => store.localValuesTrimmed())).toBe(false)
  expect(localValuesOf(snapshot[1]!)).toBe(secrets[1]!.values)

  ADMIN_FRAME.run(() => store.restoreRecords(snapshot))
  const restored = listRecords(store)
  expect(localValuesOf(restored[1]!)).toBe(secrets[1]!.values)
  expect(localValuesOf(restored[2]!)).toBe(secrets[2]!.values)
  expect(localValuesOf(restored[0]!)).toBeUndefined()
})

test('setLocalValues changes which later records attach', () => {
  const store = createStore()
  const first = liveLog('later')
  const values = { state: { token: 'attached-later' } }
  ingest(store, [first])
  expect(localValuesOf(listRecords(store)[0]!)).toBeUndefined()
  ADMIN_FRAME.run(() => {
    store.setLocalValues((item) => (item === first ? values : undefined))
  })
  ingest(store, [first])
  expect(localValuesOf(listRecords(store)[1]!)).toBe(values)
  ADMIN_FRAME.run(() => store.setLocalValues(undefined))
  ingest(store, [first])
  expect(localValuesOf(listRecords(store)[2]!)).toBeUndefined()
  expect(localValuesOf(listRecords(store)[1]!)).toBe(values)
})

test('live error and payload stay on the symbol and out of record.error', () => {
  const traceId = 'cccccccccccccccccccccccccccccccc'
  const spanId = 'dddddddddddddddd'
  const span = {
    traceId,
    spanId,
    name: 'explode',
    startTimeUnixNano: '1000000000000000',
    endTimeUnixNano: '1000000001000000',
    attributes: {
      'reatom.name': 'explode',
      'reatom.kind': 'action',
      'reatom.frame.id': '1',
    },
  }
  const log = {
    traceId,
    spanId,
    eventName: 'exception',
    timeUnixNano: '1000000000500000',
    attributes: {
      'exception.type': '***',
      'exception.message': '***',
      'exception.stacktrace': '***',
      'reatom.frame.id': '1',
    },
  }
  const live = new Error('full boom')
  live.name = 'CustomBoom'
  live.stack = 'CustomBoom: full boom\n    at secretFrame'
  const failure = {
    traceId,
    spanId: 'eeeeeeeeeeeeeeee',
    eventName: 'reatom.atom.update',
    timeUnixNano: '1000000000000000',
    body: '***',
    attributes: {
      'reatom.name': 'features.errors.card.title',
      'reatom.kind': 'atom',
      'reatom.frame.id': '4',
      'reatom.payload': '"***"',
    },
  }
  const store = ADMIN_FRAME.run(() =>
    reatomOtlpStore({
      sourceId: 'local',
      resource: INSTANCE_RESOURCE,
      localValues: (item) => {
        if (item === log) return { error: live }
        if (item === failure) return { payload: 'visible failure' }
        return undefined
      },
    }),
  )
  ingest(store, [span, log, failure])
  const records = listRecords(store)
  expect(records.find((record) => record.kind === 'span')?.error).toEqual({
    type: '***',
    message: '***',
    stack: '***',
  })
  const exceptionLog = records.find((record) => record.eventName === 'exception')
  expect(exceptionLog && recordValues(exceptionLog).error).toBe(live)
  const card = records.find((record) => record.atomName?.endsWith('.title'))
  expect(card?.error).toEqual({ message: '***', type: 'error-card' })
  expect(card && recordValues(card).payload).toBe('visible failure')
  const exported = JSON.stringify(records)
  expect(exported).not.toContain('full boom')
  expect(exported).not.toContain('secretFrame')
  expect(exported).not.toContain('visible failure')
})
