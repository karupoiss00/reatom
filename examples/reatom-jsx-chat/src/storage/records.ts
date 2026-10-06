import { tabId } from '../platform/env'
import type { TabId } from '../platform/types'
import type {
  ChatId,
  ChatMetaField,
  ChatRecord,
  ChatSettings,
  PresetId,
  PrivacySettings,
} from './types'

export const defaultGlobalPrivacy: PrivacySettings = {
  denyDataCollection: true,
  zdr: false,
}

export const createDefaultChatSettings = (): ChatSettings => ({
  systemPrompt: '',
  params: {},
  privacyOverride: null,
  routing: { mode: 'auto', allowFallbacks: true },
  webSearch: false,
})

export const chatMetaFields: readonly ChatMetaField[] = [
  'title',
  'titleSource',
  'lastActivityAt',
  'pinnedAt',
  'model',
  'presetId',
  'settings',
  'selection',
  'deletedAt',
  'deletedByTab',
]

export const createChatRecord = (input: {
  id: ChatId
  at: number
  title?: string
  model?: string | null
  presetId?: PresetId | null
  settings?: ChatSettings
  imported?: boolean
}): ChatRecord => ({
  id: input.id,
  createdAt: input.at,
  title: input.title ?? 'New chat',
  titleSource: 'auto',
  lastActivityAt: input.at,
  pinnedAt: null,
  model: input.model ?? null,
  presetId: input.presetId ?? null,
  settings: input.settings ?? createDefaultChatSettings(),
  selection: {},
  deletedAt: null,
  deletedByTab: null,
  imported: input.imported ?? false,
  clock: {},
})

type ClockBag = Record<string, number | string | undefined>

const settingsSubFields = [
  'systemPrompt',
  'params',
  'privacyOverride',
  'routing',
  'webSearch',
] as const satisfies readonly (keyof ChatSettings)[]

const asClockBag = (clock: ChatRecord['clock']): ClockBag => clock as ClockBag

const writerKey = (field: string) => `${field}@by`

const settingsClockKey = (field: (typeof settingsSubFields)[number]) =>
  `settings.${field}`

const clockAt = (clock: ChatRecord['clock'], field: string) => {
  const value = asClockBag(clock)[field]
  return typeof value === 'number' ? value : undefined
}

const readWriter = (clock: ChatRecord['clock'], field: string) => {
  const writer = asClockBag(clock)[writerKey(field)]
  return typeof writer === 'string' ? writer : undefined
}

const writeStamp = (
  clock: ChatRecord['clock'],
  field: string,
  at: number,
  writer: string,
) => {
  const bag = asClockBag(clock)
  bag[field] = at
  bag[writerKey(field)] = writer
}

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null
  ) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }
    return left.every((item, index) => sameValue(item, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  if (leftKeys.length !== Object.keys(rightRecord).length) return false
  return leftKeys.every((key) => sameValue(leftRecord[key], rightRecord[key]))
}

const liveTabId = () => tabId

const laterStampWins = (
  at: number,
  writer: string,
  storedAt: number,
  storedWriter: string | undefined,
) => {
  if (at > storedAt) return true
  if (at < storedAt) return false
  if (!storedWriter || storedWriter === writer) return true
  return writer < storedWriter
}

const tiePrefersIncoming = (
  local: ChatRecord,
  incoming: ChatRecord,
  field: string,
) => {
  const mine = liveTabId()
  const localWriter = readWriter(local.clock, field) ?? mine
  const incomingWriter = readWriter(incoming.clock, field) ?? mine
  if (localWriter === incomingWriter) return true
  return incomingWriter < localWriter
}

const fieldAt = (record: ChatRecord, field: string) =>
  clockAt(record.clock, field) ?? Number.NEGATIVE_INFINITY

const hasSettingsSubClocks = (clock: ChatRecord['clock']) =>
  settingsSubFields.some(
    (field) => clockAt(clock, settingsClockKey(field)) !== undefined,
  )

const settingsSubAt = (
  record: ChatRecord,
  field: (typeof settingsSubFields)[number],
) => {
  const specific = clockAt(record.clock, settingsClockKey(field))
  if (specific !== undefined) return specific
  if (hasSettingsSubClocks(record.clock)) return Number.NEGATIVE_INFINITY
  return fieldAt(record, 'settings')
}

const refreshSettingsClock = (clock: ChatRecord['clock']) => {
  let max = clockAt(clock, 'settings') ?? Number.NEGATIVE_INFINITY
  for (const field of settingsSubFields) {
    const at = clockAt(clock, settingsClockKey(field))
    if (at !== undefined && at > max) max = at
  }
  if (max !== Number.NEGATIVE_INFINITY) asClockBag(clock).settings = max
}

const cloneSettingsValue = <T>(value: T): T => structuredClone(value)

const assignSettingsField = (
  settings: ChatSettings,
  field: (typeof settingsSubFields)[number],
  value: ChatSettings[(typeof settingsSubFields)[number]],
) => {
  ;(settings as unknown as Record<string, unknown>)[field] = value
}

const mergeSettings = (
  stored: ChatSettings,
  incoming: ChatSettings,
  at: number,
  clock: ChatRecord['clock'],
): ChatSettings => {
  const defaults = createDefaultChatSettings()
  const changed = settingsSubFields.filter(
    (field) => !sameValue(stored[field], incoming[field]),
  )
  const next: ChatSettings = { ...stored, params: { ...stored.params } }
  const writer = liveTabId()
  for (const field of settingsSubFields) {
    if (sameValue(stored[field], incoming[field])) continue
    const revertsToDefault =
      sameValue(incoming[field], defaults[field]) &&
      !sameValue(stored[field], defaults[field])
    // A tab that only changed webSearch still sends the other defaults.
    // Keep a stored non-default unless clearing that sub-field is the only change.
    if (revertsToDefault && changed.length !== 1) continue
    const key = settingsClockKey(field)
    const storedAt =
      clockAt(clock, key) ??
      (hasSettingsSubClocks(clock) ? undefined : clockAt(clock, 'settings')) ??
      Number.NEGATIVE_INFINITY
    if (!laterStampWins(at, writer, storedAt, readWriter(clock, key))) continue
    assignSettingsField(next, field, cloneSettingsValue(incoming[field]))
    writeStamp(clock, key, at, writer)
  }
  refreshSettingsClock(clock)
  return next
}

const assignField = (record: ChatRecord, field: string, value: unknown) => {
  ;(record as unknown as Record<string, unknown>)[field] = value
}

export const mergeChatFields = (
  stored: ChatRecord,
  fields: Partial<Omit<ChatRecord, 'id' | 'clock'>>,
  at: number,
): ChatRecord => {
  const clock: ChatRecord['clock'] = { ...stored.clock }
  const merged: ChatRecord = { ...stored, clock }
  const writer = liveTabId()
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (field === 'settings') {
      merged.settings = mergeSettings(
        stored.settings,
        value as ChatSettings,
        at,
        clock,
      )
      continue
    }
    const storedAt = fieldAt(stored, field)
    if (!laterStampWins(at, writer, storedAt, readWriter(stored.clock, field))) {
      continue
    }
    assignField(merged, field, value)
    writeStamp(clock, field, at, writer)
  }
  return merged
}

