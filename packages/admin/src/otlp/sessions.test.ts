import { expect, test } from 'test'
import { atom } from '@reatom/core'
import { ADMIN_FRAME } from '../root'
import type { AdminRecord } from './ingest'
import { investigationSessions, journeySignal } from './sessions'
import { reatomInvestigationSessions } from './sessionsModel'
const record = (
  id: string,
  options: Partial<AdminRecord> = {},
): AdminRecord => ({
  id,
  sourceId: 'local',
  kind: 'log',
  traceId: 'trace',
  spanId: id,
  name: id,
  start: 0,
  attributes: {},
  resource: { 'service.name': 'web' },
  links: [],
  causeIds: [],
  ...options,
})

test('explicit ownership without page views and unambiguous traces retain every captured signal', () => {
  const records = [
    record('end', { start: 30, kind: 'span', end: 50 }),
    record('owner', { start: 10, attributes: { 'session.id': 's1' } }),
    record('error', { start: 20, outcome: 'error' }),
  ]
  const sessions = investigationSessions(records)
  expect(sessions.length).toBe(1)
  expect(sessions[0]).toMatchObject({
    sessionId: 's1',
    start: 10,
    end: 50,
    pages: 0,
    errors: 1,
  })
  expect(sessions[0]!.records.map((item) => item.id)).toEqual([
    'owner',
    'error',
    'end',
  ])
})
test('ambiguous traces stay diagnostic while direct session ownership wins', () => {
  const sessions = investigationSessions([
    record('one', { attributes: { 'session.id': 's1' } }),
    record('two', { attributes: { 'session.id': 's2' } }),
    record('anonymous'),
  ])
  expect(sessions.length).toBe(3)
  expect(
    sessions
      .find((session) => session.sessionId === undefined)!
      .records.map((item) => item.id),
  ).toEqual(['anonymous'])
})
test('source, service, instance and resource boundaries prevent collisions; resource key order does not', () => {
  const sessions = investigationSessions([
    record('one', {
      attributes: { 'session.id': 's' },
      resource: { 'service.name': 'web', 'service.instance.id': 'a' },
    }),
    record('same', {
      resource: { 'service.instance.id': 'a', 'service.name': 'web' },
    }),
    record('source', { sourceId: 'remote' }),
    record('service', { resource: { 'service.name': 'api' } }),
    record('instance', {
      resource: { 'service.name': 'web', 'service.instance.id': 'b' },
    }),
  ])
  expect(sessions.length).toBe(4)
  expect(
    sessions.find((session) => session.sessionId === 's')!.records.length,
  ).toBe(2)
})
test('only actual page views count; suppression is not an invented error', () => {
  const session = investigationSessions([
    record('page', {
      eventName: 'app.page_view',
      attributes: { 'url.path': '/first' },
    }),
    record('suppressed', {
      eventName: 'exception.suppressed',
      attributes: { count: 100 },
    }),
    record('page-two', {
      start: 20,
      eventName: 'app.page_view',
      attributes: { 'url.path': '/last' },
    }),
  ])[0]!
  expect(session).toMatchObject({
    pages: 2,
    errors: 0,
    entry: '/first',
    last: '/last',
  })
})
test('measurement uses captured numeric map and ordinary logs remain logs', () => {
  expect(
    journeySignal(
      record('valid', {
        eventName: 'measurement',
        attributes: {
          'measurement.type': 'vitals',
          'measurement.values': { LCP: 300 },
        },
      }),
    ),
  ).toBe('measurements')
  expect(
    journeySignal(
      record('invalid', {
        eventName: 'measurement',
        attributes: {
          'measurement.type': 'vitals',
          'measurement.values': { LCP: '300' },
        },
      }),
    ),
  ).toBe('logs')
})
test('session filtering retains full journey context, pagination clamps and clear cannot leave stale detail', () =>
  ADMIN_FRAME.run(() => {
    const records = atom(
      [
        record('owner', { attributes: { 'session.id': 's' } }),
        record('failure', { outcome: 'error' }),
      ],
      'sessionTest.records',
    )
    const model = reatomInvestigationSessions(records, 'sessionTest')
    model.search.set('failure')
    model.errorsOnly.set(true)
    expect(model.rows().length).toBe(1)
    model.selectedId.set(model.rows()[0]!.id)
    expect(model.journey().length).toBe(2)
    model.signal.set('errors')
    expect(model.journey().length).toBe(1)
    model.listPageChoice.set(10)
    expect(model.listPage()).toBe(0)
    records.set([])
    expect(model.selected()).toBeNull()
    expect(model.rows().length).toBe(0)
  }))

