import {
  parseCalculator,
  type CalculatorCompareOp,
  type CalculatorCompareValue,
  type CalculatorParseOk,
} from '../otlp/calculator.ts'
import type { CausePredicate, FilterGroup, FilterTag } from '../types.ts'
import type { AdminMcpFilter } from './types.ts'

const KIND_WORDS: Record<string, string> = {
  action: 'actions',
  atom: 'atoms',
  computed: 'computed',
  effect: 'effects',
  log: 'logs',
  span: 'spans',
  route: 'routes',
  loader: 'loaders',
  render: 'renders',
  mount: 'mounts',
}

function compareOpWords(op: CalculatorCompareOp, raw: string): string {
  if (op === '>' || op === '>=') return `slower than ${raw}`
  if (op === '<' || op === '<=') return `faster than ${raw}`
  return `lasting ${raw}`
}

function describeCompare(value: CalculatorCompareValue): string {
  if (value.field === 'kind') {
    return KIND_WORDS[value.raw] ?? value.raw
  }
  if (value.field === 'duration') {
    return compareOpWords(value.op, value.raw)
  }
  if (value.field === 'errors') {
    return value.raw === 'false' || value.raw === '0' ? 'without errors' : 'errors'
  }
  if (value.field === 'outcome') return `outcome ${value.raw}`
  if (value.field === 'name') return value.raw
  return `${value.field}${value.op}${value.raw}`
}

function describeTag(tag: FilterTag, negated: boolean): string {
  const predicate = tag.predicates[0]
  if (!predicate) return negated ? `not ${tag.name}` : tag.name
  let body = tag.name
  if (predicate.type === 'cause') {
    const cause = predicate as CausePredicate
    body =
      cause.direction === '>'
        ? `caused by ${cause.referencePattern}`
        : `causing ${cause.referencePattern}`
  } else if (predicate.type === 'compare') {
    body = describeCompare(predicate.value as CalculatorCompareValue)
  } else if (predicate.type === 'attr') {
    body = tag.name
  }
  return negated ? `not ${body}` : body
}

function describeNode(
  node: FilterGroup['children'][number],
  tags: Map<string, FilterTag>,
  joiner: 'AND' | 'OR',
): string {
  if ('tagId' in node) {
    const tag = tags.get(node.tagId)
    if (!tag) return ''
    return describeTag(tag, node.negated)
  }
  const childJoiner = node.operator === 'OR' ? ' or ' : ' '
  const parts = node.children
    .map((child) => describeNode(child, tags, node.operator))
    .filter((part) => part !== '')
  const joined = parts.join(childJoiner)
  return joiner === 'AND' && node.operator === 'OR' ? `(${joined})` : joined
}

function describeCalculator(parsed: CalculatorParseOk): string | undefined {
  if (parsed.expression.children.length === 0) return undefined
  const tags = new Map(parsed.tags.map((tag) => [tag.id, tag]))
  const sentence = describeNode(parsed.expression, tags, parsed.expression.operator)
  return sentence === '' ? undefined : sentence
}

function chipClauses(filter: AdminMcpFilter): string[] {
  const parts: string[] = []
  if (filter.kind) parts.push(KIND_WORDS[filter.kind] ?? filter.kind)
  if (filter.reatomKind) {
    parts.push(KIND_WORDS[filter.reatomKind] ?? filter.reatomKind)
  }
  if (filter.hasError === true) parts.push('errors')
  if (filter.name) parts.push(filter.name)
  if (filter.query) parts.push(filter.query)
  return parts
}

export function describeMcpFilter(
  filter: AdminMcpFilter | undefined,
): string | undefined {
  if (!filter) return undefined
  const parts = chipClauses(filter)
  if (filter.calculator) {
    const parsed = parseCalculator(filter.calculator)
    if (parsed.ok) {
      const sentence = describeCalculator(parsed)
      if (sentence) parts.push(sentence)
    } else if (filter.calculator.trim() !== '') {
      parts.push(filter.calculator.trim())
    }
  }
  const unique = [...new Set(parts)]
  if (unique.length === 0) return undefined
  let sentence = unique.join(' ')
  if (filter.mode === 'highlight') sentence += ', highlighted'
  else if (filter.mode === 'hide') sentence += ', hidden'
  return sentence
}
