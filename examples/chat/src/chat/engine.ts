import {
  abortVar,
  action,
  addCallHook,
  computed,
  isAbort,
  withAbort,
  withAsync,
  wrap,
} from '@reatom/core'

import { streamChat } from '../api/stream'
import { unlimitedAckNeeded } from '../auth/ack'
import { keyMeta, refreshKeyMeta } from '../auth/keyMeta'
import { apiKey } from '../auth/keyStore'
import { catalogById } from '../catalog/catalog'
import { curatedDefaults, modelName } from '../catalog/resolveModel'
import type { CatalogModel } from '../catalog/types'
import { timings } from '../app/timings'
import {
  classifyFailure,
  fromSdkError,
  fromStreamErrorChunk,
} from '../errors'
import {
  acquireMcpCall,
  isMcpWriteTool,
  mcpAlwaysAllows,
  rememberMcpAlwaysAllow,
  releaseMcpCall,
} from '../mcp/busy'
import { callMcpTool, mcpCallStoppedCopy } from '../mcp/call'
import { serializeToolResult } from '../mcp/intent'
import { mcpReady, mcpTools } from '../mcp'
import type {
  ClassifyContext,
  CompletionFailure,
  ErrorInfo,
} from '../errors/types'
import { estimateCost, estimateTokens } from '../money/estimate'
import { isOnline, now, tabId } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import { requestPersistOnce } from '../platform/storage-api'
import { activeChatId, openChat } from '../routes'
import { writeFailure } from '../storage/health'
import { globalPrivacy } from '../storage/prefs'
import { createChatRecord } from '../storage/records'
import { repo } from '../storage/repo'
import type {
  AssistantMessage,
  AssistantStatus,
  AttachmentBlob,
  ChatId,
  ChatRecord,
  ChatSettings,
  Citation,
  MessageId,
  MessageRecord,
  ToolCallRecord,
  UserMessage,
} from '../storage/types'
import { acquireStreamLock, streamHeldElsewhere } from '../sync'
import type { StreamLock } from '../sync/types'
import { chatModelInternals, getChatModel } from './chatModel'
import { contextCharacterCount, assembleContext } from './context'
import { pollGenerationUsage } from './generation'
import {
  chatPurged,
  chatsTombstoned,
  createChat,
  libraryRecords,
  patchChat,
} from './library'
import { streamItemToEvents } from './parse'
import { buildChatRequest, type McpToolSchema } from './request'
import {
  localStreams,
  markUnsaved,
  remoteStreams,
  setLocalStream,
  startingNewChatId,
  type LocalStream,
} from './streams'
import { publishSync } from './syncPublisher'
import { chatTitle } from './title'
import { ancestorChain, selectionKeyOf, siblingsOf } from './tree'
import type {
  ChatModel,
  RequestOverrides,
  SendInput,
  StreamEvent,
  StreamLifecycle,
  WireMessage,
} from './types'

export { compareSend } from './compare'
export { recoverInterrupted } from './recovery'

type ReplyKind = 'send' | 'retry' | 'regenerate' | 'edit'

interface ReplySpec {
  kind: ReplyKind
  chatId: ChatId | 'new'
  input?: SendInput
  assistantId?: MessageId
  userId?: MessageId
  overrides?: RequestOverrides
}

interface TurnPlan {
  chatId: ChatId
  chatModel: ChatModel
  settings: ChatSettings
  requestModel: string
  user: UserMessage
  newUser: UserMessage | null
  assistant: AssistantMessage
  newChat: ChatRecord | null
  selection: Record<string, MessageId>
  clearDraft: (() => void) | null
}

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const liveStatuses: readonly AssistantStatus[] = ['waiting', 'streaming']

const mergeToolArguments = (known: string, incoming: string) => {
  if (!incoming) return known
  if (!known) return incoming
  if (incoming.startsWith(known)) return incoming
  if (known.startsWith(incoming)) return known
  return known + incoming
}

const mergeToolCalls = (
  known: ToolCallRecord[] | undefined,
  incoming: Array<{ id: string; name: string; arguments: string }>,
): ToolCallRecord[] => {
  const byId = new Map((known ?? []).map((call) => [call.id, call]))
  for (const next of incoming) {
    const existing = byId.get(next.id)
    const merged: ToolCallRecord = {
      id: next.id,
      name: next.name || existing?.name || '',
      arguments: mergeToolArguments(existing?.arguments ?? '', next.arguments),
      status: existing?.status ?? 'waiting',
    }
    if (existing?.result !== undefined) merged.result = existing.result
    byId.set(next.id, merged)
  }
  return [...byId.values()]
}

const unresolvedToolCalls = (message: AssistantMessage) =>
  (message.toolCalls ?? []).filter(
    (call) => call.status === 'waiting' || call.status === 'calling',
  )

const connectedMcpTools = (settings: ChatSettings): McpToolSchema[] | undefined => {
  if (!settings.mcpEnabled || !mcpReady()) return undefined
  const tools = mcpTools()
  if (tools.length === 0) return undefined
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? tool.humanName,
    inputSchema: tool.inputSchema ?? {
      type: 'object',
      properties: {},
    },
  }))
}

const pausedForToolApproval = (
  message: AssistantMessage,
  finishReason: string | null,
) =>
  finishReason === 'tool_calls' ||
  unresolvedToolCalls(message).some((call) => call.status === 'waiting')

const newAssistantMessage = (input: {
  id: MessageId
  chatId: ChatId
  parentId: MessageId
  model: string
  at: number
}): AssistantMessage => ({
  id: input.id,
  chatId: input.chatId,
  parentId: input.parentId,
  createdAt: input.at,
  rev: 1,
  role: 'assistant',
  model: input.model,
  content: '',
  status: 'waiting',
  reasoning: null,
  refusal: null,
  finishReason: null,
  error: null,
  usage: null,
  extraUsage: [],
  estimateCost: 0,
  generationId: null,
  provider: null,
  timing: { requestAt: input.at, firstTokenAt: null, endAt: null },
  citations: [],
  ownerTab: tabId,
  compareGroup: null,
})

