import { action, withAsync, wrap } from '@reatom/core'

import { library } from '../chat/library'
import { loadPresets } from '../presets/presets'
import { now } from '../platform/env'
import { repo } from '../storage/repo'
import type {
  AttachmentBlob,
  ChatRecord,
  MessageRecord,
  PresetRecord,
} from '../storage/types'
import type { ExportBundle, ImportResult } from './types'

export const maxImportBytes = 50 * 1024 * 1024

export const importErrorCopy = {
  invalid: "This file isn't a chat export (missing 'chats').",
  'too-large': 'This file is too large to import.',
} as const

const createId = () => crypto.randomUUID()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const importedSuffix = '(imported)'

const withImportedTitle = (title: string) => {
  const base = title.replace(/(?:\s*\(imported\))+\s*$/g, '').trim()
  return base ? `${base} ${importedSuffix}` : importedSuffix
}

const readBundle = (value: unknown): ExportBundle | null => {
  if (!isRecord(value)) return null
  if (value.format !== 'atelier-chats' || value.version !== 1) return null
  if (!Array.isArray(value.chats)) return null
  const presets = value.presets === undefined ? [] : value.presets
  if (!Array.isArray(presets)) return null
  for (const preset of presets) {
    if (!isRecord(preset)) return null
    if (typeof preset.id !== 'string' || typeof preset.name !== 'string')
      return null
  }
  for (const entry of value.chats) {
    if (!isRecord(entry)) return null
    if (!isRecord(entry.chat) || typeof entry.chat.id !== 'string') return null
    if (typeof entry.chat.title !== 'string') return null
    if (!Array.isArray(entry.messages) || !Array.isArray(entry.attachments)) {
      return null
    }
    for (const message of entry.messages) {
      if (!isRecord(message) || typeof message.id !== 'string') return null
      if (message.role !== 'user' && message.role !== 'assistant') return null
    }
  }
  return {
    format: 'atelier-chats',
    version: 1,
    exportedAt:
      typeof value.exportedAt === 'string'
        ? value.exportedAt
        : new Date(now()).toISOString(),
    chats: value.chats as ExportBundle['chats'],
    presets: presets as PresetRecord[],
  }
}

const remapMessage = (
  message: MessageRecord,
  chatId: string,
  messageIds: Map<string, string>,
  attachmentIds: Map<string, string>,
): MessageRecord => {
  const id = messageIds.get(message.id) ?? createId()
  const parentId = message.parentId
    ? (messageIds.get(message.parentId) ?? null)
    : null
  if (message.role === 'user') {
    return {
      ...message,
      id,
      chatId,
      parentId,
      attachments: message.attachments.map((attachment) => ({
        ...attachment,
        id: attachmentIds.get(attachment.id) ?? attachment.id,
      })),
    }
  }
  return { ...message, id, chatId, parentId }
}

const remapBundle = (bundle: ExportBundle) => {
  const presetIds = new Map<string, string>()
  const presets = bundle.presets.map((preset) => {
    const id = createId()
    presetIds.set(preset.id, id)
    return { ...preset, id, deletedAt: null, deletedByTab: null }
  })
  const messageIds = new Map<string, string>()
  const attachmentIds = new Map<string, string>()
  for (const entry of bundle.chats) {
    for (const message of entry.messages) {
      if (!messageIds.has(message.id)) messageIds.set(message.id, createId())
    }
    for (const blob of entry.attachments) {
      if (!attachmentIds.has(blob.id)) attachmentIds.set(blob.id, createId())
    }
  }
  const chats: ChatRecord[] = []
  const messages: MessageRecord[] = []
  const attachments: AttachmentBlob[] = []
  for (const entry of bundle.chats) {
    const chatId = createId()
    const selection: Record<string, string> = {}
    for (const [key, selected] of Object.entries(entry.chat.selection ?? {})) {
      const nextKey = key === 'root' ? 'root' : messageIds.get(key)
      const nextSelected = messageIds.get(selected)
      if (!nextKey || !nextSelected) continue
      selection[nextKey] = nextSelected
    }
    const presetId = entry.chat.presetId
      ? (presetIds.get(entry.chat.presetId) ?? null)
      : null
    chats.push({
      ...entry.chat,
      id: chatId,
      title: withImportedTitle(entry.chat.title),
      presetId,
      selection,
      deletedAt: null,
      deletedByTab: null,
      imported: true,
    })
    for (const message of entry.messages) {
      messages.push(remapMessage(message, chatId, messageIds, attachmentIds))
    }
    for (const blob of entry.attachments) {
      attachments.push({
        ...blob,
        id: attachmentIds.get(blob.id) ?? createId(),
      })
    }
  }
  return { chats, messages, presets, attachments }
}

export const importFile = action(async (file: File): Promise<ImportResult> => {
  if (file.size > maxImportBytes) return { ok: false, reason: 'too-large' }
  let parsed: unknown
  try {
    parsed = JSON.parse(await wrap(file.text()))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const bundle = readBundle(parsed)
  if (!bundle) return { ok: false, reason: 'invalid' }
  const prepared = remapBundle(bundle)
  await wrap(repo.bulkImport(prepared))
  await wrap(library.reload())
  await wrap(loadPresets())
  return { ok: true, count: prepared.chats.length }
}, 'data.importFile').extend(withAsync())
