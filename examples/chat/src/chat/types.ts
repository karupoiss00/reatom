import type { Action, Atom, Computed } from '@reatom/core'

import type { CatalogModel } from '../catalog/types'
import type {
  AttachmentRef,
  ChatId,
  ChatRecord,
  ChatSettings,
  Citation,
  MessageId,
  MessageRecord,
  PresetId,
  ReasoningEffort,
  UsageRecord,
} from '../storage/types'

export type { CatalogModel }

export interface ThreadNode {
  message: MessageRecord
  versions: MessageId[]
  versionIndex: number
}
export type WireContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; imageUrl: { url: string } }
      | { type: 'file'; file: { filename: string; fileData: string } }
    >
export type WireToolCallApproval =
  | 'waiting'
  | 'calling'
  | 'completed'
  | 'denied'
  | 'error'
export interface WireToolCall {
  id: string
  name: string
  arguments: string
  approval?: WireToolCallApproval
}
export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: WireContent
  reasoningDetails?: unknown[]
  toolCallId?: string
  toolCalls?: WireToolCall[]
}
export const wireMessageRoles = [
  'system',
  'user',
  'assistant',
  'tool',
] as const satisfies readonly WireMessage['role'][]
export type StreamEvent =
  | { kind: 'id'; id: string }
  | { kind: 'provider'; name: string }
  | { kind: 'content'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'reasoning-details'; details: unknown[] }
  | { kind: 'refusal'; text: string }
  | { kind: 'citations'; items: Citation[] }
  | { kind: 'finish'; reason: string }
  | { kind: 'usage'; usage: UsageRecord }
  | {
      kind: 'error'
      code: number | null
      message: string
      metadata?: Record<string, unknown>
    }
  | {
      kind: 'tool_calls'
      calls: Array<{
        id: string
        name: string
        arguments: string
      }>
    }
export const streamEventKinds = [
  'id',
  'provider',
  'content',
  'reasoning',
  'reasoning-details',
  'refusal',
  'citations',
  'finish',
  'usage',
  'error',
  'tool_calls',
] as const satisfies readonly StreamEvent['kind'][]
export type SendBlockCode =
  | 'no-key'
  | 'no-model'
  | 'offline'
  | 'empty'
  | 'streaming'
  | 'remote-lock'
  | 'unlimited-ack'
  | 'compare-pending'
  | 'unsupported-attachment'
export interface SendBlock {
  code: SendBlockCode
  label: string
} // label is Send's accessible name / visible reason
export interface SendInput {
  text: string
  attachments: AttachmentRef[]
}
export interface RequestOverrides {
  model?: string
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  noWebSearch?: boolean
}
export type StreamLifecycle =
  | {
      type: 'started' | 'first-token' | 'completed' | 'stopped'
      chatId: ChatId
      messageId: MessageId
    }
  | { type: 'failed'; chatId: ChatId; messageId: MessageId; title: string }

/**
 * Registered into `sendBlockContributors` (chat/chatModel.ts); the first
 * non-null result after the built-in checks becomes `chat.sendBlock`.
 */
export type SendBlockContributor = (chat: ChatModel) => SendBlock | null

// chat/chatModel.ts — memoized per chat id ('new' = pending chat at "/")
export interface ChatModel {
  id: ChatId | 'new'
  record: Computed<ChatRecord | null>
  loadState: Computed<'loading' | 'ready' | 'missing' | 'deleted' | 'error'>
  messages: Atom<Map<MessageId, MessageRecord>>
  path: Computed<ThreadNode[]>
  model: Computed<string | null> // record.model, or R-2 for a pending chat
  settings: Computed<ChatSettings> // record.settings, or in-memory for the pending chat until first send
  presetId: Atom<PresetId | null> // record.presetId, or in-memory for the pending chat until first send
  draft: { text: Atom<string>; attachments: Atom<AttachmentRef[]> } // persisted, debounced
  streaming: Computed<{ messageId: MessageId; local: boolean } | null>
  sendBlock: Computed<SendBlock | null> // built-in checks, then folds sendBlockContributors
  totalCost: Computed<{ amount: number; hasEstimate: boolean }>
  unsaved: Computed<boolean> // F-05b "Not saved on this device"
  selectVersion: Action<[messageId: MessageId], void>
  setModel: Action<[modelId: string], void> // F-04b; also recordPick
  updateSettings: Action<[patch: Partial<ChatSettings>], void>
}
