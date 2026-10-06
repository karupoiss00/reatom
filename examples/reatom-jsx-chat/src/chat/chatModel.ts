import {
  action,
  addCallHook,
  atom,
  computed,
  withAsync,
  withChangeHook,
  withComputed,
  withConnectHook,
  wrap,
} from '@reatom/core'

import { unlimitedAckNeeded } from '../auth/ack'
import { apiKey } from '../auth/keyStore'
import { recordPick } from '../catalog/favorites'
import { resolveNewChatModel } from '../catalog/resolveModel'
import { isOnline, now } from '../platform/env'
import { activeChatId } from '../routes'
import { createDefaultChatSettings } from '../storage/records'
import { repo } from '../storage/repo'
import type {
  ChatId,
  ChatRecord,
  ChatSettings,
  MessageId,
  MessageRecord,
  PresetId,
} from '../storage/types'
import { reloadFromStorage } from '../sync/fallback'
import { streamHeldElsewhere, syncReceived } from '../sync'
import { reatomDraft } from './drafts'
import {
  chatPurged,
  deletedElsewhere,
  library,
  libraryRecords,
  patchChat,
} from './library'
import {
  localStreams,
  remoteStreams,
  startingNewChatId,
  unsavedChats,
} from './streams'
import { buildPath, selectionKeyOf } from './tree'
import type { ChatModel, SendBlock, SendBlockContributor } from './types'

const registeredContributors: SendBlockContributor[] = []
const contributorsRevision = atom(0, 'chat.sendBlockContributors.revision')

export const sendBlockContributors = {
  register: (contributor: SendBlockContributor): (() => void) => {
    registeredContributors.push(contributor)
    contributorsRevision.set((revision) => revision + 1)
    return () => {
      const index = registeredContributors.indexOf(contributor)
      if (index < 0) return
      registeredContributors.splice(index, 1)
      contributorsRevision.set((revision) => revision + 1)
    }
  },
  list: (): readonly SendBlockContributor[] => {
    contributorsRevision()
    return [...registeredContributors]
  },
}

export interface ChatModelInternals {
  loadMessages: () => Promise<void>
  reloadStoredMessages: () => Promise<void>
  messagesLoaded: () => boolean
  resetPending: () => void
}

const internalsById = new Map<ChatId | 'new', ChatModelInternals>()

const isLiveStatus = (message: MessageRecord) =>
  message.role === 'assistant' &&
  (message.status === 'waiting' || message.status === 'streaming')

export const mergeMessage = (
  messages: Map<MessageId, MessageRecord>,
  incoming: MessageRecord,
): Map<MessageId, MessageRecord> => {
  const known = messages.get(incoming.id)
  if (known && known.rev >= incoming.rev) return messages
  const next = new Map(messages)
  next.set(incoming.id, incoming)
  return next
}

