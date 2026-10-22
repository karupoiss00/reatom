import { action, atom, computed, reatomBoolean } from '@reatom/core'

const PREFIX = '_Admin.otlp'

const ATOMS_WITH_NAME = new Set(['action', 'atom', 'computed', 'effect'])

const OUTCOMES = new Set(['ok', 'error', 'abort', 'suspense', 'pending'])

export type AdminRecordKind = 'span' | 'log'

export type AdminReatomKind =
  | 'action'
  | 'atom'
  | 'computed'
  | 'effect'
  | 'route'
  | 'loader'
  | 'render'
  | 'mount'
  | 'session'
  | 'page_view'

export type AdminRecordOutcome =
  'ok' | 'error' | 'abort' | 'suspense' | 'pending'

export interface AdminRecordLink {
  traceId: string
  spanId: string
  reason?: 'computed.dependency' | 'route.page'
  frameId?: string
}

export interface AdminRecordError {
  type?: string
  message?: string
  stack?: string
}

/**
 * Symbol slot for live params, payload, state, and error. JSON and
 * `Object.entries` skip it, so exports stay masked. Object spread copies the
 * reference, so undo and restore keep it.
 */
export const LOCAL_VALUES: unique symbol = Symbol('reatom.admin.localValues')

/** Live JavaScript values captured for one admin record. */
export interface AdminLocalValues {
  params?: readonly unknown[]
  payload?: unknown
  state?: unknown
  error?: unknown
}

export interface AdminRecord {
  id: string
  sourceId: string
  kind: AdminRecordKind
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  start: number
  end?: number
  attributes: Record<string, unknown>
  body?: unknown
  resource: Record<string, unknown>
  links: AdminRecordLink[]
  reatomKind?: AdminReatomKind
  frameId?: string
  causeIds: string[]
  atomName?: string
  eventName?: string
  outcome?: AdminRecordOutcome
  error?: AdminRecordError
  [LOCAL_VALUES]?: AdminLocalValues
}

/** Live values for `record`, when ingest attached them. */
export function localValuesOf(
  record: AdminRecord,
): AdminLocalValues | undefined {
  return record[LOCAL_VALUES]
}

const localValuesTextCache = new WeakMap<AdminRecord, string>()

export function localValuesTextOf(
  record: AdminRecord,
  render: (values: AdminLocalValues) => string,
): string {
  const values = record[LOCAL_VALUES]
  if (values === undefined) return ''
  const cached = localValuesTextCache.get(record)
  if (cached !== undefined) return cached
  const text = render(values)
  localValuesTextCache.set(record, text)
  return text
}

function forgetLocalValues(record: AdminRecord) {
  delete record[LOCAL_VALUES]
  localValuesTextCache.delete(record)
}

const DEFAULT_LOCAL_VALUES_LIMIT = 5000

function normalizeLocalValuesLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LOCAL_VALUES_LIMIT
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.floor(limit)
}

export interface OtlpStoreOptions {
  sourceId: string
  resource: Record<string, unknown>
  onClear?: () => void
  /**
   * Resolves live values for a raw OTLP item. `undefined` leaves the record
   * masked.
   */
  localValues?: (raw: unknown) => AdminLocalValues | undefined
  /**
   * How many newest records keep live values. Older ones fall back to masked
   * attributes. Default 5000.
   */
  localValuesLimit?: number
}

