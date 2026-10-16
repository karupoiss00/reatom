import type { IDBPDatabase, IDBPTransaction } from 'idb'

import { now, tabId } from '../platform/env'
import {
  atelierStoreNames,
  type AtelierSchema,
  closeAllConnections,
  getConnection,
  storeNames,
} from './db'
import { markReadFailed, recordWriteFailure, writeFailure } from './health'
import {
  createMemoryRepo,
  isEmptySnapshot,
  type MemoryRepo,
  type MemorySnapshot,
  shouldKeepStoredMessage,
} from './memoryRepo'
import { mergeChatFields, mergeChatRecord } from './records'
import type {
  ChatId,
  ChatRecord,
  DraftRecord,
  MessageRecord,
  Repo,
  WriteFailure,
} from './types'

type Database = IDBPDatabase<AtelierSchema>
type WriteTransaction = IDBPTransaction<
  AtelierSchema,
  typeof atelierStoreNames,
  'readwrite'
>

let backend: Repo = createMemoryRepo()
let memoryFallback: MemoryRepo | null = null
let activeDatabase: Database | null = null
let activeRepo: Repo | null = null
let clearActiveEpisode = () => {}
let captureActiveShadow: () => MemorySnapshot | null = () => null
let resetTombstoneCheck = () => {}

export const onRepoReset = (reset: () => void) => {
  resetTombstoneCheck = reset
}

export class StorageReadError extends Error {
  constructor() {
    super("Couldn't open saved chats.")
    this.name = 'StorageReadError'
  }
}

export const setRepoBackend = (next: Repo): void => {
  backend = next
}

export const resetRepoBackend = (): void => {
  memoryFallback = null
  activeDatabase = null
  activeRepo = null
  clearActiveEpisode = () => {}
  captureActiveShadow = () => null
  resetTombstoneCheck()
  backend = createMemoryRepo()
  closeAllConnections()
}

export const prepareStorageAttempt = () => {
  clearActiveEpisode()
}

export const installMemoryFallback = () => {
  if (!memoryFallback) memoryFallback = createMemoryRepo()
  activeDatabase = null
  activeRepo = memoryFallback
  clearActiveEpisode = () => {}
  backend = memoryFallback
}

export const releaseMemoryFallback = () => {
  memoryFallback = null
}

export const installBlockedRepo = () => {
  if (activeRepo) {
    backend = activeRepo
    return
  }
  const blocked = createUnreadableRepo()
  activeRepo = blocked
  activeDatabase = null
  backend = blocked
}

export const ensureIdbRepo = (db: Database) => {
  if (activeDatabase === db && activeRepo) {
    backend = activeRepo
    return
  }
  activeDatabase = db
  activeRepo = createIdbRepo(db)
  backend = activeRepo
}

export const captureRecoverable = async (): Promise<MemorySnapshot | null> => {
  const combined = createMemoryRepo()
  if (memoryFallback) {
    const fallback = memoryFallback.snapshot()
    if (!isEmptySnapshot(fallback)) await combined.bulkImport(fallback)
  }
  const shadow = captureActiveShadow()
  if (shadow && !isEmptySnapshot(shadow)) await combined.bulkImport(shadow)
  const snapshot = combined.snapshot()
  return isEmptySnapshot(snapshot) ? null : snapshot
}

const classifyStorageError = (error: unknown): WriteFailure['reason'] => {
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : ''
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota'
  if (
    name === 'InvalidStateError' ||
    name === 'AbortError' ||
    name === 'TransactionInactiveError' ||
    name === 'UnknownError' ||
    name === 'TimeoutError' ||
    name === 'NotReadableError'
  ) {
    return 'blocked'
  }
  return 'unknown'
}

const isDataCloneError = (error: unknown) =>
  (error instanceof DOMException || error instanceof Error) &&
  error.name === 'DataCloneError'

const isDatabaseFailure = (error: unknown) => {
  if (isDataCloneError(error) || error instanceof StorageReadError) return false
  if (error instanceof DOMException) return true
  return (
    error instanceof Error &&
    error.name !== 'Error' &&
    error.name !== 'StorageReadError'
  )
}

const currentFailure = (reason: WriteFailure['reason']): WriteFailure => {
  recordWriteFailure(reason)
  return writeFailure() ?? { reason, at: now() }
}

const rejectClosed = () => Promise.reject(new StorageReadError())

const noteBlockedWrite = async () => {
  throw currentFailure('blocked')
}

