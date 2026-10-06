import { action, wrap } from '@reatom/core'

import { keyMeta, rememberKey, startOAuth } from '../../auth'
import { catalogById } from '../../catalog'
import { chatTitle } from '../../chat/title'
import { rootSelectionKey } from '../../chat/tree'
import { regenerate, retry } from '../../chat/engine'
import type { ChatModel } from '../../chat/types'
import { createChat } from '../../chat/library'
import { now } from '../../platform/env'
import { openExternal } from '../../platform/external'
import { ui } from '../../app/ui'
import { openChat } from '../../routes'
import { createChatRecord } from '../../storage/records'
import { repo } from '../../storage/repo'
import type {
  ChatId,
  MessageId,
  MessageRecord,
  ReasoningEffort,
} from '../../storage/types'
import { addCreditsUrl, keyPageUrl } from '../keychip/model'
import type { ErrorAction, ErrorInfo } from '../../errors/types'

const effortLadder = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[]

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${now().toString(36)}-${Math.random().toString(36).slice(2)}`

const returnToPath = (): string | null => {
  const path = `${location.pathname}${location.search}${location.hash}`
  return path.startsWith('/c/') ? path : null
}

const lowerEffort = (
  current: ReasoningEffort | undefined,
  supported: ReasoningEffort[] | null,
): ReasoningEffort => {
  const ladder = supported?.length
    ? effortLadder.filter((step) => supported.includes(step))
    : [...effortLadder]
  const start =
    current && ladder.includes(current) ? current : (ladder.at(-1) ?? 'medium')
  const index = Math.max(0, ladder.indexOf(start))
  return ladder[Math.max(0, index - 1)] ?? start
}

const higherMaxTokens = (current: number | undefined, cap: number | null) => {
  const base = current && current > 0 ? current : 256
  const doubled = base * 2
  if (cap !== null && cap > base) return Math.min(doubled, cap)
  return doubled
}

const keptTail = (chat: ChatModel): MessageRecord[] =>
  chat
    .path()
    .map((node) => node.message)
    .slice(-4)
    .filter((message) => {
      if (message.role !== 'assistant') return true
      return message.error === null || message.content.length > 0
    })

export const openChatFromTail = action(async (chat: ChatModel) => {
  const kept = keptTail(chat)
  if (kept.length === 0) return
  const chatId: ChatId = createId()
  const at = now()
  const copies: MessageRecord[] = []
  const selection: Record<string, MessageId> = {}
  let parentId: MessageId | null = null
  for (const [index, message] of kept.entries()) {
    const id = createId()
    selection[parentId ?? rootSelectionKey] = id
    if (message.role === 'user') {
      copies.push({
        ...message,
        id,
        chatId,
        parentId,
        createdAt: at + index,
        rev: 1,
      })
    } else {
      copies.push({
        ...message,
        id,
        chatId,
        parentId,
        createdAt: at + index,
        rev: 1,
        error: null,
        status: message.content.length > 0 ? 'done' : message.status,
      })
    }
    parentId = id
  }
  const firstUser = copies.find((message) => message.role === 'user')
  const record = {
    ...createChatRecord({
      id: chatId,
      at,
      title: chatTitle(firstUser?.role === 'user' ? firstUser.content : '') || 'New chat',
      model: chat.model(),
      settings: chat.settings(),
    }),
    selection,
  }
  await wrap(createChat(record))
  for (const message of copies) await wrap(repo.putMessage(message))
  openChat(chatId)
}, 'features.errors.openChatFromTail')

const switchModel = (
  chat: ChatModel,
  assistantId: MessageId,
  modelId: string | undefined,
) => {
  if (!modelId || chat.id === 'new') return
  chat.setModel(modelId)
  regenerate(chat.id, assistantId, { model: modelId })
}

export const runErrorAction = (input: {
  chat: ChatModel
  assistantId: MessageId
  parentId: MessageId | null
  action: ErrorAction
  suggestions: ErrorInfo['suggestions']
  releaseRetry: () => void
}) => {
  const { chat, assistantId, action: item } = input
  if (item.disabled && item.id !== 'retry') return
  switch (item.id) {
    case 'retry':
      if (chat.id === 'new') return
      retry(chat.id, assistantId)
      return
    case 'reconnect': {
      const limit = keyMeta.data()?.limit ?? null
      startOAuth({
        limit: limit !== null && limit > 0 ? limit : 10,
        remember: rememberKey(),
        returnTo: returnToPath(),
      })
      return
    }
    case 'add-credits':
      openExternal(addCreditsUrl)
      return
    case 'raise-limit':
      openExternal(keyPageUrl())
      return
    case 'edit-message':
      if (input.parentId) ui.editing.set(input.parentId)
      return
    case 'pick-model':
      ui.picker.set({ purpose: 'chat' })
      return
    case 'switch-longer-context':
      switchModel(chat, assistantId, item.modelId ?? input.suggestions?.[0]?.id)
      return
    case 'new-chat-last-4':
      openChatFromTail(chat)
      return
    case 'use-paid':
    case 'try-fallback':
      switchModel(chat, assistantId, item.modelId)
      return
    case 'loosen-privacy':
      chat.updateSettings({
        privacyOverride: { denyDataCollection: false, zdr: false },
      })
      input.releaseRetry()
      return
    case 'loosen-routing':
      chat.updateSettings({ routing: { mode: 'auto', allowFallbacks: true } })
      return
    case 'reset-params-retry':
      chat.updateSettings({ params: {} })
      if (chat.id !== 'new') retry(chat.id, assistantId)
      return
    case 'retry-lower-effort': {
      if (chat.id === 'new') return
      const model = catalogById().get(chat.model() ?? '')
      regenerate(chat.id, assistantId, {
        reasoningEffort: lowerEffort(
          chat.settings().params.reasoningEffort,
          model?.supportedEfforts ?? null,
        ),
      })
      return
    }
    case 'retry-higher-max-tokens': {
      if (chat.id === 'new') return
      const model = catalogById().get(chat.model() ?? '')
      regenerate(chat.id, assistantId, {
        maxTokens: higherMaxTokens(
          chat.settings().params.maxTokens,
          model?.maxCompletionTokens ?? null,
        ),
      })
      return
    }
    case 'send-without-web-search':
      chat.updateSettings({ webSearch: false })
      if (chat.id !== 'new') {
        regenerate(chat.id, assistantId, { noWebSearch: true })
      }
      return
  }
}
