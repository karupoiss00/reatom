import { stringifyJson } from '../serialize'

import type { FilterMode } from '../types'

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const clock = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const millis = String(date.getMilliseconds()).padStart(3, '0')
  return `${clock}.${millis}`
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function formatJson(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (value instanceof Error) {
    return [value.name, value.message, value.stack ?? ''].join('\n')
  }
  if (value instanceof URL) return value.href

  try {
    return stringifyJson(value, 2)!
  } catch {
    return String(value)
  }
}

function isCompactPreview(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  return !(value instanceof Error) && !(value instanceof URL)
}

function compactJson(value: unknown): string {
  try {
    return stringifyJson(value, 1)!
      .replace(/[[{]\n\s*/g, (segment) => segment.charAt(0))
      .replace(/\n\s*[\]}]/g, (segment) => segment.slice(-1))
      .replace(/\n\s*/g, ' ')
  } catch {
    return String(value)
  }
}

export function formatPreview(value: unknown, maxLength: number = 88): string {
  const raw = isCompactPreview(value) ? compactJson(value) : formatJson(value)
  const resolved = raw.replace(/\s+/g, ' ').trim()
  if (resolved.length <= maxLength) return resolved
  return `${resolved.slice(0, maxLength - 1)}…`
}

export function formatModeLabel(mode: FilterMode): string {
  switch (mode) {
    case 'show':
      return 'Show only'
    case 'hide':
      return 'Hide'
    case 'highlight':
      return 'Highlight'
    case 'exclude':
      return 'Exclude'
    default:
      return mode
  }
}

export function formatRelativeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