export function reatomOtlpStore(options: OtlpStoreOptions) {
  const sourceId = options.sourceId
  let resource = { ...options.resource }
  const records = atom<AdminRecord[]>([], `${PREFIX}.records`)
  const paused = reatomBoolean(false, `${PREFIX}.paused`)
  const localValuesTrimmed = atom(false, `${PREFIX}.localValuesTrimmed`)
  const localValuesLimit = normalizeLocalValuesLimit(options.localValuesLimit)
  let localValuesLookup = options.localValues
  const valuedRecords: AdminRecord[] = []
  let valuedHead = 0
  let nextSeq = 0

  const setResource = (next: Record<string, unknown>) => {
    resource = { ...next }
  }

  /**
   * Replaces the lookup used for later ingests. `undefined` stops attaching new
   * values.
   */
  const setLocalValues = (lookup: OtlpStoreOptions['localValues']) => {
    localValuesLookup = lookup
  }

  const takeLocalValues = (raw: unknown): AdminLocalValues | undefined => {
    const lookup = localValuesLookup
    if (lookup === undefined) return undefined
    const values = lookup(raw)
    if (values == null) return undefined
    return values
  }

  const rememberLocalValues = (record: AdminRecord) => {
    if (record[LOCAL_VALUES] !== undefined) valuedRecords.push(record)
  }

  const trimLocalValues = () => {
    const overflow = valuedRecords.length - valuedHead - localValuesLimit
    if (overflow <= 0) return
    for (let index = 0; index < overflow; index += 1) {
      const record = valuedRecords[valuedHead + index]
      if (record) forgetLocalValues(record)
    }
    valuedHead += overflow
    if (valuedHead > 1024) {
      valuedRecords.splice(0, valuedHead)
      valuedHead = 0
    }
    localValuesTrimmed.set(true)
  }

  const resetLocalValues = () => {
    valuedRecords.length = 0
    valuedHead = 0
    localValuesTrimmed.set(false)
  }

  const recordsFromIncoming = (
    incoming: readonly unknown[],
    existing: readonly AdminRecord[],
  ) => {
    const batch: AdminRecord[] = []
    for (const item of incoming) {
      const record = isAdminRecord(item)
        ? copyAdminRecord(item)
        : toAdminRecord(
            item,
            sourceId,
            resource,
            nextSeq,
            takeLocalValues(item),
          )
      if (record) {
        nextSeq += 1
        rememberLocalValues(record)
        batch.push(record)
      }
    }
    joinExceptionLogs(batch, existing)
    trimLocalValues()
    return batch
  }

  const ingest = action((incoming: readonly unknown[]) => {
    if (paused()) return
    const batch = recordsFromIncoming(incoming, records())
    records.set((current) => current.concat(batch))
  }, `${PREFIX}.ingest`)

  const replace = action((incoming: readonly unknown[]) => {
    nextSeq = 0
    resetLocalValues()
    records.set(recordsFromIncoming(incoming, []))
  }, `${PREFIX}.replace`)

  const restoreRecords = action((previous: readonly AdminRecord[]) => {
    const next = [...previous, ...records()]
    records.set(next)
    valuedRecords.length = 0
    valuedHead = 0
    for (const record of next) {
      if (record[LOCAL_VALUES] !== undefined) valuedRecords.push(record)
    }
    trimLocalValues()
  }, `${PREFIX}.restoreRecords`)

  const clear = action(() => {
    records.set([])
    nextSeq = 0
    resetLocalValues()
    options.onClear?.()
  }, `${PREFIX}.clear`)

  const byTraceIndex = computed(() => {
    const index = new Map<string, AdminRecord[]>()
    for (const record of records()) {
      appendIndexed(index, record.traceId, record)
    }
    return index
  }, `${PREFIX}.byTrace`)

  const bySpanIndex = computed(() => {
    const index = new Map<string, AdminRecord[]>()
    for (const record of records()) {
      appendIndexed(index, record.spanId, record)
    }
    return index
  }, `${PREFIX}.bySpan`)

  const byFrameIndex = computed(() => {
    const index = new Map<string, AdminRecord[]>()
    for (const record of records()) {
      if (record.frameId !== undefined) {
        appendIndexed(index, record.frameId, record)
      }
    }
    return index
  }, `${PREFIX}.byFrame`)

  const byAtomIndex = computed(() => {
    const index = new Map<string, AdminRecord[]>()
    for (const record of records()) {
      if (record.atomName !== undefined) {
        appendIndexed(index, record.atomName, record)
      }
    }
    return index
  }, `${PREFIX}.byAtom`)

  const byNameIndex = computed(() => {
    const index = new Map<string, AdminRecord[]>()
    for (const record of records()) {
      if (record.name !== '') {
        appendIndexed(index, record.name, record)
      }
    }
    return index
  }, `${PREFIX}.byName`)

  const byTrace = (traceId: string) => byTraceIndex().get(traceId) ?? []
  const bySpan = (spanId: string) => bySpanIndex().get(spanId) ?? []
  const byFrame = (frameId: string) => byFrameIndex().get(frameId) ?? []
  const byAtom = (atomName: string) => byAtomIndex().get(atomName) ?? []
  const byName = (name: string) => byNameIndex().get(name) ?? []

  return {
    ingest,
    replace,
    restoreRecords,
    setResource,
    setLocalValues,
    localValuesTrimmed,
    records,
    byTrace,
    bySpan,
    byFrame,
    byAtom,
    byName,
    paused,
    clear,
  }
}

