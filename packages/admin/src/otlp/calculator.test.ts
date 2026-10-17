import { expect, test } from 'test'

import type { AdminRecord } from './ingest.ts'
import { LOCAL_VALUES } from './ingest.ts'
import {
  appendCalculatorClause,
  calculatorClauses,
  mergePendingCalculatorDraft,
  describeCalculator,
  durationThresholdMs,
  evaluateRecordExpression,
  explainEmptyClauses,
  explainRecordMatch,
  formatMatchExplanation,
  highlightCalculator,
  parseCalculator,
  previewGhostRecordIds,
  removeCalculatorClause,
  savedFilterReason,
  stringifyCalculator,
  wouldMatchHeadline,
} from './calculator.ts'

const SPEC_QUERY =
  'name:checkout.* AND (state:"out of stock" OR NOT params:guest) AND duration>100ms AND attr.http.response.status_code>=500'

function record(overrides: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: 'id',
    sourceId: 'local',
    kind: 'span',
    traceId: 'aa',
    spanId: 'bb',
    name: 'checkout.pay',
    start: 0,
    end: 250,
    attributes: {
      'reatom.params': '["member"]',
      'reatom.payload': 'ok',
      'http.response.status_code': 500,
    },
    body: 'out of stock',
    resource: { 'service.instance.id': 'local' },
    links: [],
    causeIds: [],
    reatomKind: 'action',
    outcome: 'ok',
    ...overrides,
  }
}

function expectRoundTrip(source: string) {
  const parsed = parseCalculator(source)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  const canonical = stringifyCalculator(parsed)
  const again = parseCalculator(canonical)
  expect(again.ok).toBe(true)
  if (!again.ok) return
  expect(stringifyCalculator(again)).toBe(canonical)
  expect(again.expression.operator).toBe(parsed.expression.operator)
  expect(again.expression.children).toHaveLength(
    parsed.expression.children.length,
  )
}

test('calculator parser round-trips FilterGroup for the spec example', () => {
  const parsed = parseCalculator(SPEC_QUERY)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(parsed.expression.operator).toBe('AND')
  expect(parsed.expression.children).toHaveLength(4)
  expect(parsed.tags).toHaveLength(5)
  expectRoundTrip(SPEC_QUERY)
  expectRoundTrip('name:explode AND kind:action')
  expectRoundTrip('name=explode AND kind=action')
  expectRoundTrip('errors:true OR route:goods')
  expectRoundTrip('NOT kind:atom AND trace:aa')
  expectRoundTrip('spans>1')
  expectRoundTrip('spans=2')
})

test('name=X and kind=X keep equals and match case-insensitively', () => {
  const parsed = parseCalculator('name=EXPLODE AND kind=ACTION')
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return
  expect(stringifyCalculator(parsed)).toBe('name=EXPLODE AND kind=ACTION')
  expect(
    evaluateRecordExpression(
      record({ name: 'explode', reatomKind: 'action' }),
      parsed.expression,
      parsed.tags,
    ),
  ).toBe(true)
  expect(
    evaluateRecordExpression(
      record({ name: 'explodePay', reatomKind: 'action' }),
      parsed.expression,
      parsed.tags,
    ),
  ).toBe(false)
  expect(
    evaluateRecordExpression(
      record({ name: 'explode', reatomKind: 'atom' }),
      parsed.expression,
      parsed.tags,
    ),
  ).toBe(false)
})

