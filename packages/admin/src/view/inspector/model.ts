import { atom, type Atom, peek, reatomLinkedList, type Rec } from '@reatom/core'

/** How many fields an expanded value mounts before "… more". */
export const INSPECTOR_PAGE_SIZE = 20

const PREVIEW_LIMIT = 20
const OBJECT_PREVIEW_KEYS = 3
const SHALLOW_STRING = 100

export interface InspectorAction {
  /** Accessible name. Also the button text. */
  label: string
  onClick: () => void
}

export type InspectorKeyTone = 'key' | 'index' | 'symbol'

export interface InspectorEntry {
  /** Stable identity across value updates. Defaults to `key`. */
  id?: string
  key: string
  label?: string
  value: unknown
  tone?: InspectorKeyTone
  /**
   * Buttons next to this field name. `undefined` asks the inspector to call
   * `fieldActions`. An empty list means this field has no buttons.
   */
  actions?: readonly InspectorAction[]
}

export interface InspectorHooks {
  /** Return false to keep an object collapsed as a single tag. */
  expandable?: (value: unknown) => boolean
  /** Label for a walked field. Custom `entries` already carry their own label. */
  fieldLabel?: (key: string, value: unknown) => string
  /** Buttons for a walked field whose entry did not set `actions`. */
  fieldActions?: (key: string, value: unknown) => readonly InspectorAction[]
  /**
   * Replace the default object, array, map, and set walk. Return `undefined` to
   * keep the default. An empty array is an empty object.
   */
  entries?: (value: unknown) => readonly InspectorEntry[] | undefined
  /** Nested collections start closed unless this returns true for that value. */
  initiallyExpanded?: (value: unknown) => boolean
}

export type InspectorTone =
  | 'text'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'
  | 'date'
  | 'regexp'
  | 'symbol'
  | 'function'
  | 'error'
  | 'forbidden'
  | 'empty'
  | 'key'

export interface PreviewPart {
  text: string
  tone: InspectorTone
}

export interface FieldPage {
  tag: string
  arrayish: boolean
  entries: InspectorEntry[]
  truncated: boolean
}

const forbidden = Symbol('inspector.forbidden')

const typedArrayTag = Object.prototype.toString

export function isExpandableValue(
  value: unknown,
  hooks: InspectorHooks = {},
): value is object {
  if (value === null || typeof value !== 'object') return false
  if (hooks.expandable?.(value) === false) return false
  if (value instanceof Date || value instanceof RegExp) return false
  if (isErrorValue(value) || isElementValue(value)) return false
  return true
}

export function formatLeaf(
  value: unknown,
  mode: 'shallow' | 'full' = 'shallow',
): { text: string; tone: InspectorTone } {
  if (value === forbidden) return { text: '[forbidden]', tone: 'forbidden' }
  if (value === null) return { text: 'null', tone: 'null' }
  switch (typeof value) {
    case 'undefined':
      return { text: 'undefined', tone: 'undefined' }
    case 'boolean':
      return { text: value ? 'true' : 'false', tone: 'boolean' }
    case 'number':
      return {
        text: Object.is(value, -0) ? '-0' : String(value),
        tone: 'number',
      }
    case 'bigint':
      return { text: `${value}n`, tone: 'number' }
    case 'string':
      return { text: formatString(value, mode), tone: 'string' }
    case 'symbol':
      return { text: value.toString(), tone: 'symbol' }
    case 'function':
      return { text: formatFunction(value), tone: 'function' }
    default:
      break
  }
  if (value instanceof Date) {
    return {
      text: Number.isNaN(value.getTime())
        ? 'Invalid Date'
        : value.toISOString(),
      tone: 'date',
    }
  }
  if (value instanceof RegExp) return { text: String(value), tone: 'regexp' }
  if (isErrorValue(value)) {
    return { text: value.stack || String(value), tone: 'error' }
  }
  if (isElementValue(value)) {
    return { text: `<${value.tagName.toLowerCase()}>`, tone: 'text' }
  }
  return { text: collectionTag(value).tag, tone: 'text' }
}

export function collapsedPreview(
  value: unknown,
  hooks: InspectorHooks = {},
): string {
  return previewParts(value, hooks)
    .map((part) => part.text)
    .join('')
}