function appendIndexed(
  index: Map<string, AdminRecord[]>,
  key: string,
  record: AdminRecord,
) {
  const list = index.get(key)
  if (list) list.push(record)
  else index.set(key, [record])
}

function decodeIntValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  if (!/^-?(?:0|[1-9]\d*)$/.test(raw)) return raw
  if (raw === '-0') return -0
  const asNumber = Number(raw)
  if (Number.isSafeInteger(asNumber) && String(asNumber) === raw)
    return asNumber
  return BigInt(raw)
}

function decodeOtlpValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(decodeOtlpValue)
  const encoded = value as Record<string, unknown>
  if ('stringValue' in encoded) return encoded.stringValue
  if ('intValue' in encoded) return decodeIntValue(encoded.intValue)
  if ('boolValue' in encoded) return encoded.boolValue
  if ('doubleValue' in encoded) return encoded.doubleValue
  if ('bytesValue' in encoded) return encoded.bytesValue
  if ('arrayValue' in encoded) {
    const values =
      (encoded.arrayValue as { values?: unknown[] } | undefined)?.values ?? []
    return values.map(decodeOtlpValue)
  }
  if ('kvlistValue' in encoded) {
    const entries =
      (
        encoded.kvlistValue as {
          values?: Array<{ key: string; value: unknown }>
        }
      )?.values ?? []
    const nested: Record<string, unknown> = {}
    for (const entry of entries) {
      if (typeof entry?.key === 'string') {
        nested[entry.key] = decodeOtlpValue(entry.value)
      }
    }
    return nested
  }
  return value
}

function decodeAttributes(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const attributes: Record<string, unknown> = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const entry = item as { key?: unknown; value?: unknown }
      if (typeof entry.key === 'string') {
        attributes[entry.key] = decodeOtlpValue(entry.value)
      }
    }
    return attributes
  }
  if (raw && typeof raw === 'object') {
    const attributes: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) {
      attributes[key] = decodeOtlpValue(value)
    }
    return attributes
  }
  return {}
}

function unixNanoToMs(value: unknown): number | undefined {
  try {
    if (typeof value === 'bigint') return Number(value / 1_000_000n)
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number(BigInt(Math.trunc(value)) / 1_000_000n)
    }
    if (typeof value === 'string' && value !== '') {
      return Number(BigInt(value) / 1_000_000n)
    }
  } catch {
    return undefined
  }
  return undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item))
}

function decodeLinks(raw: unknown): AdminRecordLink[] {
  if (!Array.isArray(raw)) return []
  const links: AdminRecordLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.traceId !== 'string' || typeof entry.spanId !== 'string') {
      continue
    }
    const attributes = decodeAttributes(entry.attributes)
    const reasonValue = attributes['reatom.link.reason']
    const frameIdValue = attributes['reatom.frame.id']
    const link: AdminRecordLink = {
      traceId: entry.traceId,
      spanId: entry.spanId,
    }
    if (reasonValue === 'computed.dependency' || reasonValue === 'route.page') {
      link.reason = reasonValue
    }
    if (typeof frameIdValue === 'string') {
      link.frameId = frameIdValue
    }
    links.push(link)
  }
  return links
}

