import { now } from '../platform/env'
import type { TabId } from '../platform/types'
import { createChatRecord, createDefaultChatSettings } from '../storage/records'
import { repo } from '../storage/repo'
import type {
  AssistantMessage,
  AssistantStatus,
  AttachmentRef,
  ChatId,
  ChatSettings,
  MessageId,
  MessageRecord,
  UserMessage,
} from '../storage/types'

export interface SeedMessageSpec {
  id?: MessageId
  role: 'user' | 'assistant'
  content: string
  parentId?: MessageId | null
  rev?: number
  status?: AssistantStatus
  model?: string
  createdAt?: number
  attachments?: AttachmentRef[]
}

export interface SeedChatSpec {
  id?: ChatId
  title?: string
  titleSource?: 'auto' | 'manual'
  model?: string | null
  pinnedAt?: number | null
  lastActivityAt?: number
  createdAt?: number
  deletedAt?: number | null
  deletedByTab?: TabId | null
  settings?: ChatSettings
  messages?: readonly SeedMessageSpec[]
}

const assistantShell = (
  spec: SeedMessageSpec,
  identity: { id: MessageId; chatId: ChatId; parentId: MessageId | null; at: number },
): AssistantMessage => ({
  id: identity.id,
  chatId: identity.chatId,
  parentId: identity.parentId,
  createdAt: spec.createdAt ?? identity.at,
  rev: spec.rev ?? 1,
  role: 'assistant',
  model: spec.model ?? 'openai/gpt-4o-mini',
  content: spec.content,
  status: spec.status ?? 'done',
  reasoning: null,
  refusal: null,
  finishReason: 'stop',
  error: null,
  usage: null,
  extraUsage: [],
  estimateCost: 0,
  generationId: null,
  provider: null,
  timing: {
    requestAt: spec.createdAt ?? identity.at,
    firstTokenAt: null,
    endAt: null,
  },
  citations: [],
  ownerTab: 'seed',
  compareGroup: null,
})

const userShell = (
  spec: SeedMessageSpec,
  identity: { id: MessageId; chatId: ChatId; parentId: MessageId | null; at: number },
): UserMessage => ({
  id: identity.id,
  chatId: identity.chatId,
  parentId: identity.parentId,
  createdAt: spec.createdAt ?? identity.at,
  rev: spec.rev ?? 1,
  role: 'user',
  content: spec.content,
  attachments: spec.attachments ?? [],
})

const messageFromSpec = (
  spec: SeedMessageSpec,
  identity: { id: MessageId; chatId: ChatId; parentId: MessageId | null; at: number },
): MessageRecord =>
  spec.role === 'user' ? userShell(spec, identity) : assistantShell(spec, identity)

export const seedChats = async (
  spec: readonly SeedChatSpec[],
): Promise<ChatId[]> => {
  const ids: ChatId[] = []
  for (const [index, chatSpec] of spec.entries()) {
    const at =
      chatSpec.createdAt ??
      chatSpec.lastActivityAt ??
      now() - (spec.length - index) * 1000
    const id = chatSpec.id ?? `chat-${index + 1}`
    const record = createChatRecord({
      id,
      at,
      title: chatSpec.title,
      model: chatSpec.model,
      settings: chatSpec.settings ?? createDefaultChatSettings(),
    })
    if (chatSpec.titleSource) record.titleSource = chatSpec.titleSource
    if (chatSpec.pinnedAt !== undefined) record.pinnedAt = chatSpec.pinnedAt
    if (chatSpec.lastActivityAt !== undefined) {
      record.lastActivityAt = chatSpec.lastActivityAt
    }
    if (chatSpec.deletedAt !== undefined) record.deletedAt = chatSpec.deletedAt
    if (chatSpec.deletedByTab !== undefined) {
      record.deletedByTab = chatSpec.deletedByTab
    }
    await repo.createChat(record)
    let previousId: MessageId | null = null
    for (const [messageIndex, messageSpec] of (
      chatSpec.messages ?? []
    ).entries()) {
      const messageId = messageSpec.id ?? `${id}-m${messageIndex + 1}`
      const parentId =
        messageSpec.parentId === undefined ? previousId : messageSpec.parentId
      await repo.putMessage(
        messageFromSpec(messageSpec, {
          id: messageId,
          chatId: id,
          parentId,
          at: at + messageIndex + 1,
        }),
      )
      previousId = messageId
    }
    ids.push(id)
  }
  return ids
}