test('highlightCalculator covers the source with distinct token kinds', () => {
  const colorful = 'name:explode AND (state:"out of stock" OR kind:action)'
  expect(
    highlightCalculator(colorful)
      .map((span) => span.text)
      .join(''),
  ).toBe(colorful)
  expect(
    highlightCalculator(colorful).map((span) => [span.kind, span.text]),
  ).toEqual([
    ['field', 'name'],
    ['op', ':'],
    ['value', 'explode'],
    ['space', ' '],
    ['keyword', 'AND'],
    ['space', ' '],
    ['paren', '('],
    ['field', 'state'],
    ['op', ':'],
    ['string', '"out of stock"'],
    ['space', ' '],
    ['keyword', 'OR'],
    ['space', ' '],
    ['field', 'kind'],
    ['op', ':'],
    ['value', 'action'],
    ['paren', ')'],
  ])

  expect(
    highlightCalculator(SPEC_QUERY)
      .map((span) => span.text)
      .join(''),
  ).toBe(SPEC_QUERY)
  const specKinds = new Set(
    highlightCalculator(SPEC_QUERY).map((span) => span.kind),
  )
  expect(specKinds.has('field')).toBe(true)
  expect(specKinds.has('keyword')).toBe(true)
  expect(specKinds.has('op')).toBe(true)
  expect(specKinds.has('string')).toBe(true)
  expect(specKinds.has('paren')).toBe(true)

  expect(highlightCalculator('foo:bar').map((span) => span.kind)).toEqual([
    'error',
    'op',
    'value',
  ])
  expect(highlightCalculator('spans:3')[0]?.kind).toBe('field')
})

test('clauses separated by whitespace are joined with AND', () => {
  const implicit = parseCalculator('name:makeMove kind:action')
  const explicit = parseCalculator('name:makeMove AND kind:action')
  expect(implicit.ok && explicit.ok).toBe(true)
  if (!implicit.ok || !explicit.ok) return
  expect(stringifyCalculator(implicit)).toBe(stringifyCalculator(explicit))
  expect(stringifyCalculator(implicit)).toBe('name:makeMove AND kind:action')
})

test('unknown target and extra tokens are parse errors', () => {
  const unknown = parseCalculator('foo:bar')
  expect(unknown.ok).toBe(false)
  if (unknown.ok) return
  expect(unknown.error).toMatch(/Unknown target/)

  const extra = parseCalculator('name:explode )')
  expect(extra.ok).toBe(false)

  const causeColon = parseCalculator('cause:tree.checked')
  expect(causeColon.ok).toBe(false)
  if (causeColon.ok) return
  expect(causeColon.error).toBe('cause needs > or <')
})

test('engine matches new calculator targets on AdminRecord', () => {
  const parsed = parseCalculator(SPEC_QUERY)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return

  const hit = record()
  expect(evaluateRecordExpression(hit, parsed.expression, parsed.tags)).toBe(
    true,
  )

  expect(
    evaluateRecordExpression(
      record({ name: 'cart.add' }),
      parsed.expression,
      parsed.tags,
    ),
  ).toBe(false)

  expect(
    evaluateRecordExpression(
      record({ end: 50 }),
      parsed.expression,
      parsed.tags,
    ),
  ).toBe(false)

  expect(
    evaluateRecordExpression(
      record({ attributes: { 'http.response.status_code': 200 } }),
      parsed.expression,
      parsed.tags,
    ),
  ).toBe(false)

  const guestBlocked = parseCalculator('NOT params:guest')
  expect(guestBlocked.ok).toBe(true)
  if (!guestBlocked.ok) return
  expect(
    evaluateRecordExpression(
      record({ attributes: { 'reatom.params': '["guest"]' } }),
      guestBlocked.expression,
      guestBlocked.tags,
    ),
  ).toBe(false)
  expect(
    evaluateRecordExpression(
      record(),
      guestBlocked.expression,
      guestBlocked.tags,
    ),
  ).toBe(true)

  const errors = parseCalculator('errors:true')
  expect(errors.ok).toBe(true)
  if (!errors.ok) return
  expect(
    evaluateRecordExpression(
      record({ outcome: 'error', error: { message: 'boom' } }),
      errors.expression,
      errors.tags,
    ),
  ).toBe(true)
  expect(
    evaluateRecordExpression(record(), errors.expression, errors.tags),
  ).toBe(false)
})

