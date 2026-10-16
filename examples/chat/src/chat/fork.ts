import { action, withAsync, wrap } from '@reatom/core'

import { now } from '../platform/env'
import { openChat } from '../routes'
import { createChatRecord } from '../storage/records'
import { repo } from '../storage/repo'
import type {
  ChatId,
  ChatSettings,
  MessageId,
  MessageRecord,
} from '../storage/types'
import { chatModelInternals, getChatModel } from './chatModel'
import { createChat } from './library'
import { publishSync } from './syncPublisher'
import { ancestorChain, selectionKeyOf } from './tree'

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const copySettings = (settings: ChatSettings): ChatSettings => ({
  ...settings,
  params: { ...settings.params },
  privacyOverride: settings.privacyOverride
    ? { ...settings.privacyOverride }
    : null,
  routing:
    settings.routing.mode === 'auto'
      ? { ...settings.routing }
      : { ...settings.routing, providers: [...settings.routing.providers] },
})

const copyMessage = (
  message: MessageRecord,
  identity: { id: MessageId; chatId: ChatId; parentId: MessageId | null },
): MessageRecord => {
  if (message.role === 'user') {
    return {
      ...message,
      ...identity,
      rev: 1,
      attachments: message.attachments.map((ref) => ({ ...ref })),
    }
  }
  return {
    ...message,
    ...identity,
    rev: 1,
    usage: message.usage ? { ...message.usage } : null,
    extraUsage: message.extraUsage.map((item) => ({ ...item })),
    timing: { ...message.timing },
    citations: message.citations.map((citation) => ({ ...citation })),
    reasoning: message.reasoning
      ? { ...message.reasoning, details: [...message.reasoning.details] }
      : null,
    error: message.error
      ? {
          ...message.error,
          secondary: [...message.error.secondary],
          details: { ...message.error.details },
        }
      : null,
  }
}

export const forkChat = action(
  async (chatId: ChatId, atMessageId: MessageId): Promise<ChatId> => {
    const source = getChatModel(chatId)
    await wrap(chatModelInternals(chatId).loadMessages())
    const record = source.record()
    const target = source.messages().get(atMessageId)
    if (!record || record.deletedAt !== null || !target) {
      throw new Error('Cannot fork this message')
    }

    const path = ancestorChain(source.messages(), atMessageId)
    const forkedId = createId()
    const at = now()
    const idMap = new Map<MessageId, MessageId>()
    const copies: MessageRecord[] = []
    for (const message of path) {
      const id = createId()
      idMap.set(message.id, id)
      copies.push(
        copyMessage(message, {
          id,
          chatId: forkedId,
          parentId: message.parentId
            ? (idMap.get(message.parentId) ?? null)
            : null,
        }),
      )
    }

    const selection: Record<string, MessageId> = {}
    for (const message of copies)
      selection[selectionKeyOf(message)] = message.id
    const forked = createChatRecord({
      id: forkedId,
      at,
      title: `${record.title} (fork)`,
      model: record.model,
      presetId: record.presetId,
      settings: copySettings(record.settings),
    })
    forked.titleSource = 'manual'
    forked.selection = selection
    forked.lastActivityAt = at

    await wrap(createChat(forked))
    for (const message of copies) {
      await wrap(repo.putMessage(message))
      publishSync({ type: 'message', message })
    }
    getChatModel(forkedId).messages.set(
      new Map(copies.map((message) => [message.id, message])),
    )
    openChat(forkedId)
    return forkedId
  },
  'chat.fork',
).extend(withAsync())