const reatomChatModel = (id: ChatId | 'new'): ChatModel => {
  const name = `chat.model#${id}`
  const isPending = id === 'new'

  const record = computed(
    (): ChatRecord | null =>
      isPending
        ? null
        : (libraryRecords().find((chat) => chat.id === id) ?? null),
    `${name}.record`,
  )

  const loadState = computed(() => {
    if (isPending) return 'ready' as const
    const status = library.status()
    if (status === 'loading') return 'loading' as const
    if (status === 'error') return 'error' as const
    const current = record()
    if (!current) return 'missing' as const
    if (current.deletedAt !== null) {
      const notice = deletedElsewhere()
      if (notice?.chatId === id && notice.expiresAt > now()) return 'ready' as const
      return 'deleted' as const
    }
    return 'ready' as const
  }, `${name}.loadState`)

  const messagesLoadState = atom<'idle' | 'loading' | 'ready' | 'error'>(
    isPending ? 'ready' : 'idle',
    `${name}.messagesLoadState`,
  )

  const loadMessages = action(async () => {
    if (isPending) return
    messagesLoadState.set('loading')
    try {
      const stored = await wrap(repo.listMessages(id))
      let merged = messages()
      for (const message of stored) merged = mergeMessage(merged, message)
      messages.set(merged)
      messagesLoadState.set('ready')
    } catch (error) {
      messagesLoadState.set('error')
      throw error
    }
  }, `${name}.loadMessages`).extend(withAsync())

  const messages = atom(
    new Map<MessageId, MessageRecord>(),
    `${name}.messages`,
  ).extend(
    withConnectHook(() => {
      if (messagesLoadState() === 'idle') loadMessages().catch(() => {})
    }),
  )

  const path = computed(
    () => buildPath(messages().values(), record()?.selection ?? {}),
    `${name}.path`,
  )

  const pendingModel = atom<string | null>(null, `${name}.pendingModel`)
  const pendingSettings = atom<ChatSettings | null>(
    null,
    `${name}.pendingSettings`,
  )

  const presetId = atom<PresetId | null>(null, `${name}.presetId`).extend(
    withComputed((state) =>
      isPending ? state : (record()?.presetId ?? null),
    ),
    withChangeHook((next) => {
      if (isPending) return
      const current = record()
      if (!current || current.presetId === next) return
      patchChat(id, { presetId: next }).catch(() => {})
    }),
  )

  const model = computed((): string | null => {
    if (!isPending) return record()?.model ?? null
    return pendingModel() ?? resolveNewChatModel({ presetModel: null })
  }, `${name}.model`)

  const settings = computed(
    (): ChatSettings =>
      isPending
        ? (pendingSettings() ?? createDefaultChatSettings())
        : (record()?.settings ?? createDefaultChatSettings()),
    `${name}.settings`,
  )

  const draft = reatomDraft(id, `${name}.draft`)

  const streaming = computed((): {
    messageId: MessageId
    local: boolean
  } | null => {
    const local = localStreams().get(id)
    if (local) return { messageId: local.messageId, local: true }
    if (isPending) {
      const startingId = startingNewChatId()
      const starting = startingId ? localStreams().get(startingId) : undefined
      return starting ? { messageId: starting.messageId, local: true } : null
    }
    if (!remoteStreams().has(id) && !streamHeldElsewhere(id)()) return null
    let live: MessageRecord | null = null
    for (const message of messages().values()) {
      if (!isLiveStatus(message)) continue
      if (!live || message.createdAt > live.createdAt) live = message
    }
    return live ? { messageId: live.id, local: false } : null
  }, `${name}.streaming`)

  const sendBlock = computed((): SendBlock | null => {
    if (!apiKey()) return { code: 'no-key', label: 'Connect to continue' }
    if (
      localStreams().has(id) ||
      (isPending && startingNewChatId() !== null)
    ) {
      return { code: 'streaming', label: 'Generating reply' }
    }
    if (!isPending && record()?.deletedAt !== null) {
      return {
        code: 'remote-lock',
        label: 'This chat was deleted in another tab.',
      }
    }
    if (!isPending && (streamHeldElsewhere(id)() || remoteStreams().has(id))) {
      return {
        code: 'remote-lock',
        label: 'This chat is still generating in another tab.',
      }
    }
    if (!model()) return { code: 'no-model', label: 'Choose a model' }
    if (!isOnline()) return { code: 'offline', label: 'Send (offline)' }
    if (unlimitedAckNeeded()) {
      return { code: 'unlimited-ack', label: 'Confirm the key has no limit' }
    }
    const hasText = draft.text().trim().length > 0
    const hasAttachments = draft.attachments().length > 0
    if (!hasText && !hasAttachments) return { code: 'empty', label: 'Send' }
    for (const contributor of sendBlockContributors.list()) {
      const block = contributor(chatModel)
      if (block) return block
    }
    return null
  }, `${name}.sendBlock`)

  const totalCost = computed(() => {
    let amount = 0
    let hasEstimate = false
    for (const message of messages().values()) {
      if (message.role !== 'assistant') continue
      if (message.usage) {
        amount += message.usage.cost
      } else if (message.estimateCost > 0) {
        amount += message.estimateCost
        hasEstimate = true
      }
      for (const extra of message.extraUsage) amount += extra.cost
    }
    return { amount, hasEstimate }
  }, `${name}.totalCost`)

  const unsaved = computed(() => unsavedChats().has(id), `${name}.unsaved`)

  const selectVersion = action((messageId: MessageId): void => {
    const current = record()
    const message = messages().get(messageId)
    if (!current || !message) return
    const key = selectionKeyOf(message)
    if (current.selection[key] === messageId) return
    patchChat(id, {
      selection: { ...current.selection, [key]: messageId },
    }).catch(() => {})
  }, `${name}.selectVersion`)

  const setModel = action((modelId: string): void => {
    const trimmed = modelId.trim()
    if (trimmed.length === 0) return
    recordPick(trimmed)
    if (isPending) {
      pendingModel.set(trimmed)
      return
    }
    if (record()?.model === trimmed) return
    patchChat(id, { model: trimmed }).catch(() => {})
  }, `${name}.setModel`)

  const updateSettings = action((patch: Partial<ChatSettings>): void => {
    if (isPending) {
      pendingSettings.set({
        ...(pendingSettings() ?? createDefaultChatSettings()),
        ...patch,
      })
      return
    }
    const current = record()
    if (!current) return
    patchChat(id, { settings: { ...current.settings, ...patch } }).catch(
      () => {},
    )
  }, `${name}.updateSettings`)

  internalsById.set(id, {
    loadMessages: async () => {
      if (messagesLoadState() === 'ready') return
      await loadMessages()
    },
    reloadStoredMessages: () => loadMessages(),
    messagesLoaded: () => messagesLoadState() === 'ready',
    resetPending: () => {
      pendingModel.set(null)
      pendingSettings.set(null)
      presetId.set(null)
    },
  })

  const chatModel: ChatModel = {
    id,
    record,
    loadState,
    messages,
    path,
    model,
    settings,
    presetId,
    draft: { text: draft.text, attachments: draft.attachments },
    streaming,
    sendBlock,
    totalCost,
    unsaved,
    selectVersion,
    setModel,
    updateSettings,
  }
  return chatModel
}