const createUnreadableRepo = (): Repo => ({
  listChats: rejectClosed,
  getChat: rejectClosed,
  createChat: noteBlockedWrite,
  putChatFields: noteBlockedWrite,
  listMessages: rejectClosed,
  putMessage: noteBlockedWrite,
  deleteMessage: noteBlockedWrite,
  purgeChat: noteBlockedWrite,
  getDraft: rejectClosed,
  latestDraft: rejectClosed,
  putDraft: noteBlockedWrite,
  deleteDraft: noteBlockedWrite,
  putAttachment: noteBlockedWrite,
  getAttachment: rejectClosed,
  listPresets: rejectClosed,
  putPreset: noteBlockedWrite,
  purgePreset: noteBlockedWrite,
  scanMessages: rejectClosed,
  deleteAllChatsAndPresets: noteBlockedWrite,
  bulkImport: noteBlockedWrite,
})

const trackDone = (done: Promise<void>) => {
  void done.catch(() => undefined)
  return done
}

const abortTransaction = (transaction: { abort: () => void }) => {
  try {
    transaction.abort()
  } catch {
    return
  }
}

const createIdbRepo = (bound: Database): Repo => {
  const shadow = createMemoryRepo()
  let episode: WriteFailure['reason'] | null = null

  clearActiveEpisode = () => {
    episode = null
  }
  captureActiveShadow = () => shadow.snapshot()

  const live = () => {
    const current = getConnection()
    return current === bound ? current : null
  }

  const mirrorChat = async (db: Database, id: ChatId) => {
    if (await shadow.getChat(id)) return
    try {
      const chat = await db.get(storeNames.chats, id)
      if (chat) await shadow.createChat(chat)
    } catch {
      return
    }
  }

  const write = async <T>(
    mutate: (db: Database) => Promise<T>,
    memory: () => Promise<T>,
    mirrorRejected = true,
  ): Promise<T> => {
    if (episode) {
      if (mirrorRejected) await memory()
      throw currentFailure(episode)
    }
    const db = live()
    if (!db) {
      if (mirrorRejected) await memory()
      throw currentFailure('blocked')
    }
    try {
      const result = await mutate(db)
      await memory()
      return result
    } catch (error) {
      if (isDataCloneError(error) || !isDatabaseFailure(error)) throw error
      episode = classifyStorageError(error)
      if (mirrorRejected) await memory()
      throw currentFailure(episode)
    }
  }

  const read = async <T, R = T>(
    query: (db: Database) => Promise<T>,
    overlay: (stored: T) => Promise<R>,
  ): Promise<R> => {
    const db = live()
    if (!db) throw new StorageReadError()
    try {
      return await overlay(await query(db))
    } catch (error) {
      if (error instanceof StorageReadError || !isDatabaseFailure(error)) {
        throw error
      }
      markReadFailed()
      throw new StorageReadError()
    }
  }

  const writeStores = (db: Database) => {
    const transaction = db.transaction(atelierStoreNames, 'readwrite', {
      durability: 'strict',
    })
    return { transaction, done: trackDone(transaction.done) }
  }

  const overlayChats = async (stored: ChatRecord[]) => {
    const byId = new Map(stored.map((chat) => [chat.id, chat]))
    for (const chat of await shadow.listChats()) {
      const current = byId.get(chat.id)
      byId.set(chat.id, current ? mergeChatRecord(current, chat) : chat)
    }
    return [...byId.values()]
  }

  const overlayMessages = async (chatId: ChatId, stored: MessageRecord[]) => {
    const byId = new Map(stored.map((message) => [message.id, message]))
    for (const message of await shadow.listMessages(chatId)) {
      const current = byId.get(message.id)
      if (!current || !shouldKeepStoredMessage(current, message)) {
        byId.set(message.id, message)
      }
    }
    return [...byId.values()]
  }

  return {
    listChats: () =>
      read(
        (db) => db.getAll(storeNames.chats),
        (stored) => overlayChats(stored),
      ),
    getChat: (id) =>
      read(
        (db) => db.get(storeNames.chats, id),
        async (stored) => {
          const extra = await shadow.getChat(id)
          if (!extra) return stored
          return stored ? mergeChatRecord(stored, extra) : extra
        },
      ),
    async createChat(chat) {
      await write(
        async (db) => {
          const transaction = db.transaction(storeNames.chats, 'readwrite', {
            durability: 'strict',
          })
          const done = trackDone(transaction.done)
          const existing = await transaction.store.get(chat.id)
          if (!existing) await transaction.store.put(structuredClone(chat))
          await done
        },
        () => shadow.createChat(chat),
      )
    },
    putChatFields: (id, fields, at, options) =>
      write(
        async (db) => {
          await mirrorChat(db, id)
          const transaction = db.transaction(storeNames.chats, 'readwrite', {
            durability: 'strict',
          })
          const done = trackDone(transaction.done)
          try {
            const stored = await transaction.store.get(id)
            if (!stored) throw new Error(`Chat ${id} is not stored`)
            const merged = mergeChatFields(stored, structuredClone(fields), at)
            await transaction.store.put(merged)
            await done
            return merged
          } catch (error) {
            abortTransaction(transaction)
            throw error
          }
        },
        () => shadow.putChatFields(id, fields, at),
        options?.mirrorRejected !== false,
      ),
    listMessages: (chatId) =>
      read(
        (db) => db.getAllFromIndex(storeNames.messages, 'chatId', chatId),
        (stored) => overlayMessages(chatId, stored),
      ),
    async putMessage(message) {
      await write(
        async (db) => {
          await mirrorChat(db, message.chatId)
          const transaction = db.transaction(
            [storeNames.chats, storeNames.messages],
            'readwrite',
            { durability: 'strict' },
          )
          const done = trackDone(transaction.done)
          try {
            const chat = await transaction
              .objectStore(storeNames.chats)
              .get(message.chatId)
            if (!chat) throw new Error(`Chat ${message.chatId} is not stored`)
            const incoming = structuredClone(message)
            const messages = transaction.objectStore(storeNames.messages)
            const stored = await messages.get(incoming.id)
            if (!shouldKeepStoredMessage(stored, incoming)) {
              await messages.put(incoming)
            }
            await done
          } catch (error) {
            abortTransaction(transaction)
            throw error
          }
        },
        () => shadow.putMessageUnchecked(message),
      )
    },
    async deleteMessage(id) {
      await write(
        (db) => db.delete(storeNames.messages, id),
        () => shadow.deleteMessage(id),
      )
    },
    async purgeChat(id) {
      await write(
        async (db) => {
          const { transaction, done } = writeStores(db)
          try {
            await purgeChatRecords(transaction, id)
            await done
          } catch (error) {
            abortTransaction(transaction)
            throw error
          }
        },
        () => shadow.purgeChat(id),
      )
    },
    getDraft: (chatId, tab) =>
      read(
        (db) => db.get(storeNames.drafts, [chatId, tab]),
        async (stored) => {
          const extra = await shadow.getDraft(chatId, tab)
          if (!extra) return stored
          if (!stored || extra.updatedAt >= stored.updatedAt) return extra
          return stored
        },
      ),
    latestDraft: (chatId) =>
      read(
        async (db) => {
          const drafts = await db.getAllFromIndex(
            storeNames.drafts,
            'chatId',
            chatId,
          )
          let latest: DraftRecord | undefined
          for (const draft of drafts) {
            if (!latest || draft.updatedAt > latest.updatedAt) latest = draft
          }
          return latest
        },
        async (stored) => {
          const extra = await shadow.latestDraft(chatId)
          if (!extra) return stored
          if (!stored || extra.updatedAt >= stored.updatedAt) return extra
          return stored
        },
      ),
    async putDraft(draft) {
      await write(
        async (db) => {
          await db.put(storeNames.drafts, structuredClone(draft))
        },
        () => shadow.putDraft(draft),
      )
    },
    async deleteDraft(chatId, tab) {
      await write(
        (db) => db.delete(storeNames.drafts, [chatId, tab]),
        () => shadow.deleteDraft(chatId, tab),
      )
    },
    async putAttachment(blob) {
      await write(
        async (db) => {
          await db.put(storeNames.attachments, structuredClone(blob))
        },
        () => shadow.putAttachment(blob),
      )
    },
    getAttachment: (id) =>
      read(
        (db) => db.get(storeNames.attachments, id),
        async (stored) => (await shadow.getAttachment(id)) ?? stored,
      ),
    listPresets: () =>
      read(
        (db) => db.getAll(storeNames.presets),
        async (stored) => {
          const byId = new Map(stored.map((preset) => [preset.id, preset]))
          for (const preset of await shadow.listPresets())
            byId.set(preset.id, preset)
          return [...byId.values()]
        },
      ),
    async putPreset(preset) {
      await write(
        async (db) => {
          await db.put(storeNames.presets, structuredClone(preset))
        },
        () => shadow.putPreset(preset),
      )
    },
    async purgePreset(id) {
      await write(
        (db) => db.delete(storeNames.presets, id),
        () => shadow.purgePreset(id),
      )
    },
    scanMessages: (visit) =>
      read(
        async (db) => {
          const seen = new Set<string>()
          const transaction = db.transaction(storeNames.messages, 'readonly')
          const done = trackDone(transaction.done)
          let cursor = await transaction.store.openCursor()
          let stopped = false
          while (cursor) {
            seen.add(cursor.value.id)
            if (visit(cursor.value) === true) {
              stopped = true
              break
            }
            cursor = await cursor.continue()
          }
          await done
          return { seen, stopped }
        },
        async ({ seen, stopped }) => {
          if (stopped) return
          await shadow.scanMessages((message) => {
            if (seen.has(message.id)) return
            return visit(message)
          })
        },
      ),
    async deleteAllChatsAndPresets() {
      await write(
        async (db) => {
          const { transaction, done } = writeStores(db)
          try {
            const at = now()
            const tab = tabId
            const chats = transaction.objectStore(storeNames.chats)
            let cursor = await chats.openCursor()
            while (cursor) {
              if (cursor.value.deletedAt === null) {
                await cursor.update(
                  mergeChatFields(
                    cursor.value,
                    { deletedAt: at, deletedByTab: tab },
                    at,
                  ),
                )
              }
              cursor = await cursor.continue()
            }
            const presets = transaction.objectStore(storeNames.presets)
            let presetCursor = await presets.openCursor()
            while (presetCursor) {
              if (presetCursor.value.deletedAt === null) {
                await presetCursor.update({
                  ...presetCursor.value,
                  deletedAt: at,
                  deletedByTab: tab,
                })
              }
              presetCursor = await presetCursor.continue()
            }
            await done
          } catch (error) {
            abortTransaction(transaction)
            throw error
          }
        },
        () => shadow.deleteAllChatsAndPresets(),
      )
    },
    async bulkImport(input) {
      await write(
        async (db) => {
          const { transaction, done } = writeStores(db)
          try {
            const chats = transaction.objectStore(storeNames.chats)
            const messages = transaction.objectStore(storeNames.messages)
            const presets = transaction.objectStore(storeNames.presets)
            const attachments = transaction.objectStore(storeNames.attachments)
            for (const chat of input.chats) {
              const incoming = structuredClone(chat)
              const stored = await chats.get(incoming.id)
              await chats.put(
                stored ? mergeChatRecord(stored, incoming) : incoming,
              )
            }
            for (const message of input.messages) {
              const incoming = structuredClone(message)
              const stored = await messages.get(incoming.id)
              if (!shouldKeepStoredMessage(stored, incoming)) {
                await messages.put(incoming)
              }
            }
            for (const preset of input.presets) {
              const incoming = structuredClone(preset)
              const stored = await presets.get(incoming.id)
              if (
                stored &&
                stored.deletedAt !== null &&
                incoming.deletedAt === null
              ) {
                continue
              }
              await presets.put(incoming)
            }
            for (const blob of input.attachments) {
              await attachments.put(structuredClone(blob))
            }
            await done
          } catch (error) {
            abortTransaction(transaction)
            throw error
          }
        },
        () => shadow.bulkImport(input),
      )
    },
  }
}

