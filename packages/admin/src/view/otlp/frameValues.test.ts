import { expect, test } from 'test'

import { LOCAL_VALUES, type AdminRecord } from '../../otlp'
import {
  eventOverviewError,
  frameValueView,
  overviewDataTitle,
  overviewDataValue,
  overviewEventSections,
  overviewParamsValue,
  recordFieldValue,
} from './frameValues'

function record(patch: Partial<AdminRecord>): AdminRecord {
  return {
    id: 'record',
    sourceId: 'local',
    kind: 'log',
    traceId: 'trace',
    spanId: 'span',
    name: 'board',
    start: 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

const stateRecord = (body: unknown, attributes: Record<string, unknown> = {}) =>
  record({
    atomName: 'board',
    eventName: 'reatom.atom.update',
    reatomKind: 'atom',
    body,
    attributes,
  })

test('overview keeps state or payload apart from params', () => {
  const action = record({
    kind: 'span',
    reatomKind: 'action',
    atomName: 'makeMove',
    name: 'makeMove',
    attributes: {
      'reatom.payload': '{"ok":true}',
      'reatom.params': '[0]',
    },
  })
  expect(overviewDataTitle(action)).toBe('Payload')
  expect(overviewDataValue(action)).toEqual({ ok: true })
  expect(frameValueView(overviewDataValue(action))).toBe('inspector')
  expect(overviewParamsValue(action)).toEqual([0])
  expect(frameValueView(overviewParamsValue(action))).toBe('inspector')

  const next = stateRecord(['X'], {
    'reatom.payload': '"pong"',
    'reatom.params': '[1]',
  })
  expect(overviewDataTitle(next)).toBe('State')
  expect(overviewDataValue(next)).toEqual(['X'])
  expect(frameValueView(overviewDataValue(next))).toBe('inspector')
  expect(overviewParamsValue(next)).toEqual([1])
  expect(overviewDataValue(record({ name: 'ping' }))).toBeUndefined()
  expect(overviewParamsValue(record({ name: 'ping' }))).toBeUndefined()
  expect(frameValueView(undefined)).toBe('empty')
  expect(frameValueView('[Null]')).toBe('text')
  expect(recordFieldValue(stateRecord('[Null]'))).toBe('[Null]')
})

test('overview and field values prefer live values over masked attributes', () => {
  const secret = { token: 'live-token' }
  const nextState = new Map([['token', 'live-state']])
  const action = record({
    kind: 'span',
    name: 'auth.init',
    reatomKind: 'action',
    attributes: {
      'reatom.params': '"[redacted]"',
      'reatom.payload': '"[redacted]"',
    },
    [LOCAL_VALUES]: { params: [secret], payload: 'live-payload' },
  })
  expect(overviewParamsValue(action)).toEqual([secret])
  expect(overviewDataValue(action)).toBe('live-payload')
  expect(recordFieldValue(action)).toBe('live-payload')

  const write = stateRecord('[redacted]')
  write[LOCAL_VALUES] = { state: nextState, params: [] }
  expect(overviewDataValue(write)).toBe(nextState)
  expect(recordFieldValue(write)).toBe(nextState)
  expect(JSON.stringify(action)).not.toContain('live-token')
})

test('event overview groups attributes, formats durations, and sorts leftover keys', () => {
  const pageView = record({
    eventName: 'app.page_view',
    attributes: {
      'event.name': 'app.page_view',
      'url.path': '/cart',
      'session.id': 's1',
      'app.utm.source': 'google',
    },
  })
  expect(overviewEventSections(pageView)).toEqual([
    {
      title: 'Page',
      entries: [{ key: 'url.path', value: '/cart', display: '/cart' }],
    },
    {
      title: 'Attribution',
      entries: [
        { key: 'app.utm.source', value: 'google', display: 'google' },
      ],
    },
    {
      title: 'Identity',
      entries: [{ key: 'session.id', value: 's1', display: 's1' }],
    },
  ])

  const engagement = record({
    eventName: 'app.page.engagement',
    attributes: {
      'event.name': 'app.page.engagement',
      'app.engagement.visible_ms': 3800,
      'app.engagement.active_ms': '2500',
      'custom.note': 'hello',
      'zz.extra': 1,
    },
  })
  expect(overviewEventSections(engagement)).toEqual([
    {
      title: 'Metrics',
      entries: [
        {
          key: 'app.engagement.visible_ms',
          value: 3800,
          display: '3.8s',
          title: '3800',
        },
        {
          key: 'app.engagement.active_ms',
          value: '2500',
          display: '2.5s',
          title: '2500',
        },
      ],
    },
    {
      title: 'Other',
      entries: [
        { key: 'custom.note', value: 'hello', display: 'hello' },
        { key: 'zz.extra', value: 1, display: '1' },
      ],
    },
  ])

  const exception = record({
    eventName: 'exception',
    attributes: {
      'event.name': 'exception',
      'exception.type': 'TypeError',
      'app.exception.count': 3,
    },
  })
  expect(overviewEventSections(exception)).toEqual([
    {
      title: 'Exception',
      entries: [
        {
          key: 'exception.type',
          value: 'TypeError',
          display: 'TypeError',
        },
        {
          key: 'app.exception.count',
          value: 3,
          display: '3',
        },
      ],
    },
  ])
})

test('event overview labels analytics exceptions and groups leftover keys', () => {
  expect(
    eventOverviewError(
      record({
        eventName: 'exception',
        attributes: {
          'exception.type': 'TypeError',
          'exception.message': 'boom',
        },
      }),
    ),
  ).toBe('TypeError: boom')
  expect(
    eventOverviewError(
      record({
        eventName: 'exception.suppressed',
        attributes: { 'exception.type': 'TypeError' },
      }),
    ),
  ).toBe('TypeError')
  expect(
    eventOverviewError(
      record({ eventName: 'app.page_view', attributes: { 'url.path': '/' } }),
    ),
  ).toBeUndefined()
  expect(
    overviewEventSections(
      record({
        eventName: 'checkout.clicked',
        attributes: { 'event.name': 'checkout.clicked' },
      }),
    ),
  ).toEqual([])

  const mixed = record({
    eventName: 'checkout.failed',
    attributes: {
      'event.name': 'checkout.failed',
      'user.id': 'u1',
      'browser.web_vital.name': 'LCP',
      'browser.language': 'en',
      'app.engagement.visible_ms': ' ',
    },
  })
  expect(overviewEventSections(mixed)).toEqual([
    {
      title: 'Metrics',
      entries: [
        {
          key: 'browser.web_vital.name',
          value: 'LCP',
          display: 'LCP',
        },
        {
          key: 'app.engagement.visible_ms',
          value: ' ',
          display: ' ',
        },
      ],
    },
    {
      title: 'Identity',
      entries: [{ key: 'user.id', value: 'u1', display: 'u1' }],
    },
    {
      title: 'Other',
      entries: [
        {
          key: 'browser.language',
          value: 'en',
          display: 'en',
        },
      ],
    },
  ])
})
