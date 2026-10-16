import { action, atom, withAsync, wrap } from '@reatom/core'

import { extraEstimateLines } from '../app/ui'
import { streamChat, type StreamItem } from '../api/stream'
import { keyMeta } from '../auth/keyMeta'
import { catalogById, curatedDefaults, modelName } from '../catalog'
import type { CatalogModel } from '../catalog/types'
import { classifyFailure, fromSdkError, fromStreamErrorChunk } from '../errors'
import type { ClassifiableContext } from '../errors/input'
import type { CompletionFailure, ErrorInfo } from '../errors/types'
import { announce } from '../ui/LiveRegion'
import {
  defaultOutputTokens,
  estimateCost,
  estimateTokens,
} from '../money/estimate'
import { now, tabId } from '../platform/env'
import { requestPersistOnce } from '../platform/storage-api'
import { activeChatId, openChat } from '../routes'
import { globalPrivacy } from '../storage/prefs'
import { createChatRecord } from '../storage/records'
import { repo } from '../storage/repo'
import type {
  AssistantMessage,
  AssistantStatus,
  AttachmentBlob,
  ChatId,
  ChatSettings,
  MessageId,
  MessageRecord,
  UserMessage,
} from '../storage/types'
import { acquireStreamLock } from '../sync'
import { ui } from '../app/ui'
import {
  activeChat,
  chatModelInternals,
  getChatModel,
  sendBlockContributors,
} from './chatModel'
import { assembleContext, contextCharacterCount } from './context'
import { createChat, patchChat } from './library'
import { streamItemToEvents } from './parse'
import { buildChatRequest } from './request'
import { chatTitle } from './title'
import { ancestorChain, selectionKeyOf } from './tree'
import type {
  ChatModel,
  SendBlockContributor,
  SendInput,
  StreamEvent,
} from './types'

const holdDraft = '\u200b'
const compareEstimateKey = 'compare-requests'

export const sameModelNote = atom(false, 'chat.compare.sameModelNote')

export interface CompareSession {
  chatId: ChatId | 'new'
  phase: 'armed' | 'pending'
  models: [string, string]
  groupId: string | null
}

export const compareSession = atom<CompareSession | null>(
  null,
  'chat.compare.session',
)

export const syncCompareEstimate = (show: boolean) => {
  void show
  extraEstimateLines.set((lines) => {
    const rest = lines.filter((line) => line.key !== compareEstimateKey)
    return rest.length === lines.length ? lines : rest
  })
}

export const pairedEstimate = (
  chat: ChatModel,
  models: readonly [string, string],
): number | null => {
  const settings = chat.settings()
  const wire = assembleContext({
    path: chat.path().map((node) => node.message),
    systemPrompt: settings.systemPrompt,
    requestModel: models[0],
    attachment: () => undefined,
  })
  const inputTokens = estimateTokens(
    contextCharacterCount(wire) + chat.draft.text().length,
  )
  const maxTokens = settings.params.maxTokens
  const outputTokens =
    typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0
      ? maxTokens
      : defaultOutputTokens
  let total = 0
  let priced = false
  for (const modelId of models) {
    const model = catalogById().get(modelId)
    if (!model) continue
    const cost = estimateCost({
      inputTokens,
      outputTokens,
      promptPrice: model.promptPrice,
      completionPrice: model.completionPrice,
    })
    if (!Number.isFinite(cost)) continue
    priced = true
    total += cost
  }
  return priced ? total : null
}

export const openComparePicker = action(() => {
  ui.picker.set({ purpose: 'compare' })
}, 'chat.compare.openPicker')

export const armCompareModels = action((models: readonly [string, string]) => {
  const first = models[0]?.trim() ?? ''
  const second = models[1]?.trim() ?? ''
  if (!first || !second || first === second) {
    sameModelNote.set(true)
    return
  }
  sameModelNote.set(false)
  const chat = activeChat()
  chat.setModel(first)
  compareSession.set({
    chatId: chat.id,
    phase: 'armed',
    models: [first, second],
    groupId: null,
  })
  syncCompareEstimate(true)
}, 'chat.compare.armModels')

