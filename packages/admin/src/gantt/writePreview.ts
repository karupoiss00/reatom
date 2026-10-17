import { recordLabel, recordValuePreview } from '../otlp/bind'
import type { AdminRecord } from '../otlp/ingest'
import { recordValues } from '../otlp/values'
import { isUpdateLog } from './barMark'

const TEXT_CAP = 48

export type WritePreview = {
  name: string
  text: string
  title?: string
}

function isMaskedValue(value: unknown): boolean {
  return value === '***'
}

function scalarText(value: unknown): string | undefined {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'number' || type === 'boolean') return String(value)
  if (type === 'bigint') return (value as bigint).toString()
  return undefined
}

function objectKeys(value: unknown): string[] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  try {
    return Object.keys(value as Record<string, unknown>)
  } catch {
    return undefined
  }
}

function changedKeySummary(
  previous: unknown,
  next: unknown,
): { text: string; title: string } | undefined {
  const previousKeys = objectKeys(previous)
  const nextKeys = objectKeys(next)
  if (previousKeys === undefined || nextKeys === undefined) return undefined
  const previousRecord = previous as Record<string, unknown>
  const nextRecord = next as Record<string, unknown>
  const previousSet = new Set(previousKeys)
  const nextSet = new Set(nextKeys)
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  for (const key of nextKeys) {
    if (!previousSet.has(key)) added.push(key)
    else if (!Object.is(previousRecord[key], nextRecord[key])) changed.push(key)
  }
  for (const key of previousKeys) {
    if (!nextSet.has(key)) removed.push(key)
  }
  const plus = added.length + changed.length
  const minus = removed.length
  if (plus === 0 && minus === 0) return { text: 'unchanged', title: '' }
  const parts: string[] = []
  if (plus > 0) parts.push(`+${plus}`)
  if (minus > 0) parts.push(`−${minus}`)
  const keys = [...added, ...changed, ...removed]
  return { text: parts.join(' '), title: keys.join(', ') }
}

function clip(text: string): string {
  if (text.length <= TEXT_CAP) return text
  return `${text.slice(0, TEXT_CAP - 1)}…`
}

export function previousWrite(
  record: AdminRecord,
  records: readonly AdminRecord[] | Map<string, AdminRecord>,
): AdminRecord | undefined {
  if (records instanceof Map) return records.get(record.id)
  if (record.atomName === undefined) return undefined
  let previous: AdminRecord | undefined
  for (const entry of records) {
    if (entry.atomName !== record.atomName) continue
    if (entry.sourceId !== record.sourceId) continue
    if (entry.id === record.id) continue
    if (entry.start > record.start) continue
    if (
      previous === undefined ||
      entry.start > previous.start ||
      (entry.start === previous.start && entry.id > previous.id)
    ) {
      previous = entry
    }
  }
  return previous
}

export function formatWritePreview(
  record: AdminRecord,
  records: readonly AdminRecord[] | Map<string, AdminRecord>,
): WritePreview | undefined {
  if (!isUpdateLog(record)) return undefined
  const name = recordLabel(record)
  const values = recordValues(record)
  const next = recordValuePreview(record)
  const previousRecord = previousWrite(record, records)
  const previous =
    previousRecord === undefined
      ? undefined
      : recordValuePreview(previousRecord)
  if (
    isMaskedValue(next) ||
    (values.source === 'otlp' &&
      (record.body === '***' ||
        record.attributes['reatom.payload'] === '***' ||
        record.attributes['reatom.params'] === '***'))
  ) {
    return { name, text: 'masked' }
  }
  if (previousRecord !== undefined && isMaskedValue(previous)) {
    return { name, text: 'masked' }
  }
  const objectDiff =
    previous === undefined ? undefined : changedKeySummary(previous, next)
  if (objectDiff) {
    return {
      name,
      text: clip(objectDiff.text),
      title: objectDiff.title === '' ? undefined : objectDiff.title,
    }
  }
  const nextText = scalarText(next)
  if (previousRecord === undefined) {
    const keys = objectKeys(next)
    if (keys !== undefined) {
      return { name, text: clip(`+${keys.length}`), title: keys.join(', ') }
    }
    if (nextText === undefined) return { name, text: 'masked' }
    return { name, text: clip(nextText) }
  }
  if (nextText === undefined) {
    return { name, text: 'masked' }
  }
  const previousText = scalarText(previous)
  if (previousText === undefined) return { name, text: 'masked' }
  return { name, text: clip(`${previousText} → ${nextText}`) }
}

export function formatWriteTickTitle(
  record: AdminRecord,
  records: readonly AdminRecord[] | Map<string, AdminRecord>,
): string {
  const preview = formatWritePreview(record, records)
  if (preview === undefined) return recordLabel(record)
  return `${preview.name}: ${preview.text}`
}
