import type { TabId } from '../platform/types'

export type { TabId }

export type ChatId = string
export type MessageId = string
export type PresetId = string
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
export type PdfEngineLabel = 'text' | 'ocr' | 'native'

export interface ChatParams {
  temperature?: number
  topP?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
}
export interface PrivacySettings {
  denyDataCollection: boolean
  zdr: boolean
}
export type RoutingSettings =
  | { mode: 'auto'; allowFallbacks: boolean }
  | { mode: 'order' | 'only'; providers: string[]; allowFallbacks: boolean }
export interface ChatSettings {
  systemPrompt: string
  params: ChatParams // absent key = model default, never sent
  privacyOverride: PrivacySettings | null // null = "Using global privacy"
  routing: RoutingSettings // default { mode: 'auto', allowFallbacks: true }
  webSearch: boolean // default false
}
export type ChatMetaField =
  | 'title'
  | 'titleSource'
  | 'lastActivityAt'
  | 'pinnedAt'
  | 'model'
  | 'presetId'
  | 'settings'
  | 'selection'
  | 'deletedAt'
  | 'deletedByTab'
export interface ChatRecord {
  id: ChatId
  createdAt: number
  title: string
  titleSource: 'auto' | 'manual'
  lastActivityAt: number
  pinnedAt: number | null
  model: string | null
  presetId: PresetId | null
  settings: ChatSettings
  selection: Record<string, MessageId> // 'root' | parent MessageId -> selected child
  deletedAt: number | null
  deletedByTab: TabId | null
  imported: boolean
  clock: Partial<Record<ChatMetaField, number>>
}

export interface AttachmentRef {
  id: string
  kind: 'image' | 'pdf'
  name: string
  mime: string
  size: number
  pages?: number
  pdfEngine?: PdfEngineLabel
}
export interface AttachmentBlob {
  id: string
  dataUrl: string
}
export interface UsageRecord {
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cost: number
  isByok: boolean
  source: 'usage' | 'generation'
}
export interface Citation {
  url: string
  title: string | null
  domain: string
}
export type AssistantStatus =
  | 'waiting'
  | 'streaming'
  | 'done'
  | 'stopped'
  | 'interrupted'
  | 'connection-lost'
  | 'error'
  | 'cut-off'
  | 'refused'
interface MessageBase {
  id: MessageId
  chatId: ChatId
  parentId: MessageId | null
  createdAt: number
  rev: number
}
export interface UserMessage extends MessageBase {
  role: 'user'
  content: string
  attachments: AttachmentRef[]
}
export interface AssistantMessage extends MessageBase {
  role: 'assistant'
  model: string
  content: string
  status: AssistantStatus
  reasoning: {
    text: string
    details: unknown[]
    startedAt: number | null
    endedAt: number | null
    hiddenByProvider: boolean
    stoppedWhileThinking: boolean
  } | null
  refusal: string | null
  finishReason: string | null
  error: import('../errors/types').ErrorInfo | null
  usage: UsageRecord | null
  extraUsage: UsageRecord[] // F-26 Continue requests, summed in the footer
  estimateCost: number // monotonic live estimate (F-11)
  generationId: string | null
  provider: string | null // chunk.provider or X-Provider-Name only
  timing: {
    requestAt: number
    firstTokenAt: number | null
    endAt: number | null
  }
  citations: Citation[]
  ownerTab: TabId
  compareGroup: string | null // F-25
}
export type MessageRecord = UserMessage | AssistantMessage
export interface DraftRecord {
  chatId: ChatId | 'new'
  tabId: TabId
  text: string
  attachments: AttachmentRef[]
  updatedAt: number
}
export interface PresetRecord {
  id: PresetId
  name: string
  systemPrompt: string
  model: string | null
  params: ChatParams
  isDefault: boolean
  createdAt: number
  deletedAt: number | null
  deletedByTab: TabId | null
}

export type DbHealth =
  | { status: 'opening' }
  | { status: 'ok' }
  | { status: 'memory'; reason: 'open-failed' } // F-22b private mode
  | { status: 'error'; reason: 'blocked' | 'read-failed' } // F-13 / F-05b "Couldn't open saved chats."
export type WriteFailure = {
  reason: 'quota' | 'blocked' | 'unknown'
  at: number
}

export interface Repo {
  listChats(): Promise<ChatRecord[]> // includes tombstones
  getChat(id: ChatId): Promise<ChatRecord | undefined>
  createChat(chat: ChatRecord): Promise<void>
  putChatFields(
    id: ChatId,
    fields: Partial<Omit<ChatRecord, 'id' | 'clock'>>,
    at: number,
    options?: { mirrorRejected?: boolean },
  ): Promise<ChatRecord>
  listMessages(chatId: ChatId): Promise<MessageRecord[]>
  putMessage(message: MessageRecord): Promise<void> // rev merge
  deleteMessage(id: MessageId): Promise<void> // only for the R-5 drop
  purgeChat(id: ChatId): Promise<void> // chat, messages, drafts, attachments
  getDraft(chatId: ChatId | 'new', tab: TabId): Promise<DraftRecord | undefined>
  latestDraft(chatId: ChatId): Promise<DraftRecord | undefined>
  putDraft(draft: DraftRecord): Promise<void>
  deleteDraft(chatId: ChatId | 'new', tab: TabId): Promise<void>
  putAttachment(blob: AttachmentBlob): Promise<void>
  getAttachment(id: string): Promise<AttachmentBlob | undefined>
  listPresets(): Promise<PresetRecord[]>
  putPreset(preset: PresetRecord): Promise<void>
  purgePreset(id: PresetId): Promise<void>
  scanMessages(visit: (message: MessageRecord) => boolean | void): Promise<void> // return true to stop
  deleteAllChatsAndPresets(): Promise<void>
  bulkImport(input: {
    chats: ChatRecord[]
    messages: MessageRecord[]
    presets: PresetRecord[]
    attachments: AttachmentBlob[]
  }): Promise<void>
}