const hasInput = (input: SendInput | undefined) =>
  input !== undefined &&
  (input.text.trim().length > 0 || input.attachments.length > 0)

const canStartReply = (chatId: ChatId | 'new'): boolean => {
  if (!apiKey()) return false
  if (!isOnline()) return false
  if (unlimitedAckNeeded()) return false
  if (localStreams().has(chatId)) return false
  if (chatId === 'new' && startingNewChatId() !== null) return false
  if (chatId !== 'new') {
    const record = libraryRecords().find((chat) => chat.id === chatId)
    if (record?.deletedAt !== null) return false
    if (remoteStreams().has(chatId)) return false
    if (streamHeldElsewhere(chatId)()) return false
  }
  return true
}

const waitUntilLocalStreamClears = async (chatId: ChatId | 'new') => {
  if (!localStreams().has(chatId)) return
  await wrap(
    new Promise<void>((resolve) => {
      let settled = false
      let unsubscribe = () => {}
      const finish = () => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve()
      }
      unsubscribe = localStreams.subscribe(() => {
        if (!localStreams().has(chatId)) finish()
      })
      if (!localStreams().has(chatId)) finish()
    }),
  )
}

const chatSettingsOf = (chatId: ChatId | 'new'): ChatSettings | null =>
  chatId === 'new'
    ? getChatModel('new').settings()
    : (libraryRecords().find((chat) => chat.id === chatId)?.settings ?? null)

const loadAttachments = async (
  path: MessageRecord[],
): Promise<Map<string, AttachmentBlob>> => {
  const blobs = new Map<string, AttachmentBlob>()
  for (const message of path) {
    if (message.role !== 'user') continue
    for (const ref of message.attachments) {
      if (blobs.has(ref.id)) continue
      const blob = await repo.getAttachment(ref.id).catch(() => undefined)
      if (blob) blobs.set(ref.id, blob)
    }
  }
  return blobs
}

const writeFailureReason = (error: unknown) =>
  error instanceof DOMException && error.name === 'QuotaExceededError'
    ? ('quota' as const)
    : ('unknown' as const)

const reportWriteFailure = (chatId: ChatId, error: unknown) => {
  markUnsaved(chatId, true)
  if (!writeFailure()) {
    writeFailure.set({ reason: writeFailureReason(error), at: now() })
  }
}

const persistMessage = async (chatId: ChatId, message: MessageRecord) => {
  try {
    await wrap(repo.putMessage(message))
    publishSync({ type: 'message', message })
    return true
  } catch (error) {
    reportWriteFailure(chatId, error)
    return false
  }
}

const setMemoryMessage = (chatModel: ChatModel, message: MessageRecord) => {
  chatModel.messages.set((messages) => {
    const next = new Map(messages)
    next.set(message.id, message)
    return next
  })
}

const appendReasoningDetails = (
  known: unknown[],
  incoming: unknown[],
): unknown[] => {
  const merged = [...known]
  for (const detail of incoming) {
    const last = merged.at(-1) as Record<string, unknown> | undefined
    const next = detail as Record<string, unknown>
    const continuesLast =
      last !== undefined &&
      typeof next.index === 'number' &&
      last.index === next.index &&
      last.type === next.type &&
      (next.type === 'reasoning.text' || next.type === 'reasoning.summary')
    if (!continuesLast) {
      merged.push(detail)
      continue
    }
    const textKey = next.type === 'reasoning.text' ? 'text' : 'summary'
    merged[merged.length - 1] = {
      ...last,
      ...next,
      [textKey]: `${String(last[textKey] ?? '')}${String(next[textKey] ?? '')}`,
    }
  }
  return merged
}

const mergeCitations = (known: Citation[], incoming: Citation[]) => {
  const byUrl = new Map(known.map((citation) => [citation.url, citation]))
  for (const citation of incoming) {
    const existing = byUrl.get(citation.url)
    if (!existing || (!existing.title && citation.title)) {
      byUrl.set(citation.url, citation)
    }
  }
  return [...byUrl.values()]
}

const longerContextModels = (
  model: CatalogModel | null,
  byId: Map<string, CatalogModel>,
) =>
  [...byId.values()]
    .filter((candidate) => candidate.contextLength > (model?.contextLength ?? 0))
    .sort((a, b) => b.contextLength - a.contextLength)
    .slice(0, 3)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      contextLength: candidate.contextLength,
    }))

const buildClassifyContext = (input: {
  modelId: string
  provider: string | null
  settings: ChatSettings
  estimatedInputTokens: number
  contentReceived: boolean
  lastUser: UserMessage
  overrides: RequestOverrides | undefined
}): ClassifyContext & { contentReceived: boolean; modelInCatalog: boolean } => {
  const byId = catalogById()
  const model = byId.get(input.modelId) ?? null
  const freeSuffix = ':free'
  const paidModel = input.modelId.endsWith(freeSuffix)
    ? byId.get(input.modelId.slice(0, -freeSuffix.length))
    : undefined
  const fallbackId = curatedDefaults.find(
    (id) => id !== input.modelId && byId.has(id),
  )
  const privacy = input.settings.privacyOverride ?? globalPrivacy()
  const routing = input.settings.routing
  const meta = keyMeta.data()
  const params = input.settings.params
  return {
    modelId: input.modelId,
    modelName: modelName(input.modelId),
    provider: input.provider,
    paidVariant: paidModel ? { id: paidModel.id, name: paidModel.name } : null,
    fallbackModel: fallbackId
      ? { id: fallbackId, name: modelName(fallbackId) }
      : null,
    longerContextModels: longerContextModels(model, byId),
    privacyRestrictive: privacy.zdr || privacy.denyDataCollection,
    routingRestrictive: routing.mode !== 'auto' || !routing.allowFallbacks,
    keyLimit: meta ? { limit: meta.limit, reset: meta.limitReset } : null,
    estimatedInputTokens: input.estimatedInputTokens,
    contextLength: model?.contextLength ?? null,
    effortSupported:
      model !== null &&
      (model.supportedParameters.includes('reasoning') ||
        model.supportedParameters.includes('reasoning_effort')),
    maxTokensSet:
      (input.overrides?.maxTokens ?? params.maxTokens) !== undefined,
    webSearchOn: input.settings.webSearch && !input.overrides?.noWebSearch,
    zdrOn: privacy.zdr,
    attachmentName: input.lastUser.attachments[0]?.name ?? null,
    contentReceived: input.contentReceived,
    modelInCatalog: model !== null,
  }
}