export function collectionPreviewBody(
  value: unknown,
  hooks: InspectorHooks = {},
): PreviewPart[] {
  const summary = collectionSummary(value, hooks)
  if (!summary) return []
  return previewBody(summary, hooks, closedPreviewLimit(summary))
}

export function previewParts(
  value: unknown,
  hooks: InspectorHooks = {},
): PreviewPart[] {
  const summary = collectionSummary(value, hooks)
  if (!summary) {
    const leaf = formatLeaf(value, 'shallow')
    return [{ text: leaf.text, tone: leaf.tone }]
  }
  return [
    {
      text: `${summary.tag}${summary.arrayish ? ' [' : ' {'}`,
      tone: 'text',
    },
    ...previewBody(summary, hooks, closedPreviewLimit(summary)),
    { text: summary.arrayish ? ']' : '}', tone: 'text' },
  ]
}

function closedPreviewLimit(summary: CollectionWalk): number {
  if (
    summary.arrayish ||
    summary.tag.startsWith('Map(') ||
    summary.tag.startsWith('Set(')
  ) {
    return PREVIEW_LIMIT
  }
  return OBJECT_PREVIEW_KEYS
}

function previewBody(
  summary: CollectionWalk,
  hooks: InspectorHooks,
  limit: number,
): PreviewPart[] {
  const parts: PreviewPart[] = []
  let count = 0
  let pendingEmpty = 0
  const flushEmpty = () => {
    if (pendingEmpty === 0) return
    pushSeparator(parts, count)
    parts.push({
      text: pendingEmpty === 1 ? 'empty' : `empty × ${pendingEmpty}`,
      tone: 'empty',
    })
    count += 1
    pendingEmpty = 0
  }
  for (const item of summary.preview()) {
    if (count >= limit) {
      flushEmpty()
      parts.push({ text: ', …', tone: 'text' })
      break
    }
    if (item.kind === 'empty') {
      pendingEmpty += item.count
      continue
    }
    flushEmpty()
    if (count >= limit) {
      parts.push({ text: ', …', tone: 'text' })
      break
    }
    pushSeparator(parts, count)
    if (item.kind === 'map') {
      parts.push(shallowPart(item.key, hooks))
      parts.push({ text: ' => ', tone: 'text' })
      parts.push(shallowPart(item.value, hooks))
    } else if (item.kind === 'value') {
      parts.push(shallowPart(item.value, hooks))
    } else {
      parts.push({ text: item.label, tone: 'key' })
      parts.push({ text: ': ', tone: 'text' })
      parts.push(shallowPart(item.value, hooks))
    }
    count += 1
  }
  flushEmpty()
  return parts
}

export function readFieldPage(
  value: unknown,
  hooks: InspectorHooks,
  limit: number,
): FieldPage | null {
  const summary = collectionSummary(value, hooks)
  if (!summary) return null
  const entries: InspectorEntry[] = []
  let truncated = false
  for (const entry of summary.fields()) {
    if (entries.length >= limit) {
      truncated = true
      break
    }
    entries.push(entry)
  }
  return {
    tag: summary.tag,
    arrayish: summary.arrayish,
    entries,
    truncated,
  }
}

export function collectionTagText(
  value: unknown,
  hooks: InspectorHooks = {},
): { tag: string; arrayish: boolean } | null {
  const summary = collectionSummary(value, hooks)
  if (!summary) return null
  return { tag: summary.tag, arrayish: summary.arrayish }
}

export interface InspectorFieldModel extends Rec {
  id: string
  fieldKey: string
  label: Atom<string>
  value: Atom<unknown>
  actions: Atom<readonly InspectorAction[]>
  tone: InspectorKeyTone
}

