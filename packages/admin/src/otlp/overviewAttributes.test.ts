import { expect, test } from 'test'

import { LOCAL_VALUES, type AdminRecord } from './ingest.ts'
import {
  filterByValueDraft,
  groupedOverviewAttributes,
  isMaskedOtlpValue,
  nameSegments,
} from './overviewAttributes.ts'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: 'r',
    sourceId: 'local',
    kind: 'span',
    traceId: 'trace',
    spanId: 'span',
    name: 'todo.list.filter',
    start: 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('nameSegments draft a prefix glob without applying', () => {
  expect(nameSegments('todo.list.filter')).toEqual([
    { label: 'todo', draft: 'name:todo*' },
    { label: 'list', draft: 'name:todo.list*' },
    { label: 'filter', draft: 'name:todo.list.filter*' },
  ])
})

test('grouped attributes hide params and collapse resource prefixes', () => {
  const groups = groupedOverviewAttributes(
    record({
      attributes: {
        'reatom.params': '[1]',
        'reatom.payload': '"x"',
        'reatom.kind': 'action',
        'app.page': '/cart',
        'exception.type': 'Error',
        'http.method': 'GET',
      },
      resource: {
        'service.name': 'shop',
        'deployment.environment': 'dev',
        'host.name': 'local',
      },
    }),
    '',
  )
  expect(groups.map((group) => group.id)).toEqual([
    'reatom',
    'app',
    'exception',
    'other',
    'service',
    'deployment',
    'resource',
  ])
  expect(groups.find((group) => group.id === 'reatom')?.entries.map((entry) => entry.key)).toEqual([
    'reatom.kind',
  ])
  expect(groups.find((group) => group.id === 'service')?.collapsed).toBe(true)
  expect(groups.find((group) => group.id === 'deployment')?.collapsed).toBe(true)
  expect(groups.find((group) => group.id === 'resource')?.collapsed).toBe(true)

  const searched = groupedOverviewAttributes(
    record({
      attributes: { 'reatom.kind': 'action', 'app.page': '/cart' },
    }),
    'kind',
  )
  expect(searched.map((group) => group.id)).toEqual(['reatom'])
})

test('masked caption is only for attribute-backed values', () => {
  const masked = record({
    attributes: { 'reatom.payload': '"***"' },
    body: '***',
  })
  expect(isMaskedOtlpValue(masked, 'payload')).toBe(true)
  expect(isMaskedOtlpValue(masked, 'state')).toBe(true)
  const live = record({
    attributes: { 'reatom.payload': '"***"' },
    body: '***',
    [LOCAL_VALUES]: { payload: { ok: true }, state: 1 },
  })
  expect(isMaskedOtlpValue(live, 'payload')).toBe(false)
  expect(filterByValueDraft('url.path', '/cart')).toBe('attr.url.path="/cart"')
})