const statusForError = (
  failure: CompletionFailure,
  info: ErrorInfo | null,
): AssistantStatus => {
  if (failure.source === 'network') return 'connection-lost'
  if (!info) return 'done'
  if (info.kind === 'cut-off') return 'cut-off'
  if (info.kind === 'refusal') return 'refused'
  if (info.kind === 'connection-lost') return 'connection-lost'
  return 'error'
}

const finishFailure = (
  message: AssistantMessage,
  finishReason: string,
): CompletionFailure => ({
  source: 'finish',
  finishReason:
    finishReason === 'length' || finishReason === 'content_filter'
      ? finishReason
      : 'stop',
  hasContent: message.content.length > 0,
  reasoningTokens: message.usage?.reasoningTokens ?? 0,
  refusal: message.refusal,
})

const streamErrorFailure = (
  event: Extract<StreamEvent, { kind: 'error' }>,
  rawChunk: unknown,
  contentReceived: boolean,
): CompletionFailure => {
  return (
    fromStreamErrorChunk(rawChunk, { contentReceived }) ?? {
      source: 'stream-error',
      code: event.code,
      message: event.message,
      metadata: event.metadata ?? {},
      contentReceived,
    }
  )
}

const dropFailedEmptySiblings = action(
  async (chatModel: ChatModel, succeeded: AssistantMessage) => {
    const siblings = siblingsOf(
      chatModel.messages().values(),
      succeeded.parentId,
    ).filter(
      (message): message is AssistantMessage =>
        message.role === 'assistant' &&
        message.id !== succeeded.id &&
        message.content.length === 0 &&
        message.error !== null &&
        !liveStatuses.includes(message.status),
    )
    if (siblings.length === 0) return
    chatModel.messages.set((messages) => {
      const next = new Map(messages)
      for (const sibling of siblings) next.delete(sibling.id)
      return next
    })
    for (const sibling of siblings) {
      await wrap(repo.deleteMessage(sibling.id).catch(() => {}))
      publishSync({
        type: 'message-deleted',
        chatId: sibling.chatId,
        messageId: sibling.id,
      })
    }
  },
  'chat.engine.dropFailedEmptySiblings',
).extend(withAsync())

export const streamLifecycle = action(
  (event: StreamLifecycle) => event,
  'chat.engine.streamLifecycle',
)

const costSettlements = new Map<
  MessageId,
  { chatId: ChatId; controller: AbortController }
>()

export const cancelCostSettlement = (chatId?: ChatId): void => {
  for (const [messageId, settlement] of costSettlements) {
    if (chatId !== undefined && settlement.chatId !== chatId) continue
    settlement.controller.abort()
    costSettlements.delete(messageId)
  }
}

const settleGenerationCost = action(
  async (chatId: ChatId, messageId: MessageId, generationId: string) => {
    costSettlements.get(messageId)?.controller.abort()
    const controller = new AbortController()
    costSettlements.set(messageId, { chatId, controller })
    let usage: Awaited<ReturnType<typeof pollGenerationUsage>> = null
    try {
      usage = await wrap(
        pollGenerationUsage(generationId, {
          capMs: timings.generationCapMs,
          signal: controller.signal,
        }),
      )
    } finally {
      if (costSettlements.get(messageId)?.controller === controller) {
        costSettlements.delete(messageId)
      }
    }
    if (!usage || controller.signal.aborted) return
    const chatModel = getChatModel(chatId)
    const current = chatModel.messages().get(messageId)
    if (!current || current.role !== 'assistant' || current.usage) return
    const settled: AssistantMessage = {
      ...current,
      usage,
      rev: current.rev + 1,
    }
    setMemoryMessage(chatModel, settled)
    await wrap(persistMessage(chatId, settled))
  },
  'chat.engine.settleGenerationCost',
).extend(withAsync())

const planTurn = (
  spec: ReplySpec,
  chatId: ChatId,
  chatModel: ChatModel,
  assistantId: MessageId,
): TurnPlan | null => {
  const at = now()
  const messages = chatModel.messages()
  const settings = chatSettingsOf(spec.chatId)
  if (!settings) return null
  const chatRecordModel =
    spec.chatId === 'new' ? getChatModel('new').model() : chatModel.model()
  const selection = { ...(chatModel.record()?.selection ?? {}) }

  let user: UserMessage
  let newUser: UserMessage | null = null
  let fallbackModel: string | null = null

  if (spec.kind === 'send' || spec.kind === 'edit') {
    const input = spec.input!
    let parentId: MessageId | null
    if (spec.kind === 'edit') {
      const original = spec.userId ? messages.get(spec.userId) : undefined
      if (!original || original.role !== 'user') return null
      const unchanged =
        original.content === input.text &&
        original.attachments.length === input.attachments.length &&
        original.attachments.every(
          (ref, index) => ref.id === input.attachments[index]?.id,
        )
      if (unchanged) return null
      parentId = original.parentId
    } else {
      parentId = chatModel.path().at(-1)?.message.id ?? null
    }
    newUser = {
      id: createId(),
      chatId,
      parentId,
      createdAt: at,
      rev: 1,
      role: 'user',
      content: input.text,
      attachments: input.attachments,
    }
    user = newUser
    selection[selectionKeyOf(newUser)] = newUser.id
  } else {
    const target = spec.assistantId ? messages.get(spec.assistantId) : undefined
    if (!target || target.role !== 'assistant' || !target.parentId) return null
    const parent = messages.get(target.parentId)
    if (!parent || parent.role !== 'user') return null
    user = parent
    fallbackModel = target.model
  }

  const requestModel = (
    spec.overrides?.model ??
    chatRecordModel ??
    fallbackModel ??
    ''
  ).trim()
  if (requestModel.length === 0) return null

  const assistant = newAssistantMessage({
    id: assistantId,
    chatId,
    parentId: user.id,
    model: requestModel,
    at,
  })
  selection[user.id] = assistant.id

  const newChat =
    spec.chatId === 'new'
      ? {
          ...createChatRecord({
            id: chatId,
            at,
            title: chatTitle(user.content) || user.attachments[0]?.name || 'New chat',
            model: chatRecordModel,
            presetId: getChatModel('new').presetId(),
            settings,
          }),
          selection,
        }
      : null

  const draft = spec.kind === 'send' ? getChatModel(spec.chatId).draft : null
  return {
    chatId,
    chatModel,
    settings,
    requestModel,
    user,
    newUser,
    assistant,
    newChat,
    selection,
    clearDraft: draft
      ? () => {
          draft.text.set('')
          draft.attachments.set([])
        }
      : null,
  }
}