export const chooseCompareModel = action((modelId: string) => {
  const trimmed = modelId.trim()
  if (!trimmed) return
  const chat = activeChat()
  const current = chat.model()
  if (!current || trimmed === current) {
    sameModelNote.set(true)
    if (compareSession()?.phase === 'armed') {
      compareSession.set(null)
      syncCompareEstimate(false)
    }
    return
  }
  sameModelNote.set(false)
  compareSession.set({
    chatId: chat.id,
    phase: 'armed',
    models: [current, trimmed],
    groupId: null,
  })
  syncCompareEstimate(true)
}, 'chat.compare.choose')

const comparePendingBlock: SendBlockContributor = (chat) => {
  const session = compareSession()
  if (!session || session.phase !== 'pending' || session.chatId !== chat.id) {
    return null
  }
  return { code: 'compare-pending', label: 'Pick a reply to continue' }
}

interface LaneControl {
  controller: AbortController
  stopRequested: boolean
}

const controls = new Map<MessageId, LaneControl>()
const inflight = new Map<MessageId, Promise<void>>()
const persists = new Map<MessageId, Promise<void>>()

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const writeMessage = (chat: ChatModel, message: MessageRecord) => {
  chat.messages.set((messages) => {
    const next = new Map(messages)
    next.set(message.id, message)
    return next
  })
}

const enqueuePersist = (ready: Promise<void>, message: MessageRecord) => {
  const previous = persists.get(message.id) ?? ready
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await repo.putMessage(message)
    })
    .then(
      () => undefined,
      () => undefined,
    )
  persists.set(message.id, next)
}

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

const assistantShell = (input: {
  id: MessageId
  chatId: ChatId
  parentId: MessageId
  model: string
  at: number
  groupId: string
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
  compareGroup: input.groupId,
})

const classifyContext = (input: {
  modelId: string
  provider: string | null
  settings: ChatSettings
  estimatedInputTokens: number
  contentReceived: boolean
  lastUser: UserMessage
}): ClassifiableContext => {
  const byId = catalogById()
  const model = byId.get(input.modelId) ?? null
  const paidModel = input.modelId.endsWith(':free')
    ? byId.get(input.modelId.slice(0, -':free'.length))
    : undefined
  const fallbackId = curatedDefaults.find(
    (id) => id !== input.modelId && byId.has(id),
  )
  const privacy = input.settings.privacyOverride ?? globalPrivacy()
  const routing = input.settings.routing
  const meta = keyMeta.data()
  return {
    modelId: input.modelId,
    modelName: modelName(input.modelId),
    provider: input.provider,
    paidVariant: paidModel ? { id: paidModel.id, name: paidModel.name } : null,
    fallbackModel: fallbackId
      ? { id: fallbackId, name: modelName(fallbackId) }
      : null,
    longerContextModels: [...byId.values()]
      .filter(
        (candidate) => candidate.contextLength > (model?.contextLength ?? 0),
      )
      .sort((left, right) => right.contextLength - left.contextLength)
      .slice(0, 3)
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        contextLength: candidate.contextLength,
      })),
    privacyRestrictive: privacy.zdr || privacy.denyDataCollection,
    routingRestrictive: routing.mode !== 'auto' || !routing.allowFallbacks,
    keyLimit: meta ? { limit: meta.limit, reset: meta.limitReset } : null,
    estimatedInputTokens: input.estimatedInputTokens,
    contextLength: model?.contextLength ?? null,
    effortSupported:
      model !== null &&
      (model.supportedParameters.includes('reasoning') ||
        model.supportedParameters.includes('reasoning_effort')),
    maxTokensSet: input.settings.params.maxTokens !== undefined,
    webSearchOn: input.settings.webSearch,
    zdrOn: privacy.zdr,
    attachmentName: input.lastUser.attachments[0]?.name ?? null,
    contentReceived: input.contentReceived,
    modelInCatalog: model !== null,
  }
}

const statusFor = (
  failure: CompletionFailure,
  info: ErrorInfo | null,
  aborted: boolean,
): AssistantStatus => {
  if (aborted) return 'stopped'
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
): CompletionFailure =>
  fromStreamErrorChunk(rawChunk, { contentReceived }) ?? {
    source: 'stream-error',
    code: event.code,
    message: event.message,
    metadata: event.metadata ?? {},
    contentReceived,
  }

