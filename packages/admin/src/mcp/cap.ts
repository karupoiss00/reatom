import { stackCulprit } from '../otlp/ingest.ts'
import {
  ADMIN_MCP_MAX_BYTES,
  type AdminMcpHeader,
  type AdminMcpMiss,
  type AdminMcpTruncatedValue,
} from './types.ts'

const utf8 = new TextEncoder()

const IDENTITY_KEYS = new Set([
  'id',
  'traceId',
  'spanId',
  'parentSpanId',
  'frameId',
  'causeIds',
  'nextCursor',
  'sourceId',
  'recordId',
  'path',
  'name',
  'atomName',
  'label',
  'rootName',
])

export const ERROR_PATH_ATTRIBUTE_KEYS = new Set([
  'exception.type',
  'exception.message',
  'exception.stacktrace',
  'reatom.outcome',
  'reatom.params',
])

const ERROR_PATH_VALUE_KEYS = new Set(['type', 'message', 'stack', 'outcome'])

const ERROR_PATH_MAX_CHARS = 400
const CULPRIT_MAX_CHARS = 200

function isErrorPathKey(key: string | undefined): boolean {
  return (
    key !== undefined &&
    (ERROR_PATH_ATTRIBUTE_KEYS.has(key) || ERROR_PATH_VALUE_KEYS.has(key))
  )
}

function capErrorPathValue(value: unknown, key: string): unknown {
  if (typeof value !== 'string') return value
  if (key === 'exception.stacktrace' || key === 'stack') {
    return stackCulprit(value) ?? `${value.slice(0, CULPRIT_MAX_CHARS)}${value.length > CULPRIT_MAX_CHARS ? '…' : ''}`
  }
  return value.length > ERROR_PATH_MAX_CHARS
    ? `${value.slice(0, ERROR_PATH_MAX_CHARS)}…`
    : value
}

export function jsonUtf8Bytes(value: unknown): number {
  return utf8.encode(JSON.stringify(value)).length
}

export function decodeCursor(cursor: string | undefined): number {
  if (cursor == null || cursor === '') return 0
  const parsed = Number.parseInt(cursor, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

export function encodeCursor(offset: number): string {
  return String(offset)
}

export function isDomainAttributeKey(key: string): boolean {
  return key.startsWith('reatom.') || key.startsWith('app.')
}

export function copyAttributes(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return { ...attributes }
}

function isIdentityKey(key: string | undefined): boolean {
  return key !== undefined && IDENTITY_KEYS.has(key)
}

function mapStrings(
  value: unknown,
  maxChars: number,
  key?: string,
  protectErrorPath = false,
): unknown {
  if (isIdentityKey(key)) return value
  if (protectErrorPath && isErrorPathKey(key) && key !== undefined) {
    if (typeof value === 'string') return capErrorPathValue(value, key)
    if (Array.isArray(value)) {
      return value.map((item) => mapStrings(item, maxChars, undefined, true))
    }
    if (value && typeof value === 'object') {
      const next: Record<string, unknown> = {}
      for (const [innerKey, inner] of Object.entries(value)) {
        next[innerKey] = mapStrings(inner, maxChars, innerKey, true)
      }
      return next
    }
    return value
  }
  if (typeof value === 'string') {
    return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      mapStrings(item, maxChars, undefined, protectErrorPath),
    )
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const protectThis =
      protectErrorPath || record.hasError === true
    const next: Record<string, unknown> = {}
    for (const [innerKey, inner] of Object.entries(record)) {
      next[innerKey] = mapStrings(inner, maxChars, innerKey, protectThis)
    }
    return next
  }
  return value
}

export function truncateUnknown(value: unknown, maxChars: number): unknown {
  return mapStrings(value, maxChars)
}

export function shrinkAttributes(
  attributes: Record<string, unknown>,
  maxOtherChars: number,
  protectErrorPath = false,
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (protectErrorPath && ERROR_PATH_ATTRIBUTE_KEYS.has(key)) {
      next[key] = capErrorPathValue(value, key)
      continue
    }
    next[key] = truncateUnknown(value, maxOtherChars)
  }
  return next
}

function truncatedMarker(value: unknown): AdminMcpTruncatedValue {
  return { truncated: true, bytes: jsonUtf8Bytes(value) }
}