test('cause> walks ancestors and cause< matches direct children', () => {
  const toggle = record({
    id: 'toggle',
    name: 'tree#.toggle',
    atomName: 'tree#12.toggle',
    traceId: 'cb',
    frameId: '1',
    causeIds: [],
    reatomKind: 'action',
  })
  const checked = record({
    id: 'checked',
    kind: 'log',
    name: 'reatom.atom.update',
    atomName: 'tree.checked',
    traceId: 'cb',
    frameId: '2',
    causeIds: ['1'],
    reatomKind: 'atom',
    start: 1,
    end: undefined,
  })
  const ping = record({
    id: 'ping',
    name: 'devtools.ping',
    traceId: 'aa',
    frameId: '1',
    causeIds: [],
  })
  const records = [toggle, checked, ping]

  const causedByToggle = parseCalculator('cause>tree#12.toggle')
  expect(causedByToggle.ok).toBe(true)
  if (!causedByToggle.ok) return
  expectRoundTrip('cause>tree#12.toggle')
  expectRoundTrip('cause<tree.checked')
  expect(
    evaluateRecordExpression(
      checked,
      causedByToggle.expression,
      causedByToggle.tags,
      records,
    ),
  ).toBe(true)
  expect(
    evaluateRecordExpression(
      toggle,
      causedByToggle.expression,
      causedByToggle.tags,
      records,
    ),
  ).toBe(false)
  expect(
    evaluateRecordExpression(
      ping,
      causedByToggle.expression,
      causedByToggle.tags,
      records,
    ),
  ).toBe(false)

  const causedChecked = parseCalculator('cause<tree.checked')
  expect(causedChecked.ok).toBe(true)
  if (!causedChecked.ok) return
  expect(
    evaluateRecordExpression(
      toggle,
      causedChecked.expression,
      causedChecked.tags,
      records,
    ),
  ).toBe(true)
  expect(
    evaluateRecordExpression(
      checked,
      causedChecked.expression,
      causedChecked.tags,
      records,
    ),
  ).toBe(false)
})

test('spans>N matches every record in traces with more than N spans', () => {
  const parent = record({
    id: 'parent',
    traceId: 'busy',
    spanId: 's1',
    name: 'explode',
  })
  const child = record({
    id: 'child',
    traceId: 'busy',
    spanId: 's2',
    name: 'retry',
    start: 1,
    end: 2,
  })
  const log = record({
    id: 'log',
    kind: 'log',
    traceId: 'busy',
    spanId: 's1',
    name: 'exception',
    eventName: 'exception',
    start: 1,
    end: undefined,
    reatomKind: undefined,
  })
  const solo = record({
    id: 'solo',
    traceId: 'quiet',
    spanId: 's3',
    name: 'ping',
  })
  const records = [parent, child, log, solo]

  const overOne = parseCalculator('spans>1')
  expect(overOne.ok).toBe(true)
  if (!overOne.ok) return
  expect(
    records
      .filter((item) =>
        evaluateRecordExpression(
          item,
          overOne.expression,
          overOne.tags,
          records,
        ),
      )
      .map((item) => item.name),
  ).toEqual(['explode', 'retry', 'exception'])
  expect(
    evaluateRecordExpression(solo, overOne.expression, overOne.tags, records),
  ).toBe(false)

  const equalsTwo = parseCalculator('spans=2')
  expect(equalsTwo.ok).toBe(true)
  if (!equalsTwo.ok) return
  expect(
    evaluateRecordExpression(
      parent,
      equalsTwo.expression,
      equalsTwo.tags,
      records,
    ),
  ).toBe(true)
  expect(
    evaluateRecordExpression(
      solo,
      equalsTwo.expression,
      equalsTwo.tags,
      records,
    ),
  ).toBe(false)

  const equalsOne = parseCalculator('spans:1')
  expect(equalsOne.ok).toBe(true)
  if (!equalsOne.ok) return
  expect(
    evaluateRecordExpression(
      solo,
      equalsOne.expression,
      equalsOne.tags,
      records,
    ),
  ).toBe(true)
  expect(
    evaluateRecordExpression(
      log,
      equalsOne.expression,
      equalsOne.tags,
      records,
    ),
  ).toBe(false)
})