test('resource session IDs identify sessions and direct attributes take precedence', () => {
  const sessions = investigationSessions([
    record('resource', {
      resource: { 'service.name': 'web', 'session.id': 'resource-session' },
    }),
    record('direct', {
      attributes: { 'session.id': 'attribute-session' },
      resource: { 'service.name': 'web', 'session.id': 'resource-session' },
    }),
  ])
  expect(sessions.map((session) => session.sessionId).sort()).toEqual([
    'attribute-session',
    'resource-session',
  ])
})

test('replayed record resource boundaries survive ingestion', async () => {
  const { reatomOtlpAdmin } = await import('./chrome')
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({
      sourceId: 'local',
      resource: { 'service.name': 'default' },
    })
    admin.ingest(
      ['one', 'two'].map((instance) =>
        record(instance, {
          resource: { 'service.name': 'web', 'service.instance.id': instance },
        }),
      ),
    )
    expect(admin.investigation.sessions().length).toBe(2)
    expect(
      admin.store
        .records()
        .map((record) => record.resource['service.instance.id']),
    ).toEqual(['one', 'two'])
  })
})

test('scope derives exact live record membership and high volume filters reset/clamp pagination', () =>
  ADMIN_FRAME.run(() => {
    const records = atom(
      Array.from({ length: 205 }, (_, index) =>
        record(String(index), {
          start: index,
          attributes: { 'session.id': `s${index}` },
        }),
      ),
      'largeSessionTest.records',
    )
    const model = reatomInvestigationSessions(records, 'largeSessionTest')
    model.listPageChoice.set(2)
    expect(model.listPage()).toBe(2)
    model.search.set('s0')
    expect(model.listPage()).toBe(0)
    expect(model.rows().length).toBe(1)
    model.scopeSessionId.set(model.rows()[0]!.id)
    expect(model.scopeIds()!.size).toBe(1)
    records.set([
      ...records(),
      record('late', { attributes: { 'session.id': 's0' } }),
    ])
    expect([...model.scopeIds()!].sort()).toEqual(['0', 'late'])
    model.search.set('')
    model.listPageChoice.set(2)
    records.set(records().slice(0, 2))
    expect(model.listPage()).toBe(0)
  }))

test('legacy analytics scopes replace exact investigation scopes', async () => {
  const { reatomOtlpAdmin } = await import('./chrome')
  const { shopOtlpLogs } = await import('./fixtures/analyticsRecords')
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    admin.ingest(shopOtlpLogs())
    admin.investigation.scopeSessionId.set(
      admin.investigation
        .sessions()
        .find((session) => session.sessionId === 's8')!.id,
    )
    admin.showSessions('s1', new Set(['s1']))
    expect(admin.investigation.scopeIds()).toBeNull()
    expect(admin.visibleRecords().length).toBeGreaterThan(0)
    expect(admin.visibleRecords().every(admin.analytics.recordInScope()!)).toBe(
      true,
    )
  })
})

test('replay exception logs use the same global error classification as sessions', async () => {
  const { reatomOtlpAdmin } = await import('./chrome')
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    admin.ingest([
      record('legacy-error', {
        eventName: 'exception',
        attributes: { 'exception.message': 'Legacy replay failure' },
      }),
    ])
    expect(admin.investigation.sessions()[0]!.errors).toBe(1)
    expect(admin.recordCounts().errors).toBe(1)
    expect(admin.store.records()[0]!.error?.message).toBe(
      'Legacy replay failure',
    )
  })
})

test('filtered journeys publish late exception changes to an existing span', async () => {
  const { reatomOtlpAdmin } = await import('./chrome')
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    admin.ingest([
      {
        traceId: 'late-error',
        spanId: 'span-1',
        name: 'request',
        startTimeUnixNano: '1000000000',
        attributes: { 'session.id': 'late-session' },
      },
    ])
    admin.investigation.selectedId.set(admin.investigation.sessions()[0]!.id)
    admin.investigation.journeySearch.set('request')
    const before = admin.investigation.journey()
    admin.ingest([
      {
        traceId: 'late-error',
        spanId: 'span-1',
        eventName: 'exception',
        timeUnixNano: '2000000000',
        attributes: { 'exception.message': 'failed' },
      },
    ])
    expect(admin.investigation.journey().length).toBe(1)
    expect(admin.investigation.journey()[0]!.error?.message).toBe('failed')
    expect(admin.investigation.journey() === before).toBe(false)
  })
})