const mergeSettingsRecords = (
  local: ChatRecord,
  incoming: ChatRecord,
  clock: ChatRecord['clock'],
): ChatSettings => {
  const next: ChatSettings = {
    ...local.settings,
    params: { ...local.settings.params },
  }
  for (const field of settingsSubFields) {
    const key = settingsClockKey(field)
    const localAt = settingsSubAt(local, field)
    const incomingAt = settingsSubAt(incoming, field)
    if (
      incomingAt === Number.NEGATIVE_INFINITY &&
      localAt === Number.NEGATIVE_INFINITY
    ) {
      continue
    }
    if (incomingAt < localAt) continue
    if (incomingAt === localAt && !tiePrefersIncoming(local, incoming, key)) {
      continue
    }
    assignSettingsField(next, field, cloneSettingsValue(incoming.settings[field]))
    const stampAt = Math.max(incomingAt, localAt)
    const stampWriter =
      (incomingAt > localAt
        ? readWriter(incoming.clock, key)
        : readWriter(incoming.clock, key) ?? readWriter(local.clock, key)) ??
      liveTabId()
    if (stampAt !== Number.NEGATIVE_INFINITY) {
      writeStamp(clock, key, stampAt, stampWriter)
    }
  }
  refreshSettingsClock(clock)
  return next
}

export const mergeChatRecord = (
  local: ChatRecord,
  incoming: ChatRecord,
): ChatRecord => {
  const clock: ChatRecord['clock'] = { ...local.clock }
  const merged: ChatRecord = {
    ...local,
    clock,
    settings: local.settings,
  }
  merged.settings = mergeSettingsRecords(local, incoming, clock)
  for (const field of chatMetaFields) {
    if (field === 'settings') continue
    const incomingAt = clockAt(incoming.clock, field)
    if (incomingAt === undefined) continue
    const localAt = fieldAt(local, field)
    if (incomingAt < localAt) continue
    if (incomingAt === localAt && !tiePrefersIncoming(local, incoming, field)) {
      continue
    }
    assignField(merged, field, assignable(incoming, field))
    writeStamp(
      clock,
      field,
      incomingAt,
      readWriter(incoming.clock, field) ?? liveTabId(),
    )
  }
  return merged
}

const assignable = (record: ChatRecord, field: string) =>
  (record as unknown as Record<string, unknown>)[field]

export const isTombstone = (record: { deletedAt: number | null }) =>
  record.deletedAt !== null

export const tombstoneFields = (at: number, tab: TabId) => ({
  deletedAt: at,
  deletedByTab: tab,
})
