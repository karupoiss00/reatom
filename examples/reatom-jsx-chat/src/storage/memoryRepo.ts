import { now, tabId } from '../platform/env'
import type { TabId } from '../platform/types'
import { mergeChatFields, mergeChatRecord } from './records'
import type {
  AttachmentBlob,
  ChatId,
  ChatRecord,
  DraftRecord,
  MessageId,
  MessageRecord,
  PresetId,
  PresetRecord,
  Repo,
} from './types'

const draftKey = (chatId: ChatId | 'new', tab: TabId) => `${chatId}\u0000${tab}`

const copy = <T>(value: T): T => structuredClone(value)

export interface MemorySnapshot {
  chats: ChatRecord[]
  messages: MessageRecord[]
  drafts: DraftRecord[]
  attachments: AttachmentBlob[]
  presets: PresetRecord[]
}

export const isEmptySnapshot = (snapshot: MemorySnapshot) =>
  snapshot.chats.length === 0 &&
  snapshot.messages.length === 0 &&
  snapshot.drafts.length === 0 &&
  snapshot.attachments.length === 0 &&
  snapshot.presets.length === 0

export interface MemoryRepo extends Repo {
  snapshot(): MemorySnapshot
  putMessageUnchecked(message: MessageRecord): Promise<void>
}

export const shouldKeepStoredMessage = (
  stored: MessageRecord | undefined,
  incoming: MessageRecord,
) => stored !== undefined && stored.rev >= incoming.rev

export const createMemoryRepo = (): MemoryRepo => {
  const chats = new Map<ChatId, ChatRecord>()
  const messages = new Map<MessageId, MessageRecord>()
  const drafts = new Map<string, DraftRecord>()
  const attachments = new Map<string, AttachmentBlob>()
  const presets = new Map<PresetId, PresetRecord>()

  const putMessageSync = (message: MessageRecord) => {
    if (shouldKeepStoredMessage(messages.get(message.id), message)) return
    messages.set(message.id, copy(message))
  }

  return {
    async listChats() {
      return [...chats.values()].map(copy)
    },
    async getChat(id) {
      const chat = chats.get(id)
      return chat && copy(chat)
    },
    async createChat(chat) {
      if (chats.has(chat.id)) return
      chats.set(chat.id, copy(chat))
    },
    async putChatFields(id, fields, at) {
      const stored = chats.get(id)
      if (!stored) throw new Error(`Chat ${id} is not stored`)
      const merged = mergeChatFields(stored, copy(fields), at)
      chats.set(id, merged)
      return copy(merged)
    },
    async listMessages(chatId) {
      return [...messages.values()]
        .filter((message) => message.chatId === chatId)
        .map(copy)
    },
    async putMessage(message) {
      if (!chats.has(message.chatId)) {
        throw new Error(`Chat ${message.chatId} is not stored`)
      }
      putMessageSync(message)
    },
    async putMessageUnchecked(message) {
      putMessageSync(message)
    },
    async deleteMessage(id) {
      messages.delete(id)
    },
    async purgeChat(id) {
      const attachmentIds = new Set<string>()
      for (const [messageId, message] of messages) {
        if (message.chatId !== id) continue
        if (message.role === 'user') {
          for (const attachment of message.attachments) {
            attachmentIds.add(attachment.id)
          }
        }
        messages.delete(messageId)
      }
      for (const [key, draft] of drafts) {
        if (draft.chatId !== id) continue
        for (const attachment of draft.attachments) {
          attachmentIds.add(attachment.id)
        }
        drafts.delete(key)
      }
      for (const attachmentId of attachmentIds) attachments.delete(attachmentId)
      chats.delete(id)
    },
    async getDraft(chatId, tab) {
      const draft = drafts.get(draftKey(chatId, tab))
      return draft && copy(draft)
    },
    async latestDraft(chatId) {
      let latest: DraftRecord | undefined
      for (const draft of drafts.values()) {
        if (draft.chatId !== chatId) continue
        if (!latest || draft.updatedAt > latest.updatedAt) latest = draft
      }
      return latest && copy(latest)
    },
    async putDraft(draft) {
      drafts.set(draftKey(draft.chatId, draft.tabId), copy(draft))
    },
    async deleteDraft(chatId, tab) {
      drafts.delete(draftKey(chatId, tab))
    },
    async putAttachment(blob) {
      attachments.set(blob.id, copy(blob))
    },
    async getAttachment(id) {
      const blob = attachments.get(id)
      return blob && copy(blob)
    },
    async listPresets() {
      return [...presets.values()].map(copy)
    },
    async putPreset(preset) {
      presets.set(preset.id, copy(preset))
    },
    async purgePreset(id) {
      presets.delete(id)
    },
    async scanMessages(visit) {
      for (const message of messages.values()) {
        if (visit(copy(message)) === true) return
      }
    },
    async deleteAllChatsAndPresets() {
      const at = now()
      const tab = tabId
      for (const [id, chat] of chats) {
        if (chat.deletedAt !== null) continue
        chats.set(
          id,
          mergeChatFields(chat, { deletedAt: at, deletedByTab: tab }, at),
        )
      }
      for (const [id, preset] of presets) {
        if (preset.deletedAt !== null) continue
        presets.set(id, { ...preset, deletedAt: at, deletedByTab: tab })
      }
    },
    async bulkImport(input) {
      for (const chat of input.chats) {
        const stored = chats.get(chat.id)
        chats.set(
          chat.id,
          stored ? mergeChatRecord(stored, copy(chat)) : copy(chat),
        )
      }
      for (const message of input.messages) putMessageSync(message)
      for (const preset of input.presets) {
        const stored = presets.get(preset.id)
        if (stored && stored.deletedAt !== null && preset.deletedAt === null) {
          continue
        }
        presets.set(preset.id, copy(preset))
      }
      for (const blob of input.attachments) attachments.set(blob.id, copy(blob))
    },
    snapshot() {
      return {
        chats: [...chats.values()].map(copy),
        messages: [...messages.values()].map(copy),
        drafts: [...drafts.values()].map(copy),
        attachments: [...attachments.values()].map(copy),
        presets: [...presets.values()].map(copy),
      }
    },
  }
}
