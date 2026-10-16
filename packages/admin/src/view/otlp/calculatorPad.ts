import {
  evaluateRecordExpression,
  highlightCalculator,
  quoteCalculatorValue,
  recordLabel,
  stringifyCalculatorNode,
  type AdminRecord,
  type CalculatorCompareOp,
  type CalculatorHighlightSpan,
  type CalculatorParseOk,
  type CalculatorRecordIndex,
} from '../../otlp'
import type { FilterGroup, FilterTagRef } from '../../types'

/** What the next key completes at the end of the expression. */
export type CalculatorExpect = 'clause' | 'operator' | 'value' | 'connector'

export interface CalculatorInputState {
  expect: CalculatorExpect
  /** Target of the clause being written, or of the last complete clause. */
  field: string | undefined
  openParens: number
}

export type CalculatorKey =
  | { kind: 'logic'; value: 'AND' | 'OR' | 'NOT' }
  | { kind: 'paren'; value: '(' | ')' }
  | { kind: 'field'; value: string }
  | { kind: 'op'; value: CalculatorCompareOp }
  | { kind: 'value'; value: string }

export interface CalculatorFieldKey {
  field: string
  hint: string
}

export const CALCULATOR_FIELD_KEYS: readonly CalculatorFieldKey[] = [
  { field: 'name', hint: 'Span, atom, or action name' },
  { field: 'kind', hint: 'action, atom, computed, route, log' },
  { field: 'errors', hint: 'true for failed records, false for the rest' },
  { field: 'duration', hint: 'Milliseconds, or a unit: 10ms, 1s' },
  { field: 'outcome', hint: 'ok, error, or abort' },
  { field: 'event', hint: 'Log event name' },
  { field: 'state', hint: 'Atom state text' },
  { field: 'params', hint: 'Action params text' },
  { field: 'payload', hint: 'Action payload text' },
  { field: 'trace', hint: 'Trace id' },
  { field: 'spans', hint: 'Number of spans in the same trace' },
  { field: 'cause>', hint: 'Caused by a record with this name, at any depth' },
  { field: 'cause<', hint: 'Directly causes a record with this name' },
  { field: 'attr.', hint: 'OTLP attribute path, typed after the dot' },
]

export const CALCULATOR_OP_KEYS: ReadonlyArray<{
  op: CalculatorCompareOp
  hint: string
}> = [
  { op: ':', hint: 'contains' },
  { op: '=', hint: 'equals' },
  { op: '>', hint: 'greater than' },
  { op: '<', hint: 'less than' },
  { op: '>=', hint: 'at least' },
  { op: '<=', hint: 'at most' },
]

const NUMERIC_FIELDS = new Set(['duration', 'spans'])
const TEXT_OPS: readonly CalculatorCompareOp[] = [':', '=']
const ALL_OPS: readonly CalculatorCompareOp[] = CALCULATOR_OP_KEYS.map(
  (key) => key.op,
)

interface PositionedSpan {
  span: CalculatorHighlightSpan
  start: number
}

function positionedSpans(source: string): PositionedSpan[] {
  const result: PositionedSpan[] = []
  let offset = 0
  for (const span of highlightCalculator(source)) {
    if (span.kind !== 'space') result.push({ span, start: offset })
    offset += span.text.length
  }
  return result
}

export function calculatorOpsFor(
  field: string | undefined,
): readonly CalculatorCompareOp[] {
  if (field === undefined || field === 'cause') return []
  if (NUMERIC_FIELDS.has(field) || field.startsWith('attr.')) return ALL_OPS
  return TEXT_OPS
}

function isValueSpan(span: CalculatorHighlightSpan | undefined): boolean {
  return span?.kind === 'value' || span?.kind === 'string'
}

function isTargetSpan(span: CalculatorHighlightSpan | undefined): boolean {
  return span?.kind === 'field' || span?.kind === 'error'
}

export function calculatorInputState(source: string): CalculatorInputState {
  const spans = positionedSpans(source).map((entry) => entry.span)
  let openParens = 0
  for (const span of spans) {
    if (span.text === '(') openParens += 1
    if (span.text === ')' && openParens > 0) openParens -= 1
  }
  const last = spans.at(-1)
  const beforeLast = spans.at(-2)
  const thirdFromEnd = spans.at(-3)

  if (last === undefined || last.kind === 'keyword' || last.text === '(') {
    return { expect: 'clause', field: undefined, openParens }
  }
  if (last.kind === 'field' || last.kind === 'error') {
    const field = last.kind === 'field' ? last.text : undefined
    return { expect: 'operator', field, openParens }
  }
  if (last.kind === 'op') {
    const field = isTargetSpan(beforeLast) ? beforeLast!.text : undefined
    return { expect: 'value', field, openParens }
  }
  const lastClauseField =
    isValueSpan(last) && beforeLast?.kind === 'op' && isTargetSpan(thirdFromEnd)
      ? thirdFromEnd!.text
      : undefined
  return { expect: 'connector', field: lastClauseField, openParens }
}