test('payload and state matchers also see local value text', () => {
  const local = record({
    attributes: { 'reatom.payload': '"***"', 'reatom.params': '["***"]' },
    body: '***',
    [LOCAL_VALUES]: {
      payload: { token: 'live-secret-token' },
      state: { stock: 'live-state-token' },
    },
  })
  const masked = record({
    attributes: { 'reatom.payload': '"***"', 'reatom.params': '["***"]' },
    body: '***',
  })
  const payload = parseCalculator('payload:live-secret-token')
  const state = parseCalculator('state:live-state-token')
  const stars = parseCalculator('payload:***')
  expect(payload.ok && state.ok && stars.ok).toBe(true)
  if (!payload.ok || !state.ok || !stars.ok) return
  expect(
    evaluateRecordExpression(local, payload.expression, payload.tags),
  ).toBe(true)
  expect(evaluateRecordExpression(local, state.expression, state.tags)).toBe(
    true,
  )
  expect(
    evaluateRecordExpression(masked, payload.expression, payload.tags),
  ).toBe(false)
  expect(evaluateRecordExpression(local, stars.expression, stars.tags)).toBe(
    true,
  )
})

test('session matches session.id or service.instance.id', () => {
  const matches = (target: AdminRecord, query: string) => {
    const parsed = parseCalculator(query)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return false
    return evaluateRecordExpression(target, parsed.expression, parsed.tags)
  }
  const both = record({
    kind: 'log',
    eventName: 'app.page_view',
    name: 'app.page_view',
    attributes: { 'session.id': 'sess' },
    resource: { 'service.instance.id': 'inst' },
  })
  expect(matches(both, 'session:sess')).toBe(true)
  expect(matches(both, 'session:inst')).toBe(true)

  const analyticsLog = record({
    kind: 'log',
    eventName: 'app.page_view',
    name: 'app.page_view',
    attributes: { 'session.id': 'sess' },
    resource: { 'service.name': 'shop-web' },
  })
  expect(matches(analyticsLog, 'session:sess')).toBe(true)
  expect(matches(analyticsLog, 'session:inst')).toBe(false)
})

test('error.type and error.message match joined exceptions', () => {
  const failed = record({
    outcome: 'error',
    error: { type: 'TypeError', message: 'boom at pay' },
  })
  const parsedType = parseCalculator('error.type:TypeError')
  expect(parsedType.ok).toBe(true)
  if (!parsedType.ok) return
  expect(
    evaluateRecordExpression(failed, parsedType.expression, parsedType.tags),
  ).toBe(true)
  expect(
    evaluateRecordExpression(
      record({ name: 'ok' }),
      parsedType.expression,
      parsedType.tags,
    ),
  ).toBe(false)
  const parsedMessage = parseCalculator('error.message:pay')
  expect(parsedMessage.ok).toBe(true)
  if (!parsedMessage.ok) return
  expect(
    evaluateRecordExpression(
      failed,
      parsedMessage.expression,
      parsedMessage.tags,
    ),
  ).toBe(true)
  expect(parseCalculator('error.message:').ok).toBe(false)
  const anyMessage = parseCalculator('error.message:boom')
  expect(anyMessage.ok).toBe(true)
  if (!anyMessage.ok) return
  expect(
    evaluateRecordExpression(
      record({ name: 'ok' }),
      anyMessage.expression,
      anyMessage.tags,
    ),
  ).toBe(false)
})

test('durationThresholdMs reads the lowest duration> clause', () => {
  expect(durationThresholdMs('kind:action duration>16ms')).toBe(16)
  expect(durationThresholdMs('duration>=1s AND name:x')).toBe(1000)
  expect(durationThresholdMs('NOT duration>16ms')).toBeUndefined()
  expect(durationThresholdMs('name:x')).toBeUndefined()
})

test('appendCalculatorClause joins with AND and wraps NOT', () => {
  expect(appendCalculatorClause('', 'outcome:error')).toBe('outcome:error')
  expect(appendCalculatorClause('kind:action', 'outcome:error', true)).toBe(
    'kind:action AND NOT (outcome:error)',
  )
})

test('mergePendingCalculatorDraft appends a clause instead of substring-replacing', () => {
  expect(mergePendingCalculatorDraft('name:ab', 'name:a')).toBe(
    'name:ab AND name:a',
  )
  expect(mergePendingCalculatorDraft('name:a', 'name:a')).toBe('name:a')
  expect(mergePendingCalculatorDraft('', 'kind:action')).toBe('kind:action')
})