export function createInspectorFields(name: string) {
  let order: string[] = []
  const rows = reatomLinkedList(
    {
      key: 'id' as const,
      create: (entry: InspectorEntry) => {
        const id = entry.id ?? entry.key
        return {
          id,
          fieldKey: entry.key,
          label: atom(entry.label ?? entry.key, `${name}.${slot(id)}.label`),
          value: atom(entry.value, `${name}.${slot(id)}.value`),
          actions: atom<readonly InspectorAction[]>(
            entry.actions ?? [],
            `${name}.${slot(id)}.actions`,
          ),
          tone: entry.tone ?? 'key',
        }
      },
    },
    name,
  )
  const byId = new Map<string, ReturnType<typeof rows.create>>()

  const sync = (entries: readonly InspectorEntry[]) => {
    const seen = new Set<string>()
    const nextOrder: string[] = []
    rows.batch(() => {
      for (const entry of entries) {
        const id = entry.id ?? entry.key
        if (seen.has(id)) continue
        seen.add(id)
        nextOrder.push(id)
        const label = entry.label ?? entry.key
        const actions = entry.actions ?? []
        const existing = byId.get(id)
        if (!existing) {
          byId.set(id, rows.create({ ...entry, id, label, actions }))
          continue
        }
        if (peek(existing.label) !== label) existing.label.set(label)
        if (!Object.is(peek(existing.value), entry.value)) {
          existing.value.set(entry.value)
        }
        if (!sameActions(peek(existing.actions), actions)) {
          existing.actions.set(actions)
        }
      }
      for (const [id, node] of [...byId]) {
        if (seen.has(id)) continue
        rows.remove(node)
        byId.delete(id)
      }
      const orderChanged =
        nextOrder.length !== order.length ||
        nextOrder.some((id, index) => order[index] !== id)
      if (!orderChanged) return
      let after: ReturnType<typeof rows.create> | null = null
      for (const id of nextOrder) {
        const node = byId.get(id)
        if (!node) continue
        rows.move(node, after)
        after = node
      }
      order = nextOrder
    })
  }

  const clear = () => {
    if (byId.size === 0) return
    const nodes = [...byId.values()]
    rows.batch(() => {
      for (const node of nodes) rows.remove(node)
    })
    byId.clear()
    order = []
  }

  return { rows, sync, clear }
}

interface CollectionWalk {
  tag: string
  arrayish: boolean
  fields: () => Generator<InspectorEntry>
  preview: () => Generator<PreviewItem>
}

type PreviewItem =
  | { kind: 'empty'; count: number }
  | { kind: 'value'; value: unknown }
  | { kind: 'field'; label: string; value: unknown }
  | { kind: 'map'; key: unknown; value: unknown }

function collectionSummary(
  value: unknown,
  hooks: InspectorHooks,
): CollectionWalk | null {
  if (!isExpandableValue(value, hooks)) return null
  const object = value
  const custom = hooks.entries?.(object)
  if (custom) {
    const entries = custom.map((entry) => normalizeEntry(entry, hooks, false))
    return {
      tag: 'Object',
      arrayish: false,
      fields: function* () {
        yield* entries
      },
      preview: function* () {
        for (const entry of entries) {
          yield {
            kind: 'field',
            label: entry.label ?? entry.key,
            value: entry.value,
          }
        }
      },
    }
  }
  if (object instanceof Map) {
    return {
      tag: `Map(${safeSize(object)})`,
      arrayish: false,
      fields: () => walkMap(object, hooks),
      preview: () => previewMap(object),
    }
  }
  if (object instanceof Set) {
    return {
      tag: `Set(${safeSize(object)})`,
      arrayish: false,
      fields: () => walkSet(object, hooks),
      preview: () => previewSet(object),
    }
  }
  if (isArrayish(object)) {
    const typed = collectionTag(object)
    return {
      tag: `${typed.tag}(${object.length})`,
      arrayish: true,
      fields: () => walkArray(object, hooks),
      preview: () => previewArray(object, hooks),
    }
  }
  const tag = collectionTag(object).tag
  return {
    tag,
    arrayish: false,
    fields: () => walkObject(object, hooks),
    preview: () => previewObject(object, hooks),
  }
}

function* walkMap(
  map: Map<unknown, unknown>,
  hooks: InspectorHooks,
): Generator<InspectorEntry> {
  const used = new Set<string>()
  for (const [key, entryValue] of safeEntries(map)) {
    const label = mapKeyLabel(key)
    yield normalizeEntry(
      {
        id: uniqueId(used, `map:${valueKind(key)}:${valueIdentity(key)}`),
        key: label,
        label,
        value: entryValue,
        tone: 'key',
      },
      hooks,
      true,
    )
  }
  yield* walkObject(map, hooks)
}

function* previewMap(map: Map<unknown, unknown>): Generator<PreviewItem> {
  for (const [key, entryValue] of safeEntries(map)) {
    yield { kind: 'map', key, value: entryValue }
  }
}