const chatModels = new Map<ChatId | 'new', ChatModel>()

export const getChatModel = (id: ChatId | 'new'): ChatModel => {
  let chatModel = chatModels.get(id)
  if (!chatModel) {
    chatModel = reatomChatModel(id)
    chatModels.set(id, chatModel)
  }
  return chatModel
}

export const chatModelInternals = (id: ChatId | 'new'): ChatModelInternals => {
  getChatModel(id)
  return internalsById.get(id)!
}

export const knownChatModel = (id: ChatId): ChatModel | undefined =>
  chatModels.get(id)

export const activeChat = computed(
  () => getChatModel(activeChatId()),
  'chat.activeChat',
)

addCallHook(reloadFromStorage, () => {
  library.reload().catch(() => {})
  const opened = activeChatId()
  if (opened === 'new') return
  chatModelInternals(opened).reloadStoredMessages().catch(() => {})
})

addCallHook(syncReceived, (event) => {
  if (event.type === 'message') {
    const chatModel = chatModels.get(event.message.chatId)
    if (!chatModel) return
    chatModel.messages.set((messages) => mergeMessage(messages, event.message))
    return
  }
  if (event.type === 'message-deleted') {
    const chatModel = chatModels.get(event.chatId)
    if (!chatModel || !chatModel.messages().has(event.messageId)) return
    chatModel.messages.set((messages) => {
      const next = new Map(messages)
      next.delete(event.messageId)
      return next
    })
  }
})

addCallHook(chatPurged, (chatId) => {
  chatModels.get(chatId)?.messages.set(new Map())
})
