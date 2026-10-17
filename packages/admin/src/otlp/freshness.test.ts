import { expect, test } from 'test'

import type { AdminRecord } from './ingest.ts'
import {
  attentionItems,
  formatRecordAge,
  freshnessLabel,
  latestRecordTime,
  loadedRecordWindow,
} from './freshness.ts'

const span = (start: number, end: number, kind: AdminRecord['kind'] = 'span') =>
  ({ kind, start, end }) as AdminRecord

test('formatRecordAge ticks in whole seconds', () => {
  expect(formatRecordAge(2_000, 2_000)).toBe('just now')
  expect(formatRecordAge(4_200, 2_000)).toBe('2s ago')
  expect(formatRecordAge(125_000, 2_000)).toBe('2m ago')
})

test('freshnessLabel names live, paused, and ClickHouse windows', () => {
  expect(
    freshnessLabel({
      source: 'live',
      paused: false,
      waiting: 0,
      now: 5_000,
      records: [span(1_000, 3_000)],
    }),
  ).toBe('Capturing · last record 2s ago')
  expect(
    freshnessLabel({
      source: 'live',
      paused: true,
      waiting: 4,
      now: 5_000,
      records: [],
    }),
  ).toBe('Paused · 4 waiting')
  const remote = freshnessLabel({
    source: 'remote',
    paused: false,
    waiting: 0,
    now: 5_000,
    records: [span(0, 0), span(0, 0, 'log')],
  })
  expect(remote.startsWith('ClickHouse · loaded ')).toBe(true)
  expect(remote.endsWith(' · 1 spans · 1 logs')).toBe(true)
})

test('loadedRecordWindow skips empty captures and counts kinds', () => {
  expect(loadedRecordWindow([])).toBeUndefined()
  expect(latestRecordTime([span(10, 20), span(5, 8)])).toBe(20)
  expect(
    loadedRecordWindow([span(10, 20), span(5, 8, 'log')]),
  ).toEqual({ start: 5, end: 20, spans: 1, logs: 1 })
})

test('attentionItems omit empty rows', () => {
  expect(
    attentionItems({
      olderRecordsDropped: false,
      localValuesTrimmed: false,
      transportQuarantined: false,
      inProgressCount: 0,
      analyticsSessions: 0,
    }),
  ).toEqual([])
  expect(
    attentionItems({
      olderRecordsDropped: true,
      localValuesTrimmed: true,
      transportQuarantined: false,
      inProgressCount: 1,
      analyticsSessions: 3,
    }).map((item) => item.id),
  ).toEqual(['dropped', 'trimmed', 'in-progress', 'shares'])
})