function* walkSet(
  set: Set<unknown>,
  hooks: InspectorHooks,
): Generator<InspectorEntry> {
  const used = new Set<string>()
  let index = 0
  for (const entryValue of safeValues(set)) {
    const label = String(index)
    yield normalizeEntry(
      {
        id: uniqueId(
          used,
          `set:${valueKind(entryValue)}:${valueIdentity(entryValue)}`,
        ),
        key: label,
        label,
        value: entryValue,
        tone: 'index',
      },
      hooks,
      true,
    )
    index += 1
  }
  yield* walkObject(set, hooks)
}

function* previewSet(set: Set<unknown>): Generator<PreviewItem> {
  for (const entryValue of safeValues(set)) {
    yield { kind: 'value', value: entryValue }
  }
}

function* walkArray(
  list: ArrayLike<unknown> & object,
  hooks: InspectorHooks,
): Generator<InspectorEntry> {
  for (let index = 0; index < list.length; index += 1) {
    if (!(index in list)) continue
    const label = String(index)
    yield normalizeEntry(
      {
        id: `index:${label}`,
        key: label,
        label,
        value: readProperty(list, index),
        tone: 'index',
      },
      hooks,
      true,
    )
  }
  yield* walkNamed(list, hooks, true)
}

function* previewArray(
  list: ArrayLike<unknown> & object,
  hooks: InspectorHooks,
): Generator<PreviewItem> {
  let holes = 0
  for (let index = 0; index < list.length; index += 1) {
    if (!(index in list)) {
      holes += 1
      continue
    }
    if (holes > 0) {
      yield { kind: 'empty', count: holes }
      holes = 0
    }
    yield { kind: 'value', value: readProperty(list, index) }
  }
  if (holes > 0) yield { kind: 'empty', count: holes }
  for (const key of ownKeys(list)) {
    if (isIndexKey(key)) continue
    yield {
      kind: 'field',
      label: fieldLabel(key, readProperty(list, key), hooks),
      value: readProperty(list, key),
    }
  }
}

function* walkObject(
  object: object,
  hooks: InspectorHooks,
): Generator<InspectorEntry> {
  yield* walkNamed(object, hooks, false)
}

function* previewObject(
  object: object,
  hooks: InspectorHooks,
): Generator<PreviewItem> {
  for (const key of ownKeys(object)) {
    const entryValue = readProperty(object, key)
    yield {
      kind: 'field',
      label: fieldLabel(key, entryValue, hooks),
      value: entryValue,
    }
  }
  for (const symbol of Object.getOwnPropertySymbols(object)) {
    yield {
      kind: 'field',
      label: symbol.toString(),
      value: readProperty(object, symbol),
    }
  }
}

function* walkNamed(
  object: object,
  hooks: InspectorHooks,
  array: boolean,
): Generator<InspectorEntry> {
  for (const key of ownKeys(object)) {
    if (array && isIndexKey(key)) continue
    const entryValue = readProperty(object, key)
    yield normalizeEntry(
      {
        id: `key:${key}`,
        key,
        label: fieldLabel(key, entryValue, hooks),
        value: entryValue,
        tone: 'key',
      },
      hooks,
      true,
    )
  }
  const used = new Set<string>()
  for (const symbol of Object.getOwnPropertySymbols(object)) {
    const key = symbol.toString()
    const entryValue = readProperty(object, symbol)
    yield normalizeEntry(
      {
        id: uniqueId(used, `symbol:${key}`),
        key,
        label: key,
        value: entryValue,
        tone: 'symbol',
      },
      hooks,
      true,
    )
  }
}

function normalizeEntry(
  entry: InspectorEntry,
  hooks: InspectorHooks,
  applyHook: boolean,
): InspectorEntry {
  const key = entry.key
  const label = entry.label ?? key
  const actions = entry.actions
  return {
    ...entry,
    id: entry.id ?? key,
    key,
    label,
    tone: entry.tone ?? 'key',
    actions:
      actions !== undefined
        ? actions
        : applyHook
          ? (hooks.fieldActions?.(key, entry.value) ?? [])
          : [],
  }
}

function mapKeyLabel(key: unknown): string {
  if (typeof key === 'string') return JSON.stringify(key)
  return formatLeaf(key, 'shallow').text
}

function valueKind(value: unknown): string {
  if (value === null) return 'null'
  return typeof value
}

function valueIdentity(value: unknown): string {
  if (typeof value === 'string') return value
  return formatLeaf(value, 'shallow').text
}