interface StreamOutcome {
  message: AssistantMessage
}

const streamReply = async (
  plan: TurnPlan,
  stream: LocalStream,
  overrides: RequestOverrides | undefined,
  resumeFrom?: AssistantMessage,
): Promise<StreamOutcome> => {
  const { chatId, chatModel } = plan
  const path = ancestorChain(
    chatModel.messages(),
    resumeFrom ? resumeFrom.id : plan.user.id,
  )
  const blobs = await wrap(loadAttachments(path))
  const wireMessages: WireMessage[] = assembleContext({
    path,
    systemPrompt: plan.settings.systemPrompt,
    requestModel: plan.requestModel,
    endAtUserId: resumeFrom ? undefined : plan.user.id,
    attachment: (id) => blobs.get(id),
  })
  const catalogModel = catalogById().get(plan.requestModel) ?? null
  const request = buildChatRequest({
    modelId: plan.requestModel,
    model: catalogModel,
    messages: wireMessages,
    settings: plan.settings,
    globalPrivacy: globalPrivacy(),
    overrides,
    mcpTools: connectedMcpTools(plan.settings),
  })
  const inputTokens = estimateTokens(contextCharacterCount(wireMessages))

  let message = resumeFrom
    ? {
        ...resumeFrom,
        status: 'streaming' as const,
        error: null,
        rev: resumeFrom.rev + 1,
      }
    : plan.assistant
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushBroken = false
  let pendingFlush: Promise<unknown> = Promise.resolve()
  let finishReason: string | null = null
  let errorEvent: Extract<StreamEvent, { kind: 'error' }> | null = null
  let errorRaw: unknown = null
  let thrownFailure: CompletionFailure | null = null
  let aborted = false
  let firstTokenAnnounced = false

  const commit = (next: AssistantMessage) => {
    message = next
    setMemoryMessage(chatModel, message)
  }
  if (resumeFrom) commit(message)

  const flushNow = async () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    if (flushBroken) return
    commit({ ...message, rev: message.rev + 1 })
    const snapshot = message
    const reportFlushFailure = wrap((error: unknown) => {
      flushBroken = true
      reportWriteFailure(chatId, error)
    })
    pendingFlush = pendingFlush.then(async () => {
      if (flushBroken) return
      try {
        await repo.putMessage(snapshot)
        publishSync({ type: 'message', message: snapshot })
      } catch (error) {
        reportFlushFailure(error)
      }
    })
    await wrap(pendingFlush)
  }

  const scheduleFlush = () => {
    if (flushTimer !== null || flushBroken) return
    flushTimer = setTimeout(
      wrap(() => {
        flushTimer = null
        flushNow().catch(() => {})
      }),
      timings.flushMs,
    )
  }

  const raiseEstimate = (next: AssistantMessage): AssistantMessage => {
    if (!catalogModel) return next
    const outputChars = next.content.length + (next.reasoning?.text.length ?? 0)
    const estimate = estimateCost({
      inputTokens,
      outputTokens: estimateTokens(outputChars),
      promptPrice: catalogModel.promptPrice,
      completionPrice: catalogModel.completionPrice,
    })
    return Number.isFinite(estimate) && estimate > next.estimateCost
      ? { ...next, estimateCost: estimate }
      : next
  }

  const markFirstToken = (next: AssistantMessage, at: number) => {
    if (next.timing.firstTokenAt !== null) return next
    return {
      ...next,
      status: 'streaming' as const,
      timing: { ...next.timing, firstTokenAt: at },
    }
  }

  const applyEvent = (event: StreamEvent, rawChunk: unknown) => {
    const at = now()
    let next = message
    switch (event.kind) {
      case 'id':
        if (next.generationId === null) next = { ...next, generationId: event.id }
        break
      case 'provider':
        next = { ...next, provider: event.name }
        break
      case 'reasoning': {
        const reasoning = next.reasoning ?? {
          text: '',
          details: [],
          startedAt: at,
          endedAt: null,
          hiddenByProvider: false,
          stoppedWhileThinking: false,
        }
        next = markFirstToken(
          {
            ...next,
            reasoning: {
              ...reasoning,
              text: reasoning.text + event.text,
              startedAt: reasoning.startedAt ?? at,
              hiddenByProvider: false,
            },
          },
          at,
        )
        break
      }
      case 'reasoning-details': {
        const reasoning = next.reasoning ?? {
          text: '',
          details: [],
          startedAt: at,
          endedAt: null,
          hiddenByProvider: false,
          stoppedWhileThinking: false,
        }
        const details = appendReasoningDetails(reasoning.details, event.details)
        const onlyEncrypted =
          reasoning.text.length === 0 &&
          details.some(
            (detail) =>
              (detail as { type?: unknown }).type === 'reasoning.encrypted',
          )
        next = {
          ...next,
          reasoning: { ...reasoning, details, hiddenByProvider: onlyEncrypted },
        }
        break
      }
      case 'content': {
        const reasoning =
          next.reasoning && next.reasoning.endedAt === null
            ? { ...next.reasoning, endedAt: at }
            : next.reasoning
        next = markFirstToken(
          { ...next, reasoning, content: next.content + event.text },
          at,
        )
        break
      }
      case 'refusal':
        next = { ...next, refusal: (next.refusal ?? '') + event.text }
        break
      case 'citations':
        next = { ...next, citations: mergeCitations(next.citations, event.items) }
        break
      case 'tool_calls':
        next = { ...next, toolCalls: mergeToolCalls(next.toolCalls, event.calls) }
        break
      case 'finish':
        finishReason = event.reason
        next = { ...next, finishReason: event.reason }
        break
      case 'usage':
        next = { ...next, usage: event.usage }
        break
      case 'error':
        errorEvent = event
        errorRaw = rawChunk
        break
    }
    if (next !== message) commit(raiseEstimate(next))
    if (!firstTokenAnnounced && message.timing.firstTokenAt !== null) {
      firstTokenAnnounced = true
      streamLifecycle({ type: 'first-token', chatId, messageId: message.id })
    }
  }

  try {
    const iterator = streamChat(request, { signal: stream.controller.signal })
    while (true) {
      const step = await wrap(iterator.next())
      if (step.done) break
      const item = step.value
      if (message.provider === null) {
        const headerProvider = item.headers?.get('x-provider-name')
        if (headerProvider) commit({ ...message, provider: headerProvider })
      }
      for (const event of streamItemToEvents(item)) applyEvent(event, item.raw ?? item.chunk)
      scheduleFlush()
    }
  } catch (error) {
    const failure = fromSdkError(error)
    if (failure === 'aborted' || stream.stopRequested) aborted = true
    else thrownFailure = failure
  }
  if (stream.stopRequested) aborted = true

  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }

  const endAt = now()
  const closedReasoning =
    message.reasoning && message.reasoning.endedAt === null
      ? { ...message.reasoning, endedAt: endAt }
      : message.reasoning
  const contentReceived = message.content.length > 0

  let status: AssistantStatus
  let error: ErrorInfo | null = null
  const waitingOnTools =
    !aborted &&
    !thrownFailure &&
    !errorEvent &&
    pausedForToolApproval(message, finishReason)
  if (aborted) {
    status = 'stopped'
  } else if (waitingOnTools) {
    status = 'done'
    error = null
  } else {
    const failure: CompletionFailure =
      thrownFailure ??
      (errorEvent
        ? streamErrorFailure(errorEvent, errorRaw, contentReceived)
        : finishReason === 'error'
          ? ({
              source: 'stream-error',
              code: null,
              message: '',
              contentReceived,
            } as CompletionFailure)
          : finishReason === null
            ? { source: 'network' }
            : finishFailure(message, finishReason))
    error = classifyFailure(
      failure,
      buildClassifyContext({
        modelId: plan.requestModel,
        provider: message.provider,
        settings: plan.settings,
        estimatedInputTokens: inputTokens,
        contentReceived,
        lastUser: plan.user,
        overrides,
      }),
    )
    status = statusForError(failure, error)
  }

  const stoppedWhileThinking =
    aborted &&
    message.reasoning !== null &&
    message.reasoning.endedAt === null &&
    message.content.length === 0

  commit({
    ...message,
    status,
    error,
    reasoning: closedReasoning
      ? { ...closedReasoning, stoppedWhileThinking }
      : null,
    timing: { ...message.timing, endAt },
    rev: message.rev + 1,
  })

  await wrap(pendingFlush.catch(() => {}))
  const finalSnapshot = message
  const reportFinalWriteFailure = wrap((error: unknown) => {
    reportWriteFailure(chatId, error)
  })
  try {
    await wrap(repo.putMessage(finalSnapshot))
    publishSync({ type: 'message', message: finalSnapshot })
    if (!flushBroken) markUnsaved(chatId, false)
  } catch (writeError) {
    reportFinalWriteFailure(writeError)
  }
  return { message: finalSnapshot }
}