function markerBeatsValue(value: unknown): boolean {
  return jsonUtf8Bytes(truncatedMarker(value)) < jsonUtf8Bytes(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function markLargeAttributeValues(
  value: unknown,
  protectErrorPath = false,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => markLargeAttributeValues(item, protectErrorPath))
  }
  if (!isPlainObject(value)) return value
  const protectThis = protectErrorPath || value.hasError === true
  const next: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (isIdentityKey(key) || (protectThis && isErrorPathKey(key))) {
      next[key] = inner
      continue
    }
    if (key === 'attributes' && isPlainObject(inner)) {
      const marked: Record<string, unknown> = {}
      for (const [attrKey, attrValue] of Object.entries(inner)) {
        if (
          isIdentityKey(attrKey) ||
          (protectThis && ERROR_PATH_ATTRIBUTE_KEYS.has(attrKey))
        ) {
          marked[attrKey] = attrValue
          continue
        }
        marked[attrKey] = markerBeatsValue(attrValue)
          ? truncatedMarker(attrValue)
          : attrValue
      }
      next[key] = marked
      continue
    }
    if ((key === 'value' || key === 'body') && markerBeatsValue(inner)) {
      next[key] = truncatedMarker(inner)
      continue
    }
    next[key] = markLargeAttributeValues(inner, protectThis)
  }
  return next
}

function compactAttributesBag(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(attrs)
  const compact: Record<string, unknown> = {
    truncated: true,
    bytes: jsonUtf8Bytes(attrs),
    keys,
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (ERROR_PATH_ATTRIBUTE_KEYS.has(key)) {
      compact[key] = capErrorPathValue(value, key)
      continue
    }
    if (!key.startsWith('reatom.')) continue
    if (jsonUtf8Bytes(value) <= 64) compact[key] = value
  }
  return compact
}

function compactAttributeBags(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactAttributeBags)
  if (!isPlainObject(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value)) {
    if (key === 'attributes' && isPlainObject(inner)) {
      next[key] = compactAttributesBag(inner)
      continue
    }
    next[key] = compactAttributeBags(inner)
  }
  return next
}

export function shrinkPayloadToCap(payload: unknown): unknown {
  let current = payload
  for (const maxChars of [400, 120, 40]) {
    current = mapStrings(current, maxChars)
    if (jsonUtf8Bytes(current) <= ADMIN_MCP_MAX_BYTES) return current
  }
  current = markLargeAttributeValues(current)
  if (jsonUtf8Bytes(current) <= ADMIN_MCP_MAX_BYTES) return current
  current = compactAttributeBags(current)
  return current
}

export interface PackCappedOptions<T, R> {
  header: Omit<AdminMcpHeader, 'truncated' | 'valuesTruncated'>
  items: T[]
  offset: number
  limit?: number
  wrap: (input: {
    items: T[]
    header: AdminMcpHeader
    nextCursor?: string
  }) => R
  shrinkItem?: (item: T) => T
  missExtra?: { id?: string; path?: string }
}

function tooLargeMiss(
  header: Omit<AdminMcpHeader, 'truncated' | 'valuesTruncated'>,
  extra: { id?: string; path?: string } | undefined,
): AdminMcpMiss {
  return {
    ok: false,
    header: { ...header, truncated: false },
    headline: 'too large for the 20 KB cap',
    missing: 'too-large',
    ...extra,
  }
}

export function packCappedResponse<T, R>(
  options: PackCappedOptions<T, R>,
): R | AdminMcpMiss {
  const limit =
    options.limit === undefined
      ? options.items.length
      : Math.max(0, options.limit)
  const window = options.items.slice(0, limit)

  const build = (count: number, items: T[], valuesTruncated: boolean): R => {
    const more = count < options.items.length
    const header: AdminMcpHeader = {
      ...options.header,
      truncated: more,
      ...(valuesTruncated ? { valuesTruncated: true } : {}),
    }
    const nextCursor = more ? encodeCursor(options.offset + count) : undefined
    return options.wrap({ items, header, nextCursor })
  }

  if (window.length === 0) {
    return options.wrap({
      items: [],
      header: { ...options.header, truncated: false },
    })
  }

  let packed = build(window.length, window, false)
  if (jsonUtf8Bytes(packed) <= ADMIN_MCP_MAX_BYTES) return packed

  let lo = 1
  let hi = window.length
  let best = 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    packed = build(mid, window.slice(0, mid), false)
    if (jsonUtf8Bytes(packed) <= ADMIN_MCP_MAX_BYTES) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  packed = build(best, window.slice(0, best), false)
  if (jsonUtf8Bytes(packed) <= ADMIN_MCP_MAX_BYTES) return packed

  const first = options.shrinkItem ? options.shrinkItem(window[0]!) : window[0]!
  packed = build(1, [first], true)
  if (jsonUtf8Bytes(packed) <= ADMIN_MCP_MAX_BYTES) return packed

  packed = shrinkPayloadToCap(packed) as R
  if (jsonUtf8Bytes(packed) <= ADMIN_MCP_MAX_BYTES) return packed

  return tooLargeMiss(options.header, options.missExtra)
}