export function isCalculatorKeyEnabled(
  state: CalculatorInputState,
  key: CalculatorKey,
): boolean {
  const startsClause = state.expect === 'clause' || state.expect === 'connector'
  switch (key.kind) {
    case 'logic':
      return key.value === 'NOT' ? startsClause : state.expect === 'connector'
    case 'paren':
      return key.value === '('
        ? startsClause
        : state.expect === 'connector' && state.openParens > 0
    case 'field':
      return startsClause
    case 'op':
      if (state.expect !== 'operator' && state.expect !== 'value') return false
      return calculatorOpsFor(state.field).includes(key.value)
    case 'value':
      return (
        state.expect === 'value' ||
        (state.expect === 'connector' && state.field !== undefined)
      )
  }
}

function joinWord(base: string, word: string): string {
  if (base === '' || base.endsWith('(')) return `${base}${word}`
  return `${base} ${word}`
}

/**
 * Append one keypad key to the end of an expression. A clause key after a
 * complete clause writes an explicit AND. A comparison key after a comparison
 * replaces it. A value key after a complete clause replaces that clause's
 * value.
 */
export function appendCalculatorKey(
  source: string,
  key: CalculatorKey,
): string {
  const state = calculatorInputState(source)
  const base = source.trimEnd()
  const connector = state.expect === 'connector' ? 'AND ' : ''
  const last = positionedSpans(source).at(-1)

  switch (key.kind) {
    case 'logic':
      if (key.value === 'NOT') return `${joinWord(base, `${connector}NOT`)} `
      return `${joinWord(base, key.value)} `
    case 'paren':
      if (key.value === ')') return `${base})`
      return joinWord(base, `${connector}(`)
    case 'field':
      return joinWord(base, `${connector}${key.value}`)
    case 'op':
      if (state.expect === 'value' && last !== undefined) {
        return `${source.slice(0, last.start)}${key.value}`
      }
      return `${base}${key.value}`
    case 'value': {
      const quoted = quoteCalculatorValue(key.value)
      if (
        state.expect === 'connector' &&
        last !== undefined &&
        isValueSpan(last.span)
      ) {
        return `${source.slice(0, last.start)}${quoted}`
      }
      return `${base}${quoted}`
    }
  }
}

/** Remove the last token: a word, operator, quoted value, or parenthesis. */
export function backspaceCalculator(source: string): string {
  const last = positionedSpans(source).at(-1)
  if (last === undefined) return ''
  const rest = source.slice(0, last.start).trimEnd()
  const restLast = positionedSpans(rest).at(-1)
  return restLast?.span.kind === 'keyword' ? `${rest} ` : rest
}

function topByFrequency(
  values: Iterable<string | undefined>,
  limit: number,
): string[] {
  const counts = new Map<string, number>()
  for (const value of values) {
    if (value === undefined || value === '') continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([value]) => value)
}

function* recordKinds(records: readonly AdminRecord[]) {
  for (const record of records) {
    yield record.reatomKind
    yield record.kind
  }
}

/** Values seen in the records for a target, most frequent first. */
export function calculatorValueSuggestions(
  field: string | undefined,
  records: readonly AdminRecord[],
  limit = 8,
): string[] {
  switch (field) {
    case 'kind':
      return topByFrequency(recordKinds(records), limit)
    case 'name':
    case 'cause':
      return topByFrequency(records.map(recordLabel), limit)
    case 'outcome':
      return topByFrequency(
        records.map((record) => record.outcome),
        limit,
      )
    case 'event':
      return topByFrequency(
        records.map((record) => record.eventName),
        limit,
      )
    case 'trace':
      return topByFrequency(
        records.map((record) => record.traceId),
        limit,
      )
    case 'errors':
      return ['true', 'false']
    case 'duration':
      return ['1ms', '10ms', '100ms', '1s']
    case 'spans':
      return ['1', '2', '5', '10']
    default:
      return []
  }
}

export interface CalculatorBreakdownNode {
  kind: 'all' | 'any' | 'clause'
  label: string
  count: number
  children: CalculatorBreakdownNode[]
}

function isTagRef(node: FilterTagRef | FilterGroup): node is FilterTagRef {
  return 'tagId' in node
}

/**
 * Match count of every group and clause of a parsed expression against
 * `records`. `index` resolves cause links and spans and should cover every
 * stored record, not only the counted ones.
 */
export function calculatorBreakdown(
  parsed: CalculatorParseOk,
  records: readonly AdminRecord[],
  index: CalculatorRecordIndex,
): CalculatorBreakdownNode | null {
  const countMatches = (group: FilterGroup) =>
    records.reduce(
      (count, record) =>
        evaluateRecordExpression(record, group, parsed.tags, index)
          ? count + 1
          : count,
      0,
    )

  const describe = (
    node: FilterTagRef | FilterGroup,
  ): CalculatorBreakdownNode => {
    if (isTagRef(node)) {
      return {
        kind: 'clause',
        label: stringifyCalculatorNode(node, parsed.tags),
        count: countMatches({ operator: 'AND', children: [node] }),
        children: [],
      }
    }
    return {
      kind: node.operator === 'AND' ? 'all' : 'any',
      label: node.operator,
      count: countMatches(node),
      children: node.children.map(describe),
    }
  }

  const root = parsed.expression
  if (root.children.length === 0) return null
  if (root.children.length === 1) return describe(root.children[0]!)
  return describe(root)
}