const failUnexpectedly = async (
  plan: TurnPlan,
  unexpected: unknown,
): Promise<StreamOutcome> => {
  const current = plan.chatModel.messages().get(plan.assistant.id)
  const base =
    current && current.role === 'assistant' ? current : plan.assistant
  const error = classifyFailure(
    {
      source: 'stream-error',
      code: null,
      message: unexpected instanceof Error ? unexpected.message : '',
    },
    buildClassifyContext({
      modelId: plan.requestModel,
      provider: base.provider,
      settings: plan.settings,
      estimatedInputTokens: 0,
      contentReceived: base.content.length > 0,
      lastUser: plan.user,
      overrides: undefined,
    }),
  )
  const failed: AssistantMessage = {
    ...base,
    status: 'error',
    error,
    rev: base.rev + 1,
    timing: { ...base.timing, endAt: now() },
  }
  setMemoryMessage(plan.chatModel, failed)
  await wrap(persistMessage(plan.chatId, failed))
  return { message: failed }
}

const runReply = async (spec: ReplySpec): Promise<void> => {
  requestPersistOnce().catch(() => {})
  const existing = localStreams().get(spec.chatId)
  if (existing?.stopRequested || existing?.controller.signal.aborted) {
    await waitUntilLocalStreamClears(spec.chatId)
  }
  if (!canStartReply(spec.chatId)) return
  if ((spec.kind === 'send' || spec.kind === 'edit') && !hasInput(spec.input)) {
    return
  }
  if (spec.kind !== 'send' && spec.chatId === 'new') return

  const chatId: ChatId = spec.chatId === 'new' ? createId() : spec.chatId
  const assistantId = createId()
  const stream: LocalStream = {
    messageId: assistantId,
    controller: new AbortController(),
    stopRequested: false,
  }
  setLocalStream(chatId, stream)

  const releaseNewChatClaim = () => {
    if (startingNewChatId() === chatId) startingNewChatId.set(null)
  }

  let lock: StreamLock | null = null
  let outcome: StreamOutcome | null = null
  let plan: TurnPlan | null = null
  try {
    if (spec.chatId === 'new') startingNewChatId.set(chatId)
    if (spec.chatId !== 'new') {
      await wrap(chatModelInternals(chatId).loadMessages())
    }
    lock = await wrap(acquireStreamLock(chatId))
    if (!lock || stream.controller.signal.aborted) return

    const chatModel = getChatModel(chatId)
    if (spec.chatId === 'new') {
      const pending = getChatModel('new')
      const pendingPlan = planTurn(spec, chatId, pending, assistantId)
      if (!pendingPlan) return
      plan = { ...pendingPlan, chatModel }
    } else {
      plan = planTurn(spec, chatId, chatModel, assistantId)
    }
    if (!plan) return

    if (plan.newUser) setMemoryMessage(chatModel, plan.newUser)
    setMemoryMessage(chatModel, plan.assistant)
    plan.clearDraft?.()

    if (plan.newChat) {
      const createdChat = plan.newChat
      chatModelInternals('new').resetPending()
      const created = createChat(createdChat)
      if (activeChatId() === 'new') openChat(chatId)
      releaseNewChatClaim()
      await wrap(created.catch((error) => reportWriteFailure(chatId, error)))
    } else {
      patchChat(chatId, { selection: plan.selection }).catch((error) =>
        reportWriteFailure(chatId, error),
      )
    }
    if (plan.newUser) await wrap(persistMessage(chatId, plan.newUser))
    await wrap(persistMessage(chatId, plan.assistant))
    publishSync({ type: 'stream', chatId, tabId, active: true })
    streamLifecycle({ type: 'started', chatId, messageId: assistantId })

    try {
      outcome = await wrap(streamReply(plan, stream, spec.overrides))
    } catch (unexpected) {
      outcome = await wrap(failUnexpectedly(plan, unexpected))
    }
  } finally {
    releaseNewChatClaim()
    const freeing = lock?.release() ?? null
    if (lock) {
      publishSync({ type: 'stream', chatId, tabId, active: false })
    }
    setLocalStream(chatId, null)
    if (freeing) await wrap(freeing)
  }

  if (!outcome || !plan) return
  await wrap(finishTurn(plan.chatModel, chatId, outcome.message))
  await wrap(autoRunRememberedReads(chatId, outcome.message.id))
}