const purgeChatRecords = async (transaction: WriteTransaction, id: ChatId) => {
  const attachmentIds = new Set<string>()
  const messages = transaction.objectStore(storeNames.messages)
  let messageCursor = await messages.index('chatId').openCursor(id)
  while (messageCursor) {
    if (messageCursor.value.role === 'user') {
      for (const attachment of messageCursor.value.attachments) {
        attachmentIds.add(attachment.id)
      }
    }
    await messageCursor.delete()
    messageCursor = await messageCursor.continue()
  }
  const drafts = transaction.objectStore(storeNames.drafts)
  let draftCursor = await drafts.index('chatId').openCursor(id)
  while (draftCursor) {
    for (const attachment of draftCursor.value.attachments) {
      attachmentIds.add(attachment.id)
    }
    await draftCursor.delete()
    draftCursor = await draftCursor.continue()
  }
  const attachments = transaction.objectStore(storeNames.attachments)
  for (const attachmentId of attachmentIds) {
    await attachments.delete(attachmentId)
  }
  await transaction.objectStore(storeNames.chats).delete(id)
}

export const repo: Repo = {
  listChats: () => backend.listChats(),
  getChat: (id) => backend.getChat(id),
  createChat: (chat) => backend.createChat(chat),
  putChatFields: (id, fields, at, options) =>
    backend.putChatFields(id, fields, at, options),
  listMessages: (chatId) => backend.listMessages(chatId),
  putMessage: (message) => backend.putMessage(message),
  deleteMessage: (id) => backend.deleteMessage(id),
  purgeChat: (id) => backend.purgeChat(id),
  getDraft: (chatId, tab) => backend.getDraft(chatId, tab),
  latestDraft: (chatId) => backend.latestDraft(chatId),
  putDraft: (draft) => backend.putDraft(draft),
  deleteDraft: (chatId, tab) => backend.deleteDraft(chatId, tab),
  putAttachment: (blob) => backend.putAttachment(blob),
  getAttachment: (id) => backend.getAttachment(id),
  listPresets: () => backend.listPresets(),
  putPreset: (preset) => backend.putPreset(preset),
  purgePreset: (id) => backend.purgePreset(id),
  scanMessages: (visit) => backend.scanMessages(visit),
  deleteAllChatsAndPresets: () => backend.deleteAllChatsAndPresets(),
  bulkImport: (input) => backend.bulkImport(input),
}
