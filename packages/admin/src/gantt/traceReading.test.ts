import { expect, test } from 'test'

import { LOCAL_VALUES, type AdminRecord } from '../otlp/ingest'
import { durationThresholdMs, isSlowDuration } from '../otlp/calculator'
import { errorGroupKey } from '../otlp/ingest'
import { collideAxisMarkers, sessionAxisMarkers } from './axisMarkers'
import { isQuietSpan, barLabelFitsInside, barLabelText } from './barLabel'
import { isUpdateLog, recordBarMark, colorByChoices, legendKinds } from './barMark'
import { foldLogRows, logGroupOf } from './logGroups'
import { recordRowChips, rowChipDraft, visibleRowChips } from './rowChips'
import { timeStripModel } from './timeStrip'
import { isRootSpan, sectionStickyTop, turnHairlineText, turnSection } from './turns'
import { collapsedWriteTicks } from './writeTicks'
import { formatWritePreview } from './writePreview'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: patch.id ?? 'row',
    sourceId: 'local',
    kind: 'span',
    traceId: 'trace',
    spanId: 'span',
    name: 'makeMove',
    start: 0,
    end: 40,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('recordBarMark uses hollow computed, filled actions, and hatch pending', () => {
  expect(recordBarMark(record({ reatomKind: 'action' }))).toBe('filled')
  expect(recordBarMark(record({ reatomKind: 'effect' }))).toBe('filled')
  expect(recordBarMark(record({ reatomKind: 'route' }))).toBe('filled')
  expect(recordBarMark(record({ reatomKind: 'computed' }))).toBe('hollow')
  expect(
    recordBarMark(record({ id: 'in-progress:local:t:s', outcome: 'pending' })),
  ).toBe('hatch')
  expect(recordBarMark(record({ outcome: 'pending' }))).toBe('hatch')
})

test('Service color-by is absent until a second sourceId appears', () => {
  const one = [record(), record({ id: 'b', reatomKind: 'atom' })]
  expect(colorByChoices(one).map((choice) => choice.value)).toEqual([
    'kind',
    'outcome',
  ])
  const two = [...one, record({ id: 'c', sourceId: 'clickhouse' })]
  expect(colorByChoices(two).map((choice) => choice.value)).toEqual([
    'kind',
    'outcome',
    'service',
  ])
  expect(legendKinds(one)).toEqual(['action', 'atom'])
})

test('collapsedWriteTicks hide when expanded and skip in-progress parents', () => {
  const parent = record({ id: 'parent', spanId: 'p' })
  const write = record({
    id: 'write',
    kind: 'log',
    spanId: 'p',
    eventName: 'reatom.atom.update',
    reatomKind: 'atom',
    start: 10,
    end: undefined,
  })
  const mount = record({
    id: 'mount',
    kind: 'log',
    spanId: 'p',
    eventName: 'reatom.action.call',
    start: 12,
    end: undefined,
  })
  expect(isUpdateLog(write)).toBe(true)
  expect(collapsedWriteTicks(parent, [write, mount], false)).toEqual([
    { record: write, start: 10 },
  ])
  expect(collapsedWriteTicks(parent, [write], true)).toEqual([])
  expect(
    collapsedWriteTicks(
      record({ id: 'in-progress:local:t:s', outcome: 'pending' }),
      [write],
      false,
    ),
  ).toEqual([])
})

test('bar labels sit inside wide bars and quiet sub-1% spans', () => {
  expect(barLabelText('checkout', '40ms')).toBe('checkout · 40ms')
  expect(barLabelFitsInside('checkout · 40ms', 0.5, 400)).toBe(true)
  expect(barLabelFitsInside('checkout · 40ms', 0.02, 400)).toBe(false)
  expect(isQuietSpan(2, 400)).toBe(true)
  expect(isQuietSpan(20, 400)).toBe(false)
})

