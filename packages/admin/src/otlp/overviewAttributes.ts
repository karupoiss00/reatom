import { quoteCalculatorValue } from './calculator.ts'
import { localValuesOf, type AdminRecord } from './ingest.ts'
import { recordValues } from './values.ts'

export type NameSegment = {
  label: string
  draft: string
}

export type AttributeEntry = {
  key: string
  value: unknown
}

export type AttributeGroupId =
  | 'reatom'
  | 'app'
  | 'exception'
  | 'other'
  | 'service'
  | 'deployment'
  | 'resource'

export type AttributeGroup = {
  id: AttributeGroupId
  label: string
  collapsed: boolean
  entries: AttributeEntry[]
}

const VALUE_KEYS = new Set(['reatom.params', 'reatom.payload'])

export function nameSegments(name: string): NameSegment[] {
  const parts = name.split(/[.#]/g).filter((part) => part.length > 0)
  if (parts.length === 0) {
    return [{ label: name, draft: `name:${quoteCalculatorValue(name)}` }]
  }
  return parts.map((label, index) => {
    const prefix = parts.slice(0, index + 1).join('.')
    return {
      label,
      draft: `name:${quoteCalculatorValue(`${prefix}*`)}`,
    }
  })
}

export function isMaskedOtlpValue(record: AdminRecord, field: 'params' | 'payload' | 'state'): boolean {
  if (localValuesOf(record) !== undefined) return false
  const values = recordValues(record)
  if (field === 'params') return isMaskedLiteral(values.params)
  if (field === 'payload') return isMaskedLiteral(values.payload)
  return isMaskedLiteral(values.state) || record.body === '***'
}

function isMaskedLiteral(value: unknown): boolean {
  return value === '***' || value === '["***"]' || value === '"***"'
}

export function groupedOverviewAttributes(
  record: AdminRecord,
  search: string,
): AttributeGroup[] {
  const needle = search.trim().toLowerCase()
  const matches = (key: string) =>
    needle === '' || key.toLowerCase().includes(needle)

  const reatom: AttributeEntry[] = []
  const app: AttributeEntry[] = []
  const exception: AttributeEntry[] = []
  const other: AttributeEntry[] = []
  for (const [key, value] of Object.entries(record.attributes)) {
    if (VALUE_KEYS.has(key)) continue
    if (!matches(key)) continue
    const entry = { key, value }
    if (key.startsWith('reatom.')) reatom.push(entry)
    else if (key.startsWith('app.')) app.push(entry)
    else if (key.startsWith('exception.')) exception.push(entry)
    else other.push(entry)
  }

  const service: AttributeEntry[] = []
  const deployment: AttributeEntry[] = []
  const resource: AttributeEntry[] = []
  for (const [key, value] of Object.entries(record.resource)) {
    if (!matches(key)) continue
    const entry = { key, value }
    if (key.startsWith('service.')) service.push(entry)
    else if (key.startsWith('deployment.')) deployment.push(entry)
    else resource.push(entry)
  }

  const groups: AttributeGroup[] = []
  const push = (
    id: AttributeGroupId,
    label: string,
    entries: AttributeEntry[],
    collapsed: boolean,
  ) => {
    if (entries.length === 0) return
    groups.push({ id, label, collapsed, entries })
  }
  push('reatom', 'reatom', reatom, false)
  push('app', 'app', app, false)
  push('exception', 'exception', exception, false)
  push('other', 'attributes', other, false)
  push('service', 'service', service, true)
  push('deployment', 'deployment', deployment, true)
  push('resource', 'resource', resource, true)
  return groups
}

export function filterByValueDraft(key: string, value: unknown): string {
  return `attr.${key}=${quoteCalculatorValue(stringifyAttrValue(value))}`
}

function stringifyAttrValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}
