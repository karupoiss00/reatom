import { action, addCallHook, atom } from '@reatom/core'

import { tabId } from '../platform/env'
import type { TabId } from '../platform/types'
import type { ChatId, MessageId } from '../storage/types'
import { syncReceived } from '../sync'

export interface LocalStream {
  messageId: MessageId
  controller: AbortController
  stopRequested: boolean
}

export const localStreams = atom(
  new Map<ChatId, LocalStream>(),
  'chat.streams.local',
)

export const startingNewChatId = atom<ChatId | null>(
  null,
  'chat.streams.startingNew',
)

export const remoteStreams = atom(
  new Map<ChatId, TabId>(),
  'chat.streams.remote',
)

export const unsavedChats = atom(new Set<ChatId>(), 'chat.streams.unsaved')

export const setLocalStream = action(
  (chatId: ChatId, stream: LocalStream | null): void => {
    localStreams.set((streams) => {
      const next = new Map(streams)
      if (stream) next.set(chatId, stream)
      else next.delete(chatId)
      return next
    })
  },
  'chat.streams.setLocal',
)

export const markUnsaved = action((chatId: ChatId, unsaved: boolean): void => {
  unsavedChats.set((chats) => {
    if (chats.has(chatId) === unsaved) return chats
    const next = new Set(chats)
    if (unsaved) next.add(chatId)
    else next.delete(chatId)
    return next
  })
}, 'chat.streams.markUnsaved')

const setRemoteStream = action(
  (chatId: ChatId, remoteTab: TabId, active: boolean): void => {
    remoteStreams.set((streams) => {
      const next = new Map(streams)
      if (active) next.set(chatId, remoteTab)
      else if (next.get(chatId) === remoteTab) next.delete(chatId)
      return next
    })
  },
  'chat.streams.setRemote',
)

addCallHook(syncReceived, (event) => {
  if (event.type !== 'stream' || event.tabId === tabId) return
  setRemoteStream(event.chatId, event.tabId, event.active)
})