const finishTurn = async (
  chatModel: ChatModel,
  chatId: ChatId,
  finalMessage: AssistantMessage,
) => {
  if (finalMessage.status === 'done') {
    dropFailedEmptySiblings(chatModel, finalMessage).catch(() => {})
  }
  patchChat(chatId, { lastActivityAt: now() }).catch(() => {})

  if (unresolvedToolCalls(finalMessage).length > 0) {
    streamLifecycle({ type: 'completed', chatId, messageId: finalMessage.id })
  } else if (finalMessage.status === 'done') {
    streamLifecycle({ type: 'completed', chatId, messageId: finalMessage.id })
  } else if (finalMessage.status === 'stopped') {
    streamLifecycle({ type: 'stopped', chatId, messageId: finalMessage.id })
  } else {
    streamLifecycle({
      type: 'failed',
      chatId,
      messageId: finalMessage.id,
      title: finalMessage.error?.title ?? 'The reply failed',
    })
  }
  refreshKeyMeta()

  if (finalMessage.usage === null && finalMessage.generationId !== null) {
    settleGenerationCost(chatId, finalMessage.id, finalMessage.generationId).catch(
      () => {},
    )
  }
}

const patchAssistantTool = (
  chatModel: ChatModel,
  messageId: MessageId,
  callId: string,
  patch: Partial<ToolCallRecord>,
): AssistantMessage | null => {
  const current = chatModel.messages().get(messageId)
  if (!current || current.role !== 'assistant') return null
  const toolCalls = current.toolCalls ?? []
  const index = toolCalls.findIndex((call) => call.id === callId)
  if (index < 0) return null
  const nextCalls = toolCalls.map((call, callIndex) =>
    callIndex === index ? { ...call, ...patch } : call,
  )
  const next: AssistantMessage = {
    ...current,
    toolCalls: nextCalls,
    rev: current.rev + 1,
  }
  setMemoryMessage(chatModel, next)
  return next
}

const followUpAfterTools = async (
  chatId: ChatId,
  assistantId: MessageId,
): Promise<void> => {
  requestPersistOnce().catch(() => {})
  if (!canStartReply(chatId)) return
  await wrap(chatModelInternals(chatId).loadMessages())
  if (!canStartReply(chatId)) return

  const chatModel = getChatModel(chatId)
  const settings = chatSettingsOf(chatId)
  const existing = chatModel.messages().get(assistantId)
  if (!settings || !existing || existing.role !== 'assistant') return
  if (unresolvedToolCalls(existing).length > 0) return
  const parent = existing.parentId
    ? chatModel.messages().get(existing.parentId)
    : undefined
  if (!parent || parent.role !== 'user') return

  const stream: LocalStream = {
    messageId: assistantId,
    controller: new AbortController(),
    stopRequested: false,
  }
  setLocalStream(chatId, stream)

  const plan: TurnPlan = {
    chatId,
    chatModel,
    settings,
    requestModel: existing.model,
    user: parent,
    newUser: null,
    assistant: existing,
    newChat: null,
    selection: chatModel.record()?.selection ?? {},
    clearDraft: null,
  }

  let lock: StreamLock | null = null
  let outcome: StreamOutcome | null = null
  try {
    lock = await wrap(acquireStreamLock(chatId))
    if (!lock || stream.controller.signal.aborted) return
    publishSync({ type: 'stream', chatId, tabId, active: true })
    streamLifecycle({ type: 'started', chatId, messageId: assistantId })
    try {
      outcome = await wrap(streamReply(plan, stream, undefined, existing))
    } catch (unexpected) {
      outcome = await wrap(failUnexpectedly(plan, unexpected))
    }
  } finally {
    const freeing = lock?.release() ?? null
    if (lock) publishSync({ type: 'stream', chatId, tabId, active: false })
    setLocalStream(chatId, null)
    if (freeing) await wrap(freeing)
  }

  if (!outcome) return
  await wrap(finishTurn(chatModel, chatId, outcome.message))
  await wrap(autoRunRememberedReads(chatId, outcome.message.id))
}

const autoRunRememberedReads = async (chatId: ChatId, assistantId: MessageId) => {
  const chatModel = getChatModel(chatId)
  const message = chatModel.messages().get(assistantId)
  if (!message || message.role !== 'assistant') return
  for (const call of unresolvedToolCalls(message)) {
    if (call.status !== 'waiting') continue
    if (!mcpAlwaysAllows(call.name)) continue
    await wrap(allowToolOnce(chatId, assistantId, call.id))
  }
}