export function errorFromExceptionLog(record: AdminRecord): AdminRecordError {
  const type = record.attributes['exception.type']
  const message = record.attributes['exception.message']
  const stack = record.attributes['exception.stacktrace']
  const error: AdminRecordError = {}
  if (typeof type === 'string') error.type = type
  if (typeof message === 'string') error.message = message
  if (typeof stack === 'string') error.stack = stack
  return error
}

function sameExceptionSpan(left: AdminRecord, right: AdminRecord): boolean {
  return left.spanId === right.spanId && left.traceId === right.traceId
}

function joinExceptionLogs(
  batch: AdminRecord[],
  existing: readonly AdminRecord[],
) {
  const batchExceptions: AdminRecord[] = []
  const batchSpans: AdminRecord[] = []
  for (const record of batch) {
    if (record.kind === 'log' && record.eventName === 'exception') {
      batchExceptions.push(record)
    } else if (record.kind === 'span') {
      batchSpans.push(record)
    }
  }
  if (batchExceptions.length === 0 && batchSpans.length === 0) return

  const joined = new Set<AdminRecord>()
  for (const exception of batchExceptions) {
    const error = errorFromExceptionLog(exception)
    for (const span of batchSpans) {
      if (!sameExceptionSpan(span, exception)) continue
      span.error = error
      joined.add(span)
    }
    for (const record of existing) {
      if (record.kind === 'span' && sameExceptionSpan(record, exception)) {
        record.error = error
      }
    }
  }

  for (const span of batchSpans) {
    if (joined.has(span)) continue
    for (const record of existing) {
      if (
        record.kind === 'log' &&
        record.eventName === 'exception' &&
        sameExceptionSpan(record, span)
      ) {
        span.error = errorFromExceptionLog(record)
      }
    }
  }
}

function isAdminRecord(item: unknown): item is AdminRecord {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const record = item as Partial<AdminRecord>
  if (record.kind !== 'span' && record.kind !== 'log') return false
  if (typeof record.traceId !== 'string' || typeof record.spanId !== 'string') {
    return false
  }
  if (typeof record.name !== 'string' || typeof record.start !== 'number') {
    return false
  }
  const attributes = record.attributes
  return (
    !!attributes && typeof attributes === 'object' && !Array.isArray(attributes)
  )
}

function copyAdminRecord(record: AdminRecord): AdminRecord {
  const copy: AdminRecord = {
    ...record,
    attributes: { ...record.attributes },
    resource: { ...record.resource },
    links: (record.links ?? []).map((link) => ({ ...link })),
    causeIds: [...(record.causeIds ?? [])],
    ...(record.error ? { error: { ...record.error } } : {}),
  }
  const values = record[LOCAL_VALUES]
  if (values !== undefined) copy[LOCAL_VALUES] = values
  return copy
}