test('describeCalculator restates kind, duration, and cause', () => {
  expect(describeCalculator('kind:action duration>100ms')).toBe(
    'Actions, slower than 100ms',
  )
  expect(describeCalculator('cause>submit')).toBe('Caused by submit')
  expect(describeCalculator('errors:true', 'highlight')).toBe(
    'errors, highlighted',
  )
  expect(describeCalculator('')).toBeUndefined()
})

test('calculatorClauses splits an applied AND without using a broken draft', () => {
  expect(calculatorClauses('duration>100ms cause>submit name:pay')).toEqual([
    { source: 'duration>100ms' },
    { source: 'cause>submit' },
    { source: 'name:pay' },
  ])
  expect(calculatorClauses('name:x AND (bogus')).toEqual([])
  expect(
    removeCalculatorClause('duration>100ms cause>submit name:pay', 'cause>submit'),
  ).toBe('duration>100ms AND name:pay')
  expect(removeCalculatorClause('duration>100ms', 'duration>100ms')).toBe('')
})

test('previewGhostRecordIds ghosts the draft only, never an empty draft', () => {
  const pay = record({ id: 'pay', name: 'pay', reatomKind: 'action' })
  const atom = record({ id: 'atom', name: 'cart', reatomKind: 'atom' })
  expect(
    previewGhostRecordIds([pay, atom], 'kind:action', 'kind:action'),
  ).toEqual(new Set())
  expect(previewGhostRecordIds([pay, atom], '', '')).toEqual(new Set())
  expect(
    [...previewGhostRecordIds([pay, atom], 'kind:action', '')],
  ).toEqual(['pay'])
  expect(
    [...previewGhostRecordIds([pay, atom], 'kind:action name:pay', '', 'name:pay')],
  ).toEqual(['pay'])
})

test('wouldMatchHeadline names show versus hide', () => {
  expect(wouldMatchHeadline('show', 42, 1310, 3)).toBe(
    'Would show 42 of 1,310 · 3 errors',
  )
  expect(wouldMatchHeadline('hide', 1, 10, 1)).toBe('Would hide 1 of 10 · 1 error')
})

test('explainRecordMatch names cause hops and empty clauses', () => {
  const submit = record({
    id: 'submit',
    frameId: '1',
    name: 'submit',
    atomName: 'submit',
    reatomKind: 'action',
    causeIds: [],
  })
  const cart = record({
    id: 'cart',
    frameId: '2',
    name: 'cartAtom',
    atomName: 'cartAtom',
    reatomKind: 'atom',
    causeIds: ['1'],
  })
  const checkout = record({
    id: 'checkout',
    frameId: '3',
    name: 'checkout',
    atomName: 'checkout',
    reatomKind: 'action',
    causeIds: ['2'],
  })
  const lines = explainRecordMatch(
    checkout,
    'name:checkout cause>submit',
    [submit, cart, checkout],
  )
  expect(lines).toEqual([
    { clause: 'name:checkout', matched: true },
    {
      clause: 'cause>submit',
      matched: true,
      hops: ['submit', 'cartAtom', 'checkout'],
    },
  ])
  expect(formatMatchExplanation(lines!)).toContain(
    'cause>submit ✓ via submit → cartAtom → checkout',
  )
  expect(explainRecordMatch(checkout, '', [checkout])).toBeUndefined()
  const empty = explainEmptyClauses('name:missing duration>1ms', [
    checkout,
  ])
  expect(empty?.[0]).toEqual({ clause: 'name:missing', count: 0 })
  expect(empty?.[1]?.count).toBe(1)
})

test('savedFilterReason names a missing session.id', () => {
  expect(savedFilterReason('session:abc', [record()])).toBe(
    'No session.id in this capture',
  )
  expect(
    savedFilterReason('session:abc', [
      record({ attributes: { 'session.id': 'abc' } }),
    ]),
  ).toBeUndefined()
  expect(savedFilterReason('name:pay', [record()])).toBeUndefined()
})