test('formatWritePreview shows prev → next, object keys, and masked', () => {
  const previous = record({
    id: 'prev',
    kind: 'log',
    atomName: 'form.email',
    eventName: 'reatom.atom.update',
    name: 'form.email',
    [LOCAL_VALUES]: { state: 'bad' },
  })
  const next = record({
    id: 'next',
    kind: 'log',
    atomName: 'form.email',
    eventName: 'reatom.atom.update',
    name: 'form.email',
    [LOCAL_VALUES]: { state: 'bad@' },
  })
  expect(formatWritePreview(next, [previous, next])).toEqual({
    name: 'form.email',
    text: '"bad" → "bad@"',
  })

  const objectPrev = record({
    id: 'op',
    kind: 'log',
    atomName: 'form',
    name: 'form',
    eventName: 'reatom.atom.update',
    [LOCAL_VALUES]: { state: { a: 1, b: 2 } },
  })
  const objectNext = record({
    id: 'on',
    kind: 'log',
    atomName: 'form',
    name: 'form',
    eventName: 'reatom.atom.update',
    [LOCAL_VALUES]: { state: { a: 1, c: 3, d: 4 } },
  })
  const objectPreview = formatWritePreview(objectNext, [objectPrev, objectNext])
  expect(objectPreview?.text).toBe('+2 −1')
  expect(objectPreview?.title).toContain('c')

  const masked = record({
    id: 'masked',
    kind: 'log',
    atomName: 'secret',
    name: 'secret',
    eventName: 'reatom.atom.update',
    body: '***',
  })
  expect(formatWritePreview(masked, [masked])).toEqual({
    name: 'secret',
    text: 'masked',
  })
})

test('durationThresholdMs reads duration>X and isSlowDuration uses p95', () => {
  expect(durationThresholdMs('kind:action duration>16ms')).toBe(16)
  expect(durationThresholdMs('duration>=1s')).toBe(1000)
  expect(durationThresholdMs('name:x')).toBeUndefined()
  expect(isSlowDuration(20, 18, undefined)).toBe(true)
  expect(isSlowDuration(10, 18, undefined)).toBe(false)
  expect(isSlowDuration(16, undefined, 16)).toBe(true)
})

test('foldLogRows collapses consecutive repeats and groups errors by errorGroupKey', () => {
  const lines = Array.from({ length: 30 }, (_, index) =>
    record({
      id: `poll-${index}`,
      kind: 'log',
      name: 'pollAtom',
      reatomKind: 'atom',
      eventName: 'reatom.atom.update',
      start: index,
      end: undefined,
    }),
  )
  const folded = foldLogRows(lines, {
    expandedKeys: new Set(),
    errorsOn: false,
    hiddenMountCount: 0,
    hiddenAbortCount: 0,
  })
  expect(folded).toHaveLength(1)
  expect(logGroupOf(folded[0]!)?.count).toBe(30)

  const expanded = foldLogRows(lines, {
    expandedKeys: new Set([logGroupOf(folded[0]!)!.key]),
    errorsOn: false,
    hiddenMountCount: 0,
    hiddenAbortCount: 0,
  })
  expect(expanded).toHaveLength(30)
})

test('error groups share the MC-03 key even when not consecutive', () => {
  const first = record({
    id: 'e1',
    name: 'checkout',
    outcome: 'error',
    error: { type: 'TypeError', message: 'fail' },
    start: 0,
  })
  const other = record({
    id: 'ok',
    name: 'other',
    start: 10,
  })
  const second = record({
    id: 'e2',
    name: 'checkout',
    outcome: 'error',
    error: { type: 'TypeError', message: 'fail' },
    start: 20,
  })
  expect(errorGroupKey(first)).toBe(errorGroupKey(second))
  const folded = foldLogRows([first, other, second], {
    expandedKeys: new Set(),
    errorsOn: true,
    hiddenMountCount: 3,
    hiddenAbortCount: 0,
  })
  expect(folded[0]?.name).toContain('mount')
  const errorRow = folded.find((row) => logGroupOf(row)?.kind === 'error')
  expect(logGroupOf(errorRow!)?.count).toBe(2)
  expect(folded.some((row) => row.id === 'ok')).toBe(true)
})