function uniqueId(used: Set<string>, base: string): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let occurrence = 2
  let id = `${base}#${occurrence}`
  while (used.has(id)) {
    occurrence += 1
    id = `${base}#${occurrence}`
  }
  used.add(id)
  return id
}

function fieldLabel(
  key: string,
  value: unknown,
  hooks: InspectorHooks,
): string {
  return hooks.fieldLabel?.(key, value) ?? key
}

function shallowPart(value: unknown, hooks: InspectorHooks): PreviewPart {
  const summary = collectionSummary(value, hooks)
  if (summary) return { text: summary.tag, tone: 'text' }
  const leaf = formatLeaf(value, 'shallow')
  return { text: leaf.text, tone: leaf.tone }
}

function pushSeparator(parts: PreviewPart[], count: number) {
  if (count > 0) parts.push({ text: ', ', tone: 'text' })
}

function collectionTag(value: object): { tag: string } {
  const tagged = (value as { [Symbol.toStringTag]?: unknown })[
    Symbol.toStringTag
  ]
  if (typeof tagged === 'string' && tagged !== '') return { tag: tagged }
  const name = value.constructor?.name
  if (typeof name === 'string' && name !== '') return { tag: name }
  return { tag: 'Object' }
}

function isArrayish(value: object): value is ArrayLike<unknown> & object {
  if (Array.isArray(value)) return true
  return ArrayBuffer.isView(value) && !(value instanceof DataView)
}

function isIndexKey(key: string): boolean {
  return key === `${(key as unknown as number) | 0}`
}

function ownKeys(object: object): string[] {
  const keys: string[] = []
  for (const key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key)) keys.push(key)
  }
  return keys
}

function readProperty(object: object, key: PropertyKey): unknown {
  try {
    const value = (object as Record<PropertyKey, unknown>)[key]
    if (value && (typeof value === 'object' || typeof value === 'function')) {
      void (value as { constructor?: unknown }).constructor
    }
    return value
  } catch {
    return forbidden
  }
}

function isErrorValue(value: object): value is Error {
  if (value instanceof Error) return true
  const tag = typedArrayTag.call(value)
  return tag === '[object Error]' || tag === '[object DOMException]'
}

function isElementValue(value: object): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element
}

function safeSize(collection: Map<unknown, unknown> | Set<unknown>): number {
  try {
    return collection.size
  } catch {
    return 0
  }
}

function safeEntries(map: Map<unknown, unknown>): Array<[unknown, unknown]> {
  try {
    return [...map]
  } catch {
    return []
  }
}

function safeValues(set: Set<unknown>): unknown[] {
  try {
    return [...set]
  } catch {
    return []
  }
}

function formatString(value: string, mode: 'shallow' | 'full'): string {
  if (mode === 'full') return JSON.stringify(value)
  const shown =
    value.length > SHALLOW_STRING
      ? `${value.slice(0, 50)}…${value.slice(-49)}`
      : value
  return JSON.stringify(shown)
}

function formatFunction(value: Function): string {
  let source = ''
  try {
    source = Function.prototype.toString.call(value)
  } catch {
    source = ''
  }
  const ctor = value.constructor?.name
  const prefix =
    ctor === 'AsyncFunction'
      ? 'async ƒ'
      : ctor === 'AsyncGeneratorFunction'
        ? 'async ƒ*'
        : ctor === 'GeneratorFunction'
          ? 'ƒ*'
          : /^class\b/.test(source)
            ? 'class'
            : 'ƒ'
  if (prefix === 'class') return prefix
  const arrow = /^(?:async\s*)?(\w+)\s*=>/.exec(source)
  if (arrow?.[1]) return `${prefix}(${arrow[1]})`
  const args =
    /^(?:async\s*)?(?:function(?:\s*\*)?(?:\s*\w+)?\s*)?\(\s*([^)]*)\)/.exec(
      source,
    )
  if (args) {
    const list = args[1]?.trim() ?? ''
    if (list === '') return `${prefix}()`
    if (/^\w+(?:\s*,\s*\w+)*$/.test(list)) {
      return `${prefix}(${list.replace(/\s*,\s*/g, ', ')})`
    }
  }
  return `${prefix}(…)`
}

function sameActions(
  left: readonly InspectorAction[],
  right: readonly InspectorAction[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((action, index) => action.label === right[index]?.label)
}

function slot(id: string): string {
  return id.replace(/[^\w.-]+/g, '_')
}
