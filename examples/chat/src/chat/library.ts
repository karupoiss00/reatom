import {
  action,
  addCallHook,
  atom,
  computed,
  context,
  withAsync,
  wrap,
} from '@reatom/core'

import { timings } from '../app/timings'
import { now, tabId } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import { activeChatId, homeRoute } from '../routes'
import { mergeChatRecord } from '../storage/records'
import { repo } from '../storage/repo'
import { dbHealth } from '../storage/health'
import type { WriteFailure } from '../storage/types'
import { retryOpenStorage } from '../storage'
import type { ChatId, ChatMetaField, ChatRecord } from '../storage/types'
import { holdTombstone, syncReceived } from '../sync'
import type { SyncEvent } from '../sync/types'
import { publishSync } from './syncPublisher'
import { groupLabel } from './group'

export type LibraryStatus = 'loading' | 'ready' | 'error'

type ChatFields = Partial<Omit<ChatRecord, 'id' | 'clock'>>

export const libraryRecords = atom<ChatRecord[]>([], 'chat.library.records')

const libraryStatus = atom<LibraryStatus>('loading', 'chat.library.status')

const libraryChats = computed(
  () => libraryRecords().filter((chat) => chat.deletedAt === null),
  'chat.library.chats',
)

const applyLocalFields = (
  record: ChatRecord,
  fields: ChatFields,
  at: number,
): ChatRecord => {
  const next: ChatRecord = { ...record, ...fields, clock: { ...record.clock } }
  for (const field of Object.keys(fields)) {
    next.clock[field as ChatMetaField] = at
  }
  return next
}

export const upsertChatRecord = action((record: ChatRecord): void => {
  libraryRecords.set((records) => {
    const index = records.findIndex((chat) => chat.id === record.id)
    if (index < 0) return [...records, record]
    const next = [...records]
    next[index] = record
    return next
  })
}, 'chat.library.upsert')

const findRecord = (id: ChatId) =>
  libraryRecords().find((chat) => chat.id === id)

export const createChat = action(async (record: ChatRecord) => {
  upsertChatRecord(record)
  await wrap(repo.createChat(record))
  publishSync({ type: 'chat', chat: record })
}, 'chat.library.createChat').extend(withAsync())

export const saveConflict = atom<{ chatId: ChatId; reason: string } | null>(
  null,
  'chat.library.saveConflict',
)

const refusedChangeReason = (error: unknown): string => {
  const reason =
    error !== null && typeof error === 'object' && 'reason' in error
      ? (error as Partial<WriteFailure>).reason
      : undefined
  if (reason === 'quota') return 'browser storage is full'
  if (reason === 'blocked') return 'saved chats are unavailable'
  return 'the save was refused'
}

export const patchChat = action(
  async (id: ChatId, fields: ChatFields): Promise<ChatRecord | null> => {
    const at = now()
    const previous = findRecord(id)
    if (previous) upsertChatRecord(applyLocalFields(previous, fields, at))
    try {
      const stored = await wrap(repo.putChatFields(id, fields, at))
      const latest = findRecord(id)
      const merged = latest ? mergeChatRecord(latest, stored) : stored
      upsertChatRecord(merged)
      publishSync({ type: 'chat', chat: stored })
      if (saveConflict()?.chatId === id) saveConflict.set(null)
      return merged
    } catch (error) {
      if (previous) upsertChatRecord(previous)
      saveConflict.set({ chatId: id, reason: refusedChangeReason(error) })
      throw error
    }
  },
  'chat.library.patchChat',
).extend(withAsync())