test('turnSection describes a root and hairline copy', () => {
  const root = record({
    id: 'root',
    name: 'submit',
    reatomKind: 'action',
    start: 0,
    end: 80,
  })
  const child = record({
    id: 'child',
    name: 'email',
    kind: 'log',
    reatomKind: 'atom',
    eventName: 'reatom.atom.update',
    parentSpanId: 'span',
    start: 10,
    end: undefined,
  })
  expect(isRootSpan(root)).toBe(true)
  const section = turnSection(root, [root, child], 1)
  expect(section.errorCount).toBe(0)
  expect(section.updateCount).toBe(1)
  expect(turnHairlineText(section)).toContain('Turn 1 · submit')
})

test('sectionStickyTop stays in its own trace', () => {
  const first = record({ id: 'a', name: 'one', parentSpanId: undefined })
  const child = record({
    id: 'a-child',
    name: 'child',
    parentSpanId: 'span',
  })
  const second = record({ id: 'b', name: 'two', parentSpanId: undefined })
  expect(sectionStickyTop(first, [first, child, second], 0, 26)).toBe('0px')
  expect(sectionStickyTop(first, [first, child, second], 40, 26)).toBe('-14px')
  expect(sectionStickyTop(second, [first, child, second], 0, 26)).toBe('0px')
})

test('timeStripModel stacks kinds, keeps off-viewport errors, and hatches the tail', () => {
  const action = record({ id: 'a', start: 0, end: 50, reatomKind: 'action' })
  const computed = record({
    id: 'c',
    start: 20,
    end: 40,
    reatomKind: 'computed',
  })
  const error = record({
    id: 'e',
    start: 90,
    end: 100,
    outcome: 'error',
    error: { message: 'boom' },
  })
  const model = timeStripModel(
    [action, computed, error],
    { start: 0, end: 100 },
    { start: 0, end: 40 },
    { paused: true, dropped: true },
  )
  expect(model === null).toBe(false)
  expect(model && model.errorTicks.length).toBe(1)
  expect(model && model.viewport?.left).toBe(0)
  expect(model !== null && model.gaps.some((gap) => gap.reason === 'dropped')).toBe(
    true,
  )
})

test('timeStripModel keeps a stack when the range has no duration', () => {
  const action = record({ id: 'a', start: 10, end: 10, reatomKind: 'action' })
  const model = timeStripModel([action], { start: 10, end: 10 }, { start: 10, end: 10 })
  expect(model === null).toBe(false)
  expect(model && model.stacks.length > 0).toBe(true)
})

test('sessionAxisMarkers label page views and collide close ticks', () => {
  const page = record({
    id: 'p',
    kind: 'log',
    eventName: 'app.page_view',
    reatomKind: 'page_view',
    name: '/cart?x=1',
    attributes: { 'url.path': '/cart?x=1' },
    start: 10,
    end: undefined,
  })
  const session = record({
    id: 's',
    kind: 'log',
    eventName: 'session.start',
    reatomKind: 'session',
    name: 'session.start',
    start: 11,
    end: undefined,
  })
  const markers = sessionAxisMarkers([page, session])
  expect(markers[0]?.label).toBe('/cart')
  const collided = collideAxisMarkers(markers, { start: 0, end: 100 }, 200, 20)
  expect(collided[0]?.extra).toBeGreaterThan(0)
  expect(collided[0]?.label.startsWith('+')).toBe(true)
})

test('row chips append to the draft and do not apply', () => {
  const row = record({
    outcome: 'error',
    causeIds: ['1', '2', '3'],
    error: { type: 'TypeError' },
    attributes: { 'exception.type': 'TypeError', 'reatom.params': '["x"]' },
  })
  const chips = recordRowChips(row)
  expect(chips.some((chip) => chip.clause === 'outcome:error')).toBe(true)
  expect(chips.some((chip) => chip.tone === 'error')).toBe(true)
  const { shown, extra } = visibleRowChips(chips, 3)
  expect(shown).toHaveLength(3)
  expect(extra).toBeGreaterThanOrEqual(0)
  expect(rowChipDraft('', chips[0]!, false)).toBe('outcome:error')
  expect(rowChipDraft('kind:action', chips[0]!, true)).toBe(
    'kind:action AND NOT (outcome:error)',
  )
})