const mcpAllowWasAborted = (error?: unknown) => {
  if (isAbort(error)) return true
  try {
    return abortVar.require().signal.aborted
  } catch {
    return true
  }
}

let mcpAllowLifetimeInstalled = false
let mcpAllowInFlight = false

const abortInFlightMcpAllow = () => {
  allowToolOnce.abort()
  releaseMcpCall()
  mcpAllowInFlight = false
}

const installMcpAllowLifetime = () => {
  if (mcpAllowLifetimeInstalled || typeof window === 'undefined') return
  mcpAllowLifetimeInstalled = true
  window.addEventListener('pagehide', abortInFlightMcpAllow)
  window.addEventListener('beforeunload', abortInFlightMcpAllow)
  onRuntimeReset(() => {
    window.removeEventListener('pagehide', abortInFlightMcpAllow)
    window.removeEventListener('beforeunload', abortInFlightMcpAllow)
    mcpAllowLifetimeInstalled = false
    abortInFlightMcpAllow()
  })
}

export const allowToolOnce = action(
  async (chatId: ChatId, messageId: MessageId, callId: string): Promise<void> => {
    installMcpAllowLifetime()
    if (mcpAllowInFlight) return
    const chatModel = getChatModel(chatId)
    const current = chatModel.messages().get(messageId)
    if (!current || current.role !== 'assistant') return
    const call = current.toolCalls?.find((item) => item.id === callId)
    if (!call || call.status !== 'waiting') return

    mcpAllowInFlight = true
    let acquired = false
    let next: AssistantMessage | null = null
    try {
      if (!(await wrap(acquireMcpCall()))) return
      acquired = true
      const latest = chatModel.messages().get(messageId)
      const latestCall =
        latest?.role === 'assistant'
          ? latest.toolCalls?.find((item) => item.id === callId)
          : undefined
      if (!latestCall || latestCall.status !== 'waiting') return

      const calling = patchAssistantTool(chatModel, messageId, callId, {
        status: 'calling',
      })
      if (calling) await wrap(persistMessage(chatId, calling))

      const result = await wrap(
        callMcpTool(
          latestCall.name,
          latestCall.arguments,
          abortVar.require().signal,
        ),
      )
      if (mcpAllowWasAborted()) return
      next = patchAssistantTool(chatModel, messageId, callId, {
        status: result.isError ? 'error' : 'completed',
        result: serializeToolResult(result),
      })
    } catch (error) {
      if (mcpAllowWasAborted(error)) return
      next = patchAssistantTool(chatModel, messageId, callId, {
        status: 'error',
        result: mcpCallStoppedCopy,
      })
    } finally {
      mcpAllowInFlight = false
      if (acquired) releaseMcpCall()
    }
    if (next) await wrap(persistMessage(chatId, next))
    if (next && unresolvedToolCalls(next).length === 0) {
      await wrap(followUpAfterTools(chatId, messageId))
    }
  },
  'chat.engine.allowToolOnce',
).extend(withAsync(), withAbort('manual'))

export const denyTool = action(
  async (chatId: ChatId, messageId: MessageId, callId: string): Promise<void> => {
    const chatModel = getChatModel(chatId)
    const current = chatModel.messages().get(messageId)
    if (!current || current.role !== 'assistant') return
    const call = current.toolCalls?.find((item) => item.id === callId)
    if (!call || call.status !== 'waiting') return
    const denied = patchAssistantTool(chatModel, messageId, callId, {
      status: 'denied',
      result: 'The user denied this tool call. It did not run.',
    })
    if (denied) await wrap(persistMessage(chatId, denied))
    if (denied && unresolvedToolCalls(denied).length === 0) {
      await wrap(followUpAfterTools(chatId, messageId))
    }
  },
  'chat.engine.denyTool',
).extend(withAsync())

export const alwaysAllowTool = action(
  async (chatId: ChatId, messageId: MessageId, callId: string): Promise<void> => {
    const chatModel = getChatModel(chatId)
    const current = chatModel.messages().get(messageId)
    if (!current || current.role !== 'assistant') return
    const call = current.toolCalls?.find((item) => item.id === callId)
    if (!call) return
    rememberMcpAlwaysAllow(call.name)
    if (isMcpWriteTool(call.name)) return
    await wrap(allowToolOnce(chatId, messageId, callId))
  },
  'chat.engine.alwaysAllowTool',
).extend(withAsync())

export const send = action(
  async (chatId: ChatId | 'new', input: SendInput): Promise<void> => {
    await runReply({ kind: 'send', chatId, input })
  },
  'chat.engine.send',
).extend(withAsync())

export const retry = action(
  async (chatId: ChatId, assistantId: MessageId): Promise<void> => {
    await runReply({ kind: 'retry', chatId, assistantId })
  },
  'chat.engine.retry',
).extend(withAsync())

export const regenerate = action(
  async (
    chatId: ChatId,
    assistantId: MessageId,
    overrides?: RequestOverrides,
  ): Promise<void> => {
    await runReply({ kind: 'regenerate', chatId, assistantId, overrides })
  },
  'chat.engine.regenerate',
).extend(withAsync())

export const editAndSend = action(
  async (chatId: ChatId, userId: MessageId, input: SendInput): Promise<void> => {
    await runReply({ kind: 'edit', chatId, userId, input })
  },
  'chat.engine.editAndSend',
).extend(withAsync())

const streamForStop = (chatId: ChatId): LocalStream | undefined => {
  const direct = localStreams().get(chatId)
  if (direct) return direct
  if (chatId !== 'new') return undefined
  const startingId = startingNewChatId()
  return startingId ? localStreams().get(startingId) : undefined
}

export const stop = action((chatId: ChatId): void => {
  const stream = streamForStop(chatId)
  if (!stream) return
  stream.stopRequested = true
  try {
    stream.controller.abort()
  } catch {}
}, 'chat.engine.stop')

export const generatingChats = computed(
  () => new Set<ChatId>([...localStreams().keys(), ...remoteStreams().keys()]),
  'chat.engine.generatingChats',
)