test('journey content revisions publish in-place end, outcome and attribute updates', () =>
  ADMIN_FRAME.run(() => {
    const span = record('request', {
      kind: 'span',
      attributes: { 'session.id': 'session' },
    })
    const records = atom([span], 'revisionTest.records')
    const changes = atom<{
      revision: number
      records: AdminRecord[]
      revisionOf: (record: AdminRecord) => number
    }>(
      { revision: 0, records: [], revisionOf: () => 0 },
      'revisionTest.changes',
    )
    const model = reatomInvestigationSessions(records, 'revisionTest', changes)
    model.selectedId.set(model.sessions()[0]!.id)
    const before = model.journey()
    span.end = 300
    span.outcome = 'ok'
    span.attributes['updated'] = 'captured'
    changes.set({ revision: 1, records: [span], revisionOf: () => 1 })
    expect(model.journey() === before).toBe(false)
    expect(model.journey()[0]).toMatchObject({
      end: 300,
      outcome: 'ok',
      attributes: { updated: 'captured' },
    })
  }))

test('coalesced ingests retain visible record revisions when a later batch touches another session', async () => {
  const { reatomOtlpAdmin } = await import('./chrome')
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    admin.ingest([
      {
        traceId: 'trace-a',
        spanId: 'span-a',
        name: 'request',
        startTimeUnixNano: '1000000000',
        attributes: { 'session.id': 'a' },
      },
      {
        traceId: 'trace-b',
        spanId: 'span-b',
        name: 'background',
        startTimeUnixNano: '1000000000',
        attributes: { 'session.id': 'b' },
      },
    ])
    admin.investigation.selectedId.set(
      admin.investigation
        .sessions()
        .find((session) => session.sessionId === 'a')!.id,
    )
    admin.investigation.journeySearch.set('request')
    const before = admin.investigation.journey()
    // Do not read the journey between these ingests: a consumer may only see
    // the last invalidation while the earlier mutation must remain observable.
    admin.ingest([
      {
        traceId: 'trace-a',
        spanId: 'span-a',
        eventName: 'exception',
        timeUnixNano: '2000000000',
        attributes: { 'exception.message': 'failed' },
      },
    ])
    admin.ingest([
      {
        traceId: 'trace-b',
        spanId: 'span-b',
        eventName: 'exception',
        timeUnixNano: '2000000000',
        attributes: { 'exception.message': 'background failed' },
      },
    ])
    expect(admin.investigation.journey() === before).toBe(false)
    expect(admin.investigation.journey().length).toBe(1)
    expect(admin.investigation.journey()[0]!.error?.message).toBe('failed')
  })
})

test('store record revisions survive clear/restore and start fresh for replacement copies', async () => {
  const { reatomOtlpAdmin } = await import('./chrome')
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    const span = {
      traceId: 'revision-trace',
      spanId: 'span-a',
      name: 'request',
      startTimeUnixNano: '1000000000',
      attributes: { 'session.id': 'session' },
    }
    const exception = {
      traceId: 'revision-trace',
      spanId: 'span-a',
      eventName: 'exception',
      timeUnixNano: '2000000000',
      attributes: { 'exception.message': 'failed' },
    }
    admin.ingest([span])
    const original = admin.store.records()[0]!
    const revisionOf = admin.store.contentChanges().revisionOf
    expect(revisionOf(original)).toBe(0)
    admin.ingest([exception])
    expect(revisionOf(original)).toBe(1)
    admin.clear()
    expect(admin.investigation.selected()).toBeNull()
    admin.store.restoreRecords([original])
    expect(revisionOf(original)).toBe(1)
    admin.store.replace([span])
    const replacement = admin.store.records()[0]!
    expect(replacement === original).toBe(false)
    expect(revisionOf(replacement)).toBe(0)
    admin.ingest([exception])
    expect(revisionOf(replacement)).toBe(1)
    expect(revisionOf(original)).toBe(1)
  })
})