export const library = {
  status: libraryStatus,
  chats: libraryChats,
  hasChats: computed(() => libraryChats().length > 0, 'chat.library.hasChats'),
  reload: action(async () => {
    try {
      const health = dbHealth()
      if (health.status === 'memory' && health.reason === 'open-failed') {
        await wrap(retryOpenStorage())
      }
      const stored = await wrap(repo.listChats())
      const local = new Map(libraryRecords().map((chat) => [chat.id, chat]))
      libraryRecords.set(
        stored.map((chat) => {
          const known = local.get(chat.id)
          return known ? mergeChatRecord(chat, known) : chat
        }),
      )
      const opened = dbHealth()
      libraryStatus.set(
        opened.status === 'memory' && opened.reason === 'open-failed'
          ? 'error'
          : 'ready',
      )
    } catch (error) {
      libraryStatus.set('error')
      throw error
    }
  }, 'chat.library.reload').extend(withAsync()),
}

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const byPinThenActivity = (a: ChatRecord, b: ChatRecord) =>
  (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || b.lastActivityAt - a.lastActivityAt

export const chatGroups = computed(() => {
  const chats = [...library.chats()].sort(byPinThenActivity)
  const groups: Array<{ label: string; chats: ChatRecord[] }> = []
  if (chats.length === 0) return groups
  const nowAt = now()
  const timeZone = deviceTimeZone()
  for (const chat of chats) {
    const label =
      chat.pinnedAt !== null
        ? 'Pinned'
        : groupLabel(chat.lastActivityAt, nowAt, timeZone)
    const lastGroup = groups.at(-1)
    if (lastGroup?.label === label) lastGroup.chats.push(chat)
    else groups.push({ label, chats: [chat] })
  }
  return groups
}, 'chat.library.groups')

export const newChat = action((): void => {
  if (activeChatId() === 'new') return
  homeRoute.go()
}, 'chat.library.newChat')

export const renameChat = action((id: ChatId, title: string): void => {
  const trimmed = title.replace(/\s+/g, ' ').trim()
  if (trimmed.length === 0) return
  const current = findRecord(id)
  if (!current || current.title === trimmed) return
  patchChat(id, { title: trimmed, titleSource: 'manual' }).catch(() => {})
}, 'chat.library.rename')

export const togglePin = action((id: ChatId): void => {
  const current = findRecord(id)
  if (!current) return
  patchChat(id, { pinnedAt: current.pinnedAt === null ? now() : null }).catch(
    () => {},
  )
}, 'chat.library.togglePin')

export const pendingUndo = atom<{ ids: ChatId[]; expiresAt: number } | null>(
  null,
  'chat.library.pendingUndo',
)

export const deletedElsewhere = atom<{
  chatId: ChatId
  expiresAt: number
} | null>(null, 'chat.library.deletedElsewhere')

export const chatsTombstoned = action(
  (ids: ChatId[]) => ids,
  'chat.library.chatsTombstoned',
)

export const chatPurged = action(
  (id: ChatId) => id,
  'chat.library.chatPurged',
)

const pendingPurges = new Map<
  ChatId,
  { timer: ReturnType<typeof setTimeout>; hold: { release(): void } }
>()

const releasePurge = (id: ChatId) => {
  const scheduled = pendingPurges.get(id)
  if (!scheduled) return
  clearTimeout(scheduled.timer)
  scheduled.hold.release()
  pendingPurges.delete(id)
}

const releaseAllPurges = () => {
  for (const id of [...pendingPurges.keys()]) releasePurge(id)
}

let elsewhereTimer: ReturnType<typeof setTimeout> | null = null

const clearElsewhereTimer = () => {
  if (!elsewhereTimer) return
  clearTimeout(elsewhereTimer)
  elsewhereTimer = null
}

const expireElsewhere = action(() => {
  elsewhereTimer = null
  const current = deletedElsewhere()
  if (current && current.expiresAt <= now()) deletedElsewhere.set(null)
}, 'chat.library.expireElsewhere')

const armElsewhereTimer = (expiresAt: number) => {
  clearElsewhereTimer()
  const delayMs = Math.max(0, expiresAt - now())
  elsewhereTimer = setTimeout(() => expireElsewhere(), delayMs)
}

const noteBlockedLibrary = action(() => {
  if (dbHealth().status === 'error') libraryStatus.set('error')
}, 'chat.library.noteBlocked')

const bindLibraryReset = () => {
  const subscribedRoot = context().root
  const unsubscribeHealth = dbHealth.subscribe(() => noteBlockedLibrary())
  onRuntimeReset(() => {
    releaseAllPurges()
    clearElsewhereTimer()
    if (context().root === subscribedRoot) unsubscribeHealth()
    bindLibraryReset()
  })
}

bindLibraryReset()

const forgetUndoId = (id: ChatId) => {
  const pending = pendingUndo()
  if (!pending || !pending.ids.includes(id)) return
  const ids = pending.ids.filter((chatId) => chatId !== id)
  pendingUndo.set(
    ids.length === 0 ? null : { ids, expiresAt: pending.expiresAt },
  )
}

const removeRecord = action((id: ChatId) => {
  libraryRecords.set((records) => records.filter((chat) => chat.id !== id))
  chatPurged(id)
}, 'chat.library.removeRecord')

const purgeIfStillDeleted = action(async (id: ChatId) => {
  releasePurge(id)
  const record = findRecord(id)
  if (record && record.deletedAt === null) return
  await wrap(repo.purgeChat(id))
  forgetUndoId(id)
  removeRecord(id)
  publishSync({ type: 'chat-purged', chatId: id })
}, 'chat.library.purge').extend(withAsync())

const armPurge = (id: ChatId, delayMs: number) => {
  releasePurge(id)
  const hold = holdTombstone(id, delayMs)
  const timer = setTimeout(() => {
    purgeIfStillDeleted(id).catch(() => {})
  }, delayMs)
  pendingPurges.set(id, { timer, hold })
}

export const deleteChats = action((ids: ChatId[]): void => {
  const at = now()
  const deletable = ids.filter((id) => {
    const record = findRecord(id)
    return record !== undefined && record.deletedAt === null
  })
  if (deletable.length === 0) return
  const undoMs = timings.undoMs
  chatsTombstoned(deletable)
  for (const id of deletable) {
    patchChat(id, { deletedAt: at, deletedByTab: tabId }).catch(() => {})
  }
  const previous = pendingUndo()
  const stillPending =
    previous && previous.expiresAt > at
      ? previous.ids.filter((id) => !deletable.includes(id))
      : []
  const merged = [...stillPending, ...deletable]
  const expiresAt = at + undoMs
  pendingUndo.set({ ids: merged, expiresAt })
  const delayMs = Math.max(0, expiresAt - now())
  for (const id of merged) armPurge(id, delayMs)
  if (deletable.includes(activeChatId() as ChatId)) homeRoute.go()
}, 'chat.library.delete')

export const undoDelete = action((): void => {
  const pending = pendingUndo()
  pendingUndo.set(null)
  const elsewhere = deletedElsewhere()
  clearElsewhereTimer()
  deletedElsewhere.set(null)
  const ids = new Set<ChatId>(pending?.ids ?? [])
  if (elsewhere) ids.add(elsewhere.chatId)
  for (const id of ids) {
    const scheduled = pendingPurges.get(id)
    if (scheduled) {
      clearTimeout(scheduled.timer)
      scheduled.hold.release()
      pendingPurges.delete(id)
    }
    if (findRecord(id)?.deletedAt === null) continue
    patchChat(id, { deletedAt: null, deletedByTab: null }).catch(() => {})
  }
}, 'chat.library.undoDelete')

const receiveChat = (incoming: ChatRecord) => {
  const known = findRecord(incoming.id)
  const merged = known ? mergeChatRecord(known, incoming) : incoming
  upsertChatRecord(merged)
  const deletedRemotely =
    merged.deletedAt !== null && merged.deletedByTab !== tabId
  if (deletedRemotely && (!known || known.deletedAt === null)) {
    chatsTombstoned([merged.id])
    if (activeChatId() === merged.id) {
      const expiresAt = merged.deletedAt! + timings.undoMs
      deletedElsewhere.set({ chatId: merged.id, expiresAt })
      armElsewhereTimer(expiresAt)
    }
  }
  if (merged.deletedAt === null && deletedElsewhere()?.chatId === merged.id) {
    clearElsewhereTimer()
    deletedElsewhere.set(null)
  }
}

const receiveSync = (event: SyncEvent) => {
  if (event.type === 'chat') receiveChat(event.chat)
  else if (event.type === 'chat-purged') {
    if (findRecord(event.chatId)) removeRecord(event.chatId)
  } else if (event.type === 'all-deleted') {
    for (const record of libraryRecords()) chatPurged(record.id)
    libraryRecords.set([])
  }
}

addCallHook(syncReceived, receiveSync)