export const continueReply = action(
  async (chatId: ChatId, assistantId: MessageId): Promise<void> => {
    requestPersistOnce().catch(() => {})
    if (!canStartReply(chatId)) return
    await wrap(chatModelInternals(chatId).loadMessages())
    if (!canStartReply(chatId)) return

    const chatModel = getChatModel(chatId)
    const settings = chatSettingsOf(chatId)
    const existing = chatModel.messages().get(assistantId)
    if (!settings || !existing || existing.role !== 'assistant') return
    if (existing.content.length === 0 || liveStatuses.includes(existing.status)) {
      return
    }
    const path = ancestorChain(chatModel.messages(), assistantId)
    const lastUser = [...path]
      .reverse()
      .find((message): message is UserMessage => message.role === 'user')
    if (!lastUser) return

    const stream: LocalStream = {
      messageId: assistantId,
      controller: new AbortController(),
      stopRequested: false,
    }
    setLocalStream(chatId, stream)

    let lock: StreamLock | null = null
    let outcome: AssistantMessage | null = null
    try {
      lock = await wrap(acquireStreamLock(chatId))
      if (!lock || stream.controller.signal.aborted) return

      const blobs = await wrap(loadAttachments(path))
      const wireMessages = assembleContext({
        path,
        systemPrompt: settings.systemPrompt,
        requestModel: existing.model,
        attachment: (id) => blobs.get(id),
      })
      const request = buildChatRequest({
        modelId: existing.model,
        model: catalogById().get(existing.model) ?? null,
        messages: wireMessages,
        settings,
        globalPrivacy: globalPrivacy(),
        mcpTools: connectedMcpTools(settings),
      })
      const inputTokens = estimateTokens(contextCharacterCount(wireMessages))

      let message: AssistantMessage = {
        ...existing,
        status: 'streaming',
        error: null,
        rev: existing.rev + 1,
      }
      let pendingExtra: AssistantMessage['extraUsage'][number] | null = null
      let finishReason: string | null = null
      let errorEvent: Extract<StreamEvent, { kind: 'error' }> | null = null
      let errorRaw: unknown = null
      let thrownFailure: CompletionFailure | null = null
      let aborted = false

      const commit = (next: AssistantMessage) => {
        message = next
        setMemoryMessage(chatModel, message)
      }
      commit(message)
      publishSync({ type: 'stream', chatId, tabId, active: true })
      streamLifecycle({ type: 'started', chatId, messageId: assistantId })

      const applyEvent = (event: StreamEvent, rawChunk: unknown) => {
        if (event.kind === 'content') {
          commit({
            ...message,
            content: message.content + event.text,
            status: 'streaming',
            rev: message.rev + 1,
          })
          return
        }
        if (event.kind === 'usage') {
          pendingExtra = event.usage
          return
        }
        if (event.kind === 'finish') {
          finishReason = event.reason
          commit({ ...message, finishReason: event.reason, rev: message.rev + 1 })
          return
        }
        if (event.kind === 'error') {
          errorEvent = event
          errorRaw = rawChunk
          return
        }
        if (event.kind === 'provider') {
          commit({ ...message, provider: event.name, rev: message.rev + 1 })
        }
      }

      try {
        const iterator = streamChat(request, { signal: stream.controller.signal })
        while (true) {
          const step = await wrap(iterator.next())
          if (step.done) break
          const item = step.value
          if (message.provider === null) {
            const headerProvider = item.headers?.get('x-provider-name')
            if (headerProvider) commit({ ...message, provider: headerProvider })
          }
          for (const event of streamItemToEvents(item)) {
            applyEvent(event, item.raw ?? item.chunk)
          }
        }
      } catch (error) {
        const failure = fromSdkError(error)
        if (failure === 'aborted' || stream.stopRequested) aborted = true
        else thrownFailure = failure
      }
      if (stream.stopRequested) aborted = true

      const contentReceived = message.content.length > 0
      let status: AssistantStatus
      let error: AssistantMessage['error'] = null
      if (aborted) {
        status = 'stopped'
      } else {
        const failure: CompletionFailure =
          thrownFailure ??
          (errorEvent
            ? streamErrorFailure(errorEvent, errorRaw, contentReceived)
            : finishReason === 'error'
              ? ({
                  source: 'stream-error',
                  code: null,
                  message: '',
                  contentReceived,
                } as CompletionFailure)
              : finishReason === null
                ? { source: 'network' }
                : finishFailure(message, finishReason))
        error = classifyFailure(
          failure,
          buildClassifyContext({
            modelId: existing.model,
            provider: message.provider,
            settings,
            estimatedInputTokens: inputTokens,
            contentReceived,
            lastUser,
            overrides: undefined,
          }),
        )
        status = statusForError(failure, error)
      }

      const finished: AssistantMessage = {
        ...message,
        status,
        error,
        extraUsage: pendingExtra
          ? [...message.extraUsage, pendingExtra]
          : message.extraUsage,
        timing: { ...message.timing, endAt: now() },
        rev: message.rev + 1,
      }
      commit(finished)
      await wrap(persistMessage(chatId, finished))
      outcome = finished
    } finally {
      const freeing = lock?.release() ?? null
      if (lock) publishSync({ type: 'stream', chatId, tabId, active: false })
      setLocalStream(chatId, null)
      if (freeing) await wrap(freeing)
    }

    if (!outcome) return
    patchChat(chatId, { lastActivityAt: now() }).catch(() => {})
    if (outcome.status === 'done') {
      streamLifecycle({ type: 'completed', chatId, messageId: outcome.id })
    } else if (outcome.status === 'stopped') {
      streamLifecycle({ type: 'stopped', chatId, messageId: outcome.id })
    } else {
      streamLifecycle({
        type: 'failed',
        chatId,
        messageId: outcome.id,
        title: outcome.error?.title ?? 'The reply failed',
      })
    }
    refreshKeyMeta()
  },
  'chat.engine.continueReply',
).extend(withAsync())

addCallHook(chatsTombstoned, (ids) => {
  for (const id of ids) stop(id)
})

addCallHook(chatPurged, (id) => {
  cancelCostSettlement(id)
})
