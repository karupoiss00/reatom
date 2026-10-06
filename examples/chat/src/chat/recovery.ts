import { action, onEvent, withAsync, wrap } from '@reatom/core'

import { now } from '../platform/env'
import { repo } from '../storage/repo'
import type { AssistantMessage, ChatId } from '../storage/types'
import { acquireStreamLock } from '../sync'
import { knownChatModel, mergeMessage } from './chatModel'
import { localStreams, remoteStreams } from './streams'
import { publishSync } from './syncPublisher'

const isLive = (message: AssistantMessage) =>
  message.status === 'waiting' || message.status === 'streaming'

const interruptedVersion = (message: AssistantMessage): AssistantMessage => ({
  ...message,
  status: 'interrupted',
  rev: message.rev + 1,
  reasoning:
    message.reasoning && message.reasoning.endedAt === null
      ? { ...message.reasoning, endedAt: message.timing.endAt ?? now() }
      : message.reasoning,
  timing: { ...message.timing, endAt: message.timing.endAt ?? now() },
})

const collectLiveMessages = async () => {
  const live = new Map<ChatId, AssistantMessage[]>()
  await repo.scanMessages((message) => {
    if (message.role !== 'assistant' || !isLive(message)) return
    const list = live.get(message.chatId)
    if (list) list.push(message)
    else live.set(message.chatId, [message])
  })
  for (const chatModel of [...live.keys()].map(knownChatModel)) {
    for (const message of chatModel?.messages().values() ?? []) {
      if (message.role !== 'assistant' || !isLive(message)) continue
      const list = live.get(message.chatId) ?? []
      if (!list.some((known) => known.id === message.id)) list.push(message)
    }
  }
  return live
}

let triggersInstalled = false

const installRecoveryTriggers = () => {
  if (triggersInstalled || typeof document === 'undefined') return
  triggersInstalled = true
  onEvent(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      recoverInterrupted().catch(() => {})
    }
  })
  onEvent(window, 'pageshow', () => {
    recoverInterrupted().catch(() => {})
  })
}

export const recoverInterrupted = action(async (): Promise<void> => {
  installRecoveryTriggers()
  const live = await wrap(collectLiveMessages())
  for (const [chatId, messages] of live) {
    if (localStreams().has(chatId) || remoteStreams().has(chatId)) continue
    const lock = await wrap(acquireStreamLock(chatId))
    if (!lock) continue
    try {
      if (localStreams().has(chatId)) continue
      for (const message of messages) {
        const interrupted = interruptedVersion(message)
        knownChatModel(chatId)?.messages.set((current) =>
          mergeMessage(current, interrupted),
        )
        await wrap(repo.putMessage(interrupted))
        publishSync({ type: 'message', message: interrupted })
      }
    } finally {
      await wrap(lock.release())
    }
  }
}, 'chat.engine.recoverInterrupted').extend(withAsync())