const raiseEstimate = (
  message: AssistantMessage,
  model: CatalogModel | null,
  inputTokens: number,
): AssistantMessage => {
  if (!model) return message
  const estimate = estimateCost({
    inputTokens,
    outputTokens: estimateTokens(
      message.content.length + (message.reasoning?.text.length ?? 0),
    ),
    promptPrice: model.promptPrice,
    completionPrice: model.completionPrice,
  })
  return Number.isFinite(estimate) && estimate > message.estimateCost
    ? { ...message, estimateCost: estimate }
    : message
}

const consumeLane = async (input: {
  chat: ChatModel
  ready: Promise<void>
  message: AssistantMessage
  model: CatalogModel | null
  settings: ChatSettings
  user: UserMessage
  inputTokens: number
  request: ReturnType<typeof buildChatRequest>
  control: LaneControl
  started: Promise<IteratorResult<StreamItem>>
  iterator: AsyncGenerator<StreamItem, void, undefined>
}) => {
  let message = input.message
  let finishReason: string | null = null
  let errorEvent: Extract<StreamEvent, { kind: 'error' }> | null = null
  let errorRaw: unknown = null
  let thrown: CompletionFailure | null = null
  let aborted = false

  const commit = (next: AssistantMessage) => {
    const stored = input.chat.messages().get(next.id)
    const compareGroup =
      stored && stored.role === 'assistant' && stored.compareGroup === null
        ? null
        : next.compareGroup
    const written: AssistantMessage = {
      ...next,
      compareGroup,
      rev: stored ? stored.rev + 1 : next.rev,
    }
    message = written
    writeMessage(input.chat, written)
    enqueuePersist(input.ready, written)
  }

  const applyItem = (item: StreamItem) => {
    if (message.provider === null) {
      const headerProvider = item.headers?.get('x-provider-name')
      if (headerProvider) message = { ...message, provider: headerProvider }
    }
    for (const event of streamItemToEvents(item)) {
      const at = now()
      let next = message
      switch (event.kind) {
        case 'id':
          if (next.generationId === null)
            next = { ...next, generationId: event.id }
          break
        case 'provider':
          next = { ...next, provider: event.name }
          break
        case 'content':
          next = {
            ...next,
            status: 'streaming',
            content: next.content + event.text,
            timing:
              next.timing.firstTokenAt === null
                ? { ...next.timing, firstTokenAt: at }
                : next.timing,
          }
          break
        case 'refusal':
          next = { ...next, refusal: (next.refusal ?? '') + event.text }
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
          errorRaw = item.raw ?? item.chunk
          break
        default:
          break
      }
      if (next !== message)
        commit(raiseEstimate(next, input.model, input.inputTokens))
    }
  }

  announce('Generating reply')
  try {
    let step = await wrap(input.started)
    while (!step.done) {
      applyItem(step.value)
      step = await wrap(input.iterator.next())
    }
  } catch (error) {
    const failure = fromSdkError(error)
    if (failure === 'aborted' || input.control.stopRequested) aborted = true
    else thrown = failure
  }
  if (input.control.stopRequested) aborted = true

  const endAt = now()
  const contentReceived = message.content.length > 0
  let status: AssistantStatus
  let error: ErrorInfo | null = null
  if (aborted) {
    status = 'stopped'
  } else {
    const failure: CompletionFailure =
      thrown ??
      (errorEvent
        ? streamErrorFailure(errorEvent, errorRaw, contentReceived)
        : finishReason === null
          ? { source: 'network' }
          : finishFailure(message, finishReason))
    error = classifyFailure(
      failure,
      classifyContext({
        modelId: message.model,
        provider: message.provider,
        settings: input.settings,
        estimatedInputTokens: input.inputTokens,
        contentReceived,
        lastUser: input.user,
      }),
    )
    status = statusFor(failure, error, false)
  }

  commit({
    ...message,
    status,
    error,
    timing: { ...message.timing, endAt },
  })
  if (status === 'done') announce('Reply complete')
  else if (status === 'stopped') announce('Stopped')
  else announce(error?.title ?? 'The reply failed')
  controls.delete(message.id)
}

