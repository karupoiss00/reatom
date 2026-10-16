import { expect, test } from 'test'

import {
  buildCalculatorIndex,
  parseCalculator,
  type AdminRecord,
} from '../../otlp'
import {
  appendCalculatorKey,
  backspaceCalculator,
  calculatorBreakdown,
  calculatorInputState,
  calculatorValueSuggestions,
  isCalculatorKeyEnabled,
  type CalculatorKey,
} from './calculatorPad'

function press(...keys: CalculatorKey[]): string {
  return keys.reduce(appendCalculatorKey, '')
}

function record(id: string, name: string, overrides: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id,
    sourceId: 'test',
    kind: 'span',
    traceId: 't1',
    spanId: id,
    name,
    start: 0,
    end: 1,
    attributes: {},
    resource: {},
    ...overrides,
  } as AdminRecord
}

test('keys build a parsable expression with explicit operators', () => {
  const source = press(
    { kind: 'field', value: 'name' },
    { kind: 'op', value: ':' },
    { kind: 'value', value: 'makeMove' },
    { kind: 'field', value: 'kind' },
    { kind: 'op', value: '=' },
    { kind: 'value', value: 'action' },
    { kind: 'logic', value: 'OR' },
    { kind: 'logic', value: 'NOT' },
    { kind: 'paren', value: '(' },
    { kind: 'field', value: 'duration' },
    { kind: 'op', value: '>' },
    { kind: 'value', value: '10ms' },
    { kind: 'paren', value: ')' },
  )
  expect(source).toBe('name:makeMove AND kind=action OR NOT (duration>10ms)')
  expect(parseCalculator(source).ok).toBe(true)
})

test('a second comparison or value replaces the previous one', () => {
  const withOp = press({ kind: 'field', value: 'kind' }, { kind: 'op', value: ':' })
  expect(appendCalculatorKey(withOp, { kind: 'op', value: '=' })).toBe('kind=')

  const withValue = appendCalculatorKey('kind=', { kind: 'value', value: 'action' })
  expect(appendCalculatorKey(withValue, { kind: 'value', value: 'atom' })).toBe('kind=atom')
  expect(appendCalculatorKey('name:', { kind: 'value', value: 'a b' })).toBe('name:"a b"')
})

test('input state tracks what the next key completes', () => {
  expect(calculatorInputState('')).toMatchObject({ expect: 'clause' })
  expect(calculatorInputState('name')).toMatchObject({ expect: 'operator', field: 'name' })
  expect(calculatorInputState('cause>')).toMatchObject({ expect: 'value', field: 'cause' })
  expect(calculatorInputState('(kind:atom')).toMatchObject({
    expect: 'connector',
    field: 'kind',
    openParens: 1,
  })
  expect(calculatorInputState('kind:atom AND ')).toMatchObject({ expect: 'clause' })
})

test('keys that would break the expression are disabled', () => {
  const afterField = calculatorInputState('name')
  expect(isCalculatorKeyEnabled(afterField, { kind: 'op', value: ':' })).toBe(true)
  expect(isCalculatorKeyEnabled(afterField, { kind: 'op', value: '>' })).toBe(false)
  expect(isCalculatorKeyEnabled(afterField, { kind: 'logic', value: 'AND' })).toBe(false)

  const afterDuration = calculatorInputState('duration')
  expect(isCalculatorKeyEnabled(afterDuration, { kind: 'op', value: '>=' })).toBe(true)

  const complete = calculatorInputState('kind:atom')
  expect(isCalculatorKeyEnabled(complete, { kind: 'paren', value: ')' })).toBe(false)
  expect(isCalculatorKeyEnabled(complete, { kind: 'logic', value: 'OR' })).toBe(true)
})

test('backspace removes one token at a time', () => {
  expect(backspaceCalculator('name:"a b" AND kind')).toBe('name:"a b" AND ')
  expect(backspaceCalculator('name:"a b" AND ')).toBe('name:"a b"')
  expect(backspaceCalculator('name:"a b"')).toBe('name:')
  expect(backspaceCalculator('name:')).toBe('name')
  expect(backspaceCalculator('')).toBe('')
})

test('value suggestions come from the records, most frequent first', () => {
  const records = [
    record('1', 'makeMove', { reatomKind: 'action' }),
    record('2', 'makeMove', { reatomKind: 'action' }),
    record('3', 'board', { reatomKind: 'atom' }),
  ]
  expect(calculatorValueSuggestions('name', records)).toEqual(['makeMove', 'board'])
  expect(calculatorValueSuggestions('kind', records)).toEqual(['span', 'action', 'atom'])
  expect(calculatorValueSuggestions('state', records)).toEqual([])
})

test('breakdown counts each group and clause', () => {
  const records = [
    record('1', 'makeMove', { reatomKind: 'action' }),
    record('2', 'board', { reatomKind: 'atom' }),
    record('3', 'resetGame', { reatomKind: 'action' }),
  ]
  const parsed = parseCalculator('kind:action AND (name:makeMove OR name:board)')
  if (!parsed.ok) throw new Error(parsed.error)
  const breakdown = calculatorBreakdown(parsed, records, buildCalculatorIndex(records))
  expect(breakdown).toEqual({
    kind: 'all',
    label: 'AND',
    count: 1,
    children: [
      { kind: 'clause', label: 'kind:action', count: 2, children: [] },
      {
        kind: 'any',
        label: 'OR',
        count: 2,
        children: [
          { kind: 'clause', label: 'name:makeMove', count: 1, children: [] },
          { kind: 'clause', label: 'name:board', count: 1, children: [] },
        ],
      },
    ],
  })
})