function toAdminRecord(
  raw: unknown,
  sourceId: string,
  resource: Record<string, unknown>,
  seq: number,
  localValues?: AdminLocalValues,
): AdminRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const item = raw as Record<string, unknown>
  const kind: AdminRecordKind | undefined =
    typeof item.eventName === 'string'
      ? 'log'
      : typeof item.name === 'string' && item.startTimeUnixNano != null
        ? 'span'
        : undefined
  if (kind === undefined) return undefined
  if (typeof item.traceId !== 'string' || typeof item.spanId !== 'string') {
    return undefined
  }

  const attributes = decodeAttributes(item.attributes)
  const itemResource = decodeAttributes(item.resource)
  const itemServiceName = itemResource['service.name']
  const recordSourceId =
    typeof itemServiceName === 'string' && itemServiceName !== ''
      ? `${sourceId}:${itemServiceName}`
      : sourceId
  const reatomKind =
    typeof attributes['reatom.kind'] === 'string'
      ? (attributes['reatom.kind'] as AdminReatomKind)
      : undefined
  const frameId =
    typeof attributes['reatom.frame.id'] === 'string'
      ? attributes['reatom.frame.id']
      : undefined
  const reatomName =
    typeof attributes['reatom.name'] === 'string'
      ? attributes['reatom.name']
      : undefined
  const outcomeRaw = attributes['reatom.outcome']
  const start =
    unixNanoToMs(item.startTimeUnixNano) ?? unixNanoToMs(item.timeUnixNano) ?? 0
  const end = unixNanoToMs(item.endTimeUnixNano)
  const name =
    kind === 'span' && typeof item.name === 'string'
      ? item.name
      : (reatomName ??
        (typeof item.eventName === 'string' ? item.eventName : ''))

  const eventName =
    kind === 'log' && typeof item.eventName === 'string'
      ? item.eventName
      : undefined

  const record: AdminRecord = {
    id: `${recordSourceId}:${kind}:${item.spanId}:${frameId ?? start}:${eventName ?? ''}:${seq}`,
    sourceId: recordSourceId,
    kind,
    traceId: item.traceId,
    spanId: item.spanId,
    name,
    start,
    attributes,
    resource,
    links: decodeLinks(item.links),
    causeIds: asStringArray(attributes['reatom.cause.ids']),
  }

  if (typeof item.parentSpanId === 'string') {
    record.parentSpanId = item.parentSpanId
  }
  if (kind === 'span' && end !== undefined) record.end = end
  if (kind === 'log' && eventName !== undefined) {
    record.eventName = eventName
    if ('body' in item) record.body = decodeOtlpValue(item.body)
  }
  if (reatomKind !== undefined) record.reatomKind = reatomKind
  if (frameId !== undefined) record.frameId = frameId
  if (reatomName !== undefined && ATOMS_WITH_NAME.has(reatomKind ?? '')) {
    record.atomName = reatomName
  }
  if (typeof outcomeRaw === 'string' && OUTCOMES.has(outcomeRaw)) {
    record.outcome = outcomeRaw as AdminRecordOutcome
  }
  if (localValues !== undefined) record[LOCAL_VALUES] = localValues

  const status = item.status
  if (status && typeof status === 'object' && !Array.isArray(status)) {
    const statusRecord = status as Record<string, unknown>
    const code = Number(statusRecord.code)
    if (code === 2) {
      if (record.outcome === undefined) record.outcome = 'error'
      if (record.error === undefined) {
        const message = statusRecord.message
        record.error = {
          message:
            typeof message === 'string' && message !== '' ? message : undefined,
        }
      }
    }
  }

  if (
    record.outcome !== 'abort' &&
    record.outcome !== 'suspense' &&
    record.outcome !== 'error' &&
    record.error === undefined
  ) {
    const failure = capturedFailure(record)
    if (failure) {
      record.outcome = 'error'
      record.error = failure
    }
  }

  return record
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field !== '' ? field : undefined
}

function readPayload(record: AdminRecord): unknown {
  const raw = record.attributes['reatom.payload']
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function capturedFailure(
  record: AdminRecord,
): { message: string; type?: string } | undefined {
  const value = readPayload(record)
  const name = record.atomName ?? record.name
  if (
    name.endsWith('.title') &&
    name.includes('features.errors.card') &&
    typeof value === 'string' &&
    value !== ''
  ) {
    return { message: value, type: 'error-card' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const payload = value as Record<string, unknown>
  if (name.endsWith('.error')) {
    const message =
      stringField(payload, 'title') ?? stringField(payload, 'message')
    if (!message) return undefined
    const type = stringField(payload, 'kind')
    return type ? { message, type } : { message }
  }
  if (payload.type !== 'failed') return undefined
  const message =
    stringField(payload, 'title') ?? stringField(payload, 'message')
  if (!message) return undefined
  return { message, type: 'failed' }
}