const endCompare = async (
  chatId: ChatId,
  groupId: string,
  keepId: MessageId | null,
) => {
  const chat = getChatModel(chatId)
  const siblings = () =>
    [...chat.messages().values()].filter(
      (message): message is AssistantMessage =>
        message.role === 'assistant' && message.compareGroup === groupId,
    )
  for (const message of siblings()) {
    const control = controls.get(message.id)
    if (!control) continue
    control.stopRequested = true
    control.controller.abort()
  }
  const pending = [...inflight.values()]
  if (pending.length > 0) {
    await wrap(Promise.all(pending.map((task) => task.catch(() => undefined))))
  }
  const cleared = siblings().map((message) => ({
    ...message,
    compareGroup: null,
    rev: message.rev + 1,
  }))
  chat.messages.set((messages) => {
    const next = new Map(messages)
    for (const message of cleared) next.set(message.id, message)
    return next
  })
  for (const message of cleared) {
    await wrap(repo.putMessage(message).catch(() => undefined))
  }
  if (keepId) chat.selectVersion(keepId)
  if (chat.draft.text() === holdDraft) {
    chat.draft.text.set('')
    chat.draft.attachments.set([])
  }
  compareSession.set(null)
  sameModelNote.set(false)
  syncCompareEstimate(false)
}

export const stopCompareLane = action((messageId: MessageId) => {
  const control = controls.get(messageId)
  if (!control) return
  control.stopRequested = true
  control.controller.abort()
}, 'chat.compare.stopLane')

export const continueWithCompare = action(async (messageId: MessageId) => {
  const session = compareSession()
  if (!session || session.phase !== 'pending' || !session.groupId) return
  if (session.chatId === 'new') return
  await endCompare(session.chatId, session.groupId, messageId)
}, 'chat.compare.continue').extend(withAsync())

export const exitCompare = action(async () => {
  const session = compareSession()
  if (!session || session.phase !== 'pending' || !session.groupId) return
  if (session.chatId === 'new') return
  await endCompare(session.chatId, session.groupId, null)
}, 'chat.compare.exit').extend(withAsync())

const modelIdFromPickerClick = (target: Element) => {
  if (ui.picker()?.purpose !== 'compare') return null
  if (target.closest('button')) return null
  const option = target.closest('[role="option"]')
  const row = option?.closest('[data-model-id]')
  return row?.getAttribute('data-model-id') ?? null
}

let contributorBound = false

export const bindCompareChrome = () => {
  if (typeof window === 'undefined') return () => {}
  if (!contributorBound) {
    contributorBound = true
    sendBlockContributors.register(comparePendingBlock)
  }
  const onClick = wrap((event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const picked = modelIdFromPickerClick(target)
    if (picked) {
      chooseCompareModel(picked)
      ui.picker.set(null)
      event.preventDefault()
      event.stopPropagation()
      return
    }
  })
  const onKeyDown = wrap((event: KeyboardEvent) => {
    if (event.key === 'Enter' && ui.picker()?.purpose === 'compare') {
      const active = document.querySelector(
        '[data-model-id][data-active="true"]',
      )
      const modelId = active?.getAttribute('data-model-id')
      if (modelId) {
        chooseCompareModel(modelId)
        ui.picker.set(null)
      }
      event.preventDefault()
      event.stopPropagation()
      return
    }
  })
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKeyDown, true)
  return () => {
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }
}

export const compareSend = action(
  async (
    chatId: ChatId | 'new',
    input: SendInput,
    models: [string, string],
  ): Promise<void> => {
    requestPersistOnce()
    const session = compareSession()
    if (!session || session.phase !== 'armed' || session.chatId !== chatId)
      return
    if (session.models[0] !== models[0] || session.models[1] !== models[1])
      return
    if (models[0] === models[1]) return
    const text = input.text
    const attachments = input.attachments.map((item) => ({ ...item }))
    if (text.trim().length === 0 && attachments.length === 0) return
    compareSession.set({ ...session, phase: 'pending' })

    const realId: ChatId = chatId === 'new' ? createId() : chatId
    const source = getChatModel(chatId)
    const settings = source.settings()
    const presetId = source.presetId()
    const lock = await wrap(acquireStreamLock(realId))
    if (!lock) {
      compareSession.set({ ...session, phase: 'armed' })
      return
    }

    const at = now()
    const userId = createId()
    const leftId = createId()
    const rightId = createId()
    const groupId = `compare-${userId}`
    const parentId = source.path().at(-1)?.message.id ?? null
    const user: UserMessage = {
      id: userId,
      chatId: realId,
      parentId,
      createdAt: at,
      rev: 1,
      role: 'user',
      content: text,
      attachments,
    }
    const left = assistantShell({
      id: leftId,
      chatId: realId,
      parentId: userId,
      model: models[0],
      at,
      groupId,
    })
    const right = assistantShell({
      id: rightId,
      chatId: realId,
      parentId: userId,
      model: models[1],
      at: at + 1,
      groupId,
    })
    const selection = {
      ...(source.record()?.selection ?? {}),
      [selectionKeyOf(user)]: user.id,
      [user.id]: left.id,
    }
    const chat = getChatModel(realId)
    writeMessage(chat, user)
    writeMessage(chat, left)
    writeMessage(chat, right)
    compareSession.set({
      chatId: realId,
      phase: 'pending',
      models,
      groupId,
    })
    syncCompareEstimate(false)
    chat.draft.text.set(holdDraft)
    if (chatId === 'new') {
      source.draft.text.set('')
      source.draft.attachments.set([])
    }

    let ready: Promise<void>
    if (chatId === 'new') {
      const created = createChat({
        ...createChatRecord({
          id: realId,
          at,
          title: chatTitle(text) || attachments[0]?.name || 'New chat',
          model: models[0],
          presetId,
          settings,
        }),
        selection,
      })
      ready = created.then(
        () => undefined,
        () => undefined,
      )
      chatModelInternals('new').resetPending()
      if (activeChatId() === 'new') openChat(realId)
    } else {
      const patched = patchChat(realId, { selection })
      ready = patched.then(
        () => undefined,
        () => undefined,
      )
    }
    enqueuePersist(ready, user)
    enqueuePersist(ready, left)
    enqueuePersist(ready, right)

    const leftControl: LaneControl = {
      controller: new AbortController(),
      stopRequested: false,
    }
    const rightControl: LaneControl = {
      controller: new AbortController(),
      stopRequested: false,
    }
    controls.set(left.id, leftControl)
    controls.set(right.id, rightControl)

    try {
      const path = ancestorChain(chat.messages(), user.id)
      const blobs = await wrap(loadAttachments(path))
      const wire = assembleContext({
        path,
        systemPrompt: settings.systemPrompt,
        requestModel: models[0],
        endAtUserId: user.id,
        attachment: (id) => blobs.get(id),
      })
      const inputTokens = estimateTokens(contextCharacterCount(wire))
      const privacy = globalPrivacy()
      const startLane = (
        message: AssistantMessage,
        modelId: string,
        control: LaneControl,
      ) => {
        const catalogModel = catalogById().get(modelId) ?? null
        const request = buildChatRequest({
          modelId,
          model: catalogModel,
          messages: wire,
          settings,
          globalPrivacy: privacy,
        })
        const iterator = streamChat(request, {
          signal: control.controller.signal,
        })
        const started = iterator.next()
        const task = consumeLane({
          chat,
          ready,
          message,
          model: catalogModel,
          settings,
          user,
          inputTokens,
          request,
          control,
          started,
          iterator,
        })
        inflight.set(message.id, task)
        void task.finally(() => {
          if (inflight.get(message.id) === task) inflight.delete(message.id)
        })
        return task
      }
      const lanes = [
        startLane(left, models[0], leftControl),
        startLane(right, models[1], rightControl),
      ]
      await wrap(Promise.all(lanes.map((lane) => lane.catch(() => undefined))))
      await wrap(
        Promise.all(
          [user.id, left.id, right.id].map(
            (id) => persists.get(id) ?? Promise.resolve(),
          ),
        ).catch(() => undefined),
      )
    } finally {
      const freeing = lock.release()
      await wrap(freeing)
    }
  },
  'chat.engine.compareSend',
).extend(withAsync())
