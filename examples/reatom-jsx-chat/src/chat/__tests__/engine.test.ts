import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { overrideTimings } from '../../app/timings'
import { apiKey } from '../../auth/keyStore'
import { catalogModels } from '../../catalog/catalog'
import { claimTabId, tabId } from '../../platform/env'
import { errorAdapters } from '../../errors'
import { writeFailure } from '../../storage/health'
import { createChatRecord } from '../../storage/records'
import { globalPrivacy } from '../../storage/prefs'
import { createMemoryRepo } from '../../storage/memoryRepo'
import { setRepoBackend } from '../../storage/repo'
import { syncReceived } from '../../sync'
import type { SyncBus, SyncEvent } from '../../sync/types'
import type {
  AssistantMessage,
  MessageRecord,
  Repo,
} from '../../storage/types'
import {
  chatBodies,
  mockChatStream,
  mockChatStreams,
  mockGeneration,
  mockRouteDelay,
  requestsTo,
} from '../../testing/openrouter-mock'
import { generationRecord } from '../../testing/fixtures/generation'
import {
  citationsScript,
  emptyStopScript,
  errorOnlyScript,
  lengthScript,
  midStreamErrorScript,
  midStreamPaymentScript,
  plainTextScript,
  reasoningScript,
  refusalScript,
} from '../../testing/fixtures/sse'
import { getChatModel, sendBlockContributors } from '../chatModel'
import {
  cancelCostSettlement,
  editAndSend,
  generatingChats,
  recoverInterrupted,
  regenerate,
  retry,
  send,
  stop,
  streamLifecycle,
} from '../engine'
import { deleteChats, library, libraryRecords, undoDelete } from '../library'
import { injectSyncPublisher } from '../syncPublisher'
import {
  assistantMessage,
  claudeSonnet,
  gpt4oMini,
  userMessage,
} from './fixtures'

type WireBody = {
  model: string
  messages: Array<Record<string, unknown>>
  [key: string]: unknown
}

const startUrl = location.href
let backend: Repo
let putMessageLog: Array<{ at: number; message: MessageRecord }>
let published: SyncEvent[]

const chunk = (
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  extra: Record<string, unknown> = {},
) => ({
  id: 'gen-live',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: gpt4oMini.id,
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...extra,
})

const input = (text: string) => ({ text, attachments: [] })

const bodies = () => chatBodies() as WireBody[]

const onlyChatId = () => {
  const chats = library.chats()
  expect(chats).toHaveLength(1)
  return chats[0]!.id
}

const assistants = (chatId: string) =>
  [...getChatModel(chatId).messages().values()]
    .filter((message): message is AssistantMessage => message.role === 'assistant')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

const lastAssistant = (chatId: string) => assistants(chatId).at(-1)!

const waitForStatus = async (
  chatId: string,
  status: AssistantMessage['status'],
) => {
  await expect
    .poll(() => lastAssistant(chatId)?.status, { timeout: 3000, interval: 5 })
    .toBe(status)
}

const waitForActiveChat = async () => {
  await expect.poll(() => library.chats().length, { interval: 5 }).toBe(1)
  return onlyChatId()
}

beforeEach(async () => {
  history.replaceState(null, '', startUrl)
  context.reset()
  overrideTimings()
  backend = createMemoryRepo()
  putMessageLog = []
  const putMessage = backend.putMessage.bind(backend)
  backend.putMessage = async (message) => {
    putMessageLog.push({ at: performance.now(), message: structuredClone(message) })
    await putMessage(message)
  }
  setRepoBackend(backend)
  published = []
  const recordingBus: SyncBus = {
    supported: true,
    publish: (event) => {
      published.push(structuredClone(event))
    },
  }
  injectSyncPublisher(recordingBus)
  apiKey.set('sk-or-v1-test')
  catalogModels.set([gpt4oMini, claudeSonnet])
  vi.spyOn(errorAdapters, 'fromStreamErrorChunk')
  vi.mocked(errorAdapters.fromStreamErrorChunk).mockClear()
  await library.reload()
})

const expectStreamErrorAdapted = (code: number, contentReceived: boolean) => {
  expect(errorAdapters.fromStreamErrorChunk).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expect.objectContaining({ code }),
    }),
    { contentReceived },
  )
}

afterEach(() => {
  cancelCostSettlement()
  vi.mocked(errorAdapters.fromStreamErrorChunk).mockRestore()
  vi.useRealTimers()
  history.replaceState(null, '', startUrl)
})

describe('F-05 send and stream', () => {
  test('With default chat settings, the body contains only model, messages, stream: true, and the F-19 privacy fields', async () => {
    mockChatStream(plainTextScript)
    await send('new', input('Hello there'))

    expect(bodies()).toEqual([
      {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello there' }],
        stream: true,
        provider: { data_collection: 'deny' },
      },
    ])
    const chatId = onlyChatId()
    expect(lastAssistant(chatId)).toMatchObject({
      status: 'done',
      content: 'Hello',
      generationId: plainTextScript[0]!.data.id,
      usage: { cost: 0.000012, isByok: false, promptTokens: 10, completionTokens: 4 },
    })
    expect(library.chats()[0]!.title).toBe('Hello there')
    const stored = await backend.listMessages(chatId)
    expect(stored.find((message) => message.role === 'assistant')).toMatchObject({
      status: 'done',
      content: 'Hello',
    })
  })

  test('One Enter produces exactly one POST /chat/completions (R-6).', async () => {
    mockChatStream(plainTextScript)
    await send('new', input('One'))
    const chatId = onlyChatId()
    await send(chatId, input('Two'))
    expect(bodies()).toHaveLength(2)
    expect(bodies()[1]!.messages).toEqual([
      { role: 'user', content: 'One' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Two' },
    ])
  })

  test('The user message is in the DOM before the completion fetch resolves.', async () => {
    mockChatStream(plainTextScript)
    mockRouteDelay('/chat/completions', 300)
    const pending = send('new', input('Early'))
    const chatId = await waitForActiveChat()
    await expect
      .poll(() =>
        [...getChatModel(chatId).messages().values()].map((m) => m.role),
      )
      .toEqual(['user', 'assistant'])
    expect(lastAssistant(chatId).status).toBe('waiting')
    expect(getChatModel(chatId).streaming()).toEqual({
      messageId: lastAssistant(chatId).id,
      local: true,
    })
    await pending
    expect(lastAssistant(chatId).status).toBe('done')
  })

  test('During a stream: Enter is ignored, and no second POST is sent during or after the stream until the next Enter (R-6).', async () => {
    mockChatStream({ chunks: [{ data: chunk({ content: 'Partial' }) }], hang: true })
    const first = send('new', input('First'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    expect(getChatModel(chatId).sendBlock()).toMatchObject({ code: 'streaming' })

    await send(chatId, input('Ignored'))
    await retry(chatId, lastAssistant(chatId).id)
    expect(bodies()).toHaveLength(1)
    expect(generatingChats().has(chatId)).toBe(true)

    stop(chatId)
    await first
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(bodies()).toHaveLength(1)
    expect(generatingChats().has(chatId)).toBe(false)
    expect(
      [...getChatModel(chatId).messages().values()].filter((m) => m.role === 'user'),
    ).toHaveLength(1)
  })

  test('Two sends back to back on a new chat produce exactly one POST /chat/completions (R-6).', async () => {
    mockChatStreams([plainTextScript, plainTextScript])
    const first = send('new', input('One'))
    expect(getChatModel('new').sendBlock()).toMatchObject({ code: 'streaming' })
    const second = send('new', input('Two'))
    await first
    await second
    expect(bodies()).toHaveLength(1)
    expect(library.chats()).toHaveLength(1)
  })

  test('Stop during lock acquisition aborts that in-flight new chat, and no POST is sent (R-6).', async () => {
    mockChatStream(plainTextScript)
    const pending = send('new', input('Abort me'))
    expect(getChatModel('new').sendBlock()).toMatchObject({ code: 'streaming' })
    expect(getChatModel('new').streaming()).toEqual(
      expect.objectContaining({ local: true }),
    )
    stop('new')
    await pending
    expect(bodies()).toHaveLength(0)
    expect(library.chats()).toHaveLength(0)
    expect(getChatModel('new').sendBlock()).toMatchObject({ code: 'empty' })
    expect(getChatModel('new').streaming()).toBeNull()
  })

  test('An intermediate quota failure during a streaming flush is reported, and the chat stays unsaved', async () => {
    overrideTimings({ flushMs: 20 })
    const putMessage = backend.putMessage.bind(backend)
    backend.putMessage = async (message) => {
      if (
        message.role === 'assistant' &&
        message.status === 'streaming' &&
        message.content.length > 0
      ) {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      await putMessage(message)
    }
    mockChatStream({ chunks: [{ data: chunk({ content: 'Partial' }) }], hang: true })
    const pending = send('new', input('Save me'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    await expect
      .poll(() => writeFailure()?.reason, { timeout: 1000 })
      .toBe('quota')
    expect(getChatModel(chatId).unsaved()).toBe(true)
    stop(chatId)
    await pending
    expect(lastAssistant(chatId).status).toBe('stopped')
    expect(writeFailure()?.reason).toBe('quota')
    expect(getChatModel(chatId).unsaved()).toBe(true)
  })

  test('The end-of-stream save reports a quota failure and keeps the chat unsaved', async () => {
    const putMessage = backend.putMessage.bind(backend)
    backend.putMessage = async (message) => {
      if (message.role === 'assistant' && message.status === 'done') {
        throw new DOMException('quota', 'QuotaExceededError')
      }
      await putMessage(message)
    }
    mockChatStream(plainTextScript)
    await send('new', input('Final save'))
    const chatId = onlyChatId()
    expect(writeFailure()?.reason).toBe('quota')
    expect(getChatModel(chatId).unsaved()).toBe(true)
    expect(lastAssistant(chatId).status).toBe('done')
  })

  test('With no model resolved, Send is disabled per R-2 and nothing is posted', async () => {
    catalogModels.set([])
    expect(getChatModel('new').sendBlock()).toMatchObject({
      code: 'no-model',
      label: 'Choose a model',
    })
    await send('new', input('Hello'))
    expect(bodies()).toHaveLength(0)
    expect(library.chats()).toHaveLength(0)
  })

  test('Every failure keeps the user message and the draft clears only on an accepted send', async () => {
    mockChatStream({ networkError: true })
    const pendingDraft = getChatModel('new').draft.text
    pendingDraft.set('Lost connection?')
    await send('new', input('Lost connection?'))
    const chatId = onlyChatId()
    expect(pendingDraft()).toBe('')
    expect(lastAssistant(chatId)).toMatchObject({
      status: 'connection-lost',
      error: { kind: 'connection-lost' },
    })
    const users = [...getChatModel(chatId).messages().values()].filter(
      (message) => message.role === 'user',
    )
    expect(users.map((message) => message.content)).toEqual(['Lost connection?'])
  })

  test('streamLifecycle reports started, first-token and completed', async () => {
    const events: string[] = []
    const unsubscribe = streamLifecycle.subscribe((event) => {
      events.push(event.type)
    })
    mockChatStream(plainTextScript)
    await send('new', input('Hi'))
    unsubscribe()
    expect(events).toEqual(['started', 'first-token', 'completed'])
  })
})

describe('F-05b keep the reply', () => {
  test('Text is flushed at least every 500 ms.', async () => {
    const slowChunks = Array.from({ length: 16 }, (_, index) => ({
      delayMs: 100,
      data: chunk({ content: `part-${index} ` }),
    }))
    mockChatStream([
      ...slowChunks,
      {
        data: chunk({ content: '' }, 'stop', {
          usage: {
            prompt_tokens: 1,
            completion_tokens: 16,
            total_tokens: 17,
            cost: 0.00001,
            is_byok: false,
          },
        }),
      },
    ])
    const startedAt = performance.now()
    await send('new', input('Stream slowly'))
    const chatId = onlyChatId()
    const assistantId = lastAssistant(chatId).id
    const writes = putMessageLog.filter((entry) => entry.message.id === assistantId)
    const streamingWrites = writes.filter(
      (entry) => (entry.message as AssistantMessage).status === 'streaming',
    )
    expect(streamingWrites.length).toBeGreaterThanOrEqual(2)
    const times = [startedAt, ...writes.map((entry) => entry.at)]
    for (let index = 1; index < times.length; index++) {
      expect(times[index]! - times[index - 1]!).toBeLessThan(700)
    }
    let previousLength = 0
    let previousRev = 0
    for (const entry of writes) {
      const message = entry.message as AssistantMessage
      expect(message.content.length).toBeGreaterThanOrEqual(previousLength)
      expect(message.rev).toBeGreaterThan(previousRev)
      previousLength = message.content.length
      previousRev = message.rev
    }
    expect((writes.at(-1)!.message as AssistantMessage).status).toBe('done')
  })

  test('Within 1 s of reload, no spinner remains and the message shows "Interrupted" and Retry. Retry follows R-3 and R-5', async () => {
    const chat = createChatRecord({ id: 'chat-1', at: 1, title: 'Reloaded', model: gpt4oMini.id })
    await backend.createChat(chat)
    await backend.putMessage(userMessage('u1', null, 'Question'))
    await backend.putMessage(
      assistantMessage('a1', 'u1', 'So far', {
        status: 'streaming',
        finishReason: null,
        ownerTab: 'another-tab',
      }),
    )
    await library.reload()
    getChatModel('chat-1').messages.subscribe(() => {})

    const startedAt = performance.now()
    await recoverInterrupted()
    expect(performance.now() - startedAt).toBeLessThan(1000)
    expect(bodies()).toHaveLength(0)
    const recovered = (await backend.listMessages('chat-1')).find(
      (message) => message.id === 'a1',
    )
    expect(recovered).toMatchObject({ status: 'interrupted', content: 'So far' })
    await expect
      .poll(() => getChatModel('chat-1').messages().get('a1'))
      .toMatchObject({ status: 'interrupted' })

    mockChatStream(plainTextScript)
    await retry('chat-1', 'a1')
    expect(bodies()[0]!.messages).toEqual([{ role: 'user', content: 'Question' }])
    const path = getChatModel('chat-1').path()
    expect(path.at(-1)).toMatchObject({ versions: ['a1', expect.any(String)], versionIndex: 1 })
    expect(getChatModel('chat-1').messages().get('a1')).toMatchObject({
      content: 'So far',
      status: 'interrupted',
    })
  })

  test('recovery leaves a live local stream alone', async () => {
    mockChatStream({ chunks: [{ data: chunk({ content: 'Live' }) }], hang: true })
    const pending = send('new', input('Keep going'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    await recoverInterrupted()
    expect(lastAssistant(chatId).status).toBe('streaming')
    stop(chatId)
    await pending
  })
})

describe('F-06 stop', () => {
  test('The fetch\'s AbortSignal is aborted within 100 ms of the click or keypress.', async () => {
    const signals: AbortSignal[] = []
    const mockedFetch = globalThis.fetch
    globalThis.fetch = (resource, init) => {
      const request = resource instanceof Request ? resource : new Request(resource, init)
      if (request.url.endsWith('/chat/completions')) signals.push(request.signal)
      return mockedFetch(resource, init)
    }
    try {
      mockChatStream({
        chunks: [{ data: chunk({ content: 'Partial answer' }) }],
        hang: true,
      })
      const pending = send('new', input('Long story'))
      const chatId = await waitForActiveChat()
      await waitForStatus(chatId, 'streaming')
      expect(signals).toHaveLength(1)
      let abortedAt = 0
      signals[0]!.addEventListener('abort', () => {
        abortedAt = performance.now()
      })
      const clickedAt = performance.now()
      stop(chatId)
      await pending
      expect(signals[0]!.aborted).toBe(true)
      expect(abortedAt - clickedAt).toBeLessThan(100)
      expect(lastAssistant(chatId)).toMatchObject({
        status: 'stopped',
        content: 'Partial answer',
        error: null,
      })
      const stored = (await backend.listMessages(chatId)).find(
        (message) => message.id === lastAssistant(chatId).id,
      )
      expect(stored).toMatchObject({ status: 'stopped', content: 'Partial answer' })
    } finally {
      globalThis.fetch = mockedFetch
    }
  })

  test('The partial text persists after reload with the label "Stopped". The next manual send includes it per R-3.', async () => {
    mockChatStreams([
      { chunks: [{ data: chunk({ content: 'Partial answer' }) }], hang: true },
      plainTextScript,
    ])
    const pending = send('new', input('First'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    stop(chatId)
    await pending
    await send(chatId, input('Second'))
    expect(bodies()[1]!.messages).toEqual([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Partial answer' },
      { role: 'user', content: 'Second' },
    ])
  })

  test('Stop before the first token leaves the empty reply with stopped status and no content; without an id GET /generation is never called', async () => {
    mockChatStream({ chunks: [], hang: true })
    const pending = send('new', input('Never mind'))
    const chatId = await waitForActiveChat()
    await expect.poll(() => bodies().length).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 30))
    stop(chatId)
    await pending
    expect(lastAssistant(chatId)).toMatchObject({
      status: 'stopped',
      content: '',
      generationId: null,
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(requestsTo('/generation')).toHaveLength(0)
  })

  test('Stop before the response headers arrive still ends as stopped', async () => {
    mockChatStream(plainTextScript)
    mockRouteDelay('/chat/completions', 2000)
    const pending = send('new', input('Slow start'))
    const chatId = await waitForActiveChat()
    await expect.poll(() => bodies().length).toBe(1)
    stop(chatId)
    await pending
    expect(lastAssistant(chatId)).toMatchObject({ status: 'stopped', content: '' })
  })

  test('A Stop during thinking keeps the reasoning and labels it "Stopped while thinking".', async () => {
    mockChatStream({ chunks: [{ data: chunk({ reasoning: 'Considering' }) }], hang: true })
    const pending = send('new', input('Think'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    stop(chatId)
    await pending
    expect(lastAssistant(chatId)).toMatchObject({
      status: 'stopped',
      reasoning: { text: 'Considering', stoppedWhileThinking: true },
    })
  })

  test('If a generation id was seen, the app polls GET /generation?id=<that id> with backoff (1, 2, 4, 8, 16, then 29 s; at most 60 s in total).', async () => {
    mockChatStream({ chunks: [{ data: chunk({ content: 'Partial' }) }], hang: true })
    mockGeneration({ status: 404 })
    const pending = send('new', input('Poll me'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    stop(chatId)
    await pending

    const generationCalls = () => requestsTo('/generation').length
    const checkpoints: Array<[number, number]> = [
      [999, 0],
      [1, 1],
      [1999, 1],
      [1, 2],
      [4000, 3],
      [8000, 4],
      [16000, 5],
      [28999, 5],
      [1, 6],
      [120000, 6],
    ]
    for (const [advanceMs, expectedCalls] of checkpoints) {
      await vi.advanceTimersByTimeAsync(advanceMs)
      expect(generationCalls()).toBe(expectedCalls)
    }
    expect(new URL(requestsTo('/generation')[0]!.url).searchParams.get('id')).toBe(
      'gen-live',
    )
    expect(lastAssistant(chatId)).toMatchObject({ status: 'stopped', usage: null })
  })

  test('When data.total_cost arrives, the line shows the exact amount', async () => {
    mockChatStream({ chunks: [{ data: chunk({ content: 'Partial' }) }], hang: true })
    mockGeneration(generationRecord)
    const pending = send('new', input('Settle'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stop(chatId)
    await pending
    await vi.advanceTimersByTimeAsync(1000)
    vi.useRealTimers()
    await expect
      .poll(() => lastAssistant(chatId).usage)
      .toEqual({
        promptTokens: 10,
        completionTokens: 4,
        reasoningTokens: 3,
        cost: 0.000012,
        isByok: true,
        source: 'generation',
      })
    expect(requestsTo('/generation')).toHaveLength(1)
  })
})

describe('F-10 reasoning and F-11 cost', () => {
  test('reasoning_details received for a turn are sent back unchanged on the next request, subject to R-3\'s same-model rule.', async () => {
    mockChatStreams([reasoningScript, plainTextScript, plainTextScript])
    await send('new', input('Think first'))
    const chatId = onlyChatId()
    expect(lastAssistant(chatId)).toMatchObject({
      content: 'Hi',
      reasoning: {
        text: 'think',
        details: [{ type: 'reasoning.text', text: 'think' }],
        hiddenByProvider: false,
      },
      usage: { reasoningTokens: 3, isByok: true },
    })
    const thought = lastAssistant(chatId).reasoning!
    expect(thought.startedAt).not.toBeNull()
    expect(thought.endedAt).not.toBeNull()

    await send(chatId, input('Again'))
    const sameModel = bodies()[1]!
    expect(sameModel.messages[1]).toEqual({
      role: 'assistant',
      content: 'Hi',
      reasoning_details: [{ type: 'reasoning.text', text: 'think' }],
    })
    expect(sameModel).not.toHaveProperty('reasoning')
    expect(sameModel).not.toHaveProperty('reasoning_effort')

    const secondReply = lastAssistant(chatId)
    await regenerate(chatId, secondReply.id, { model: claudeSonnet.id })
    const otherModel = bodies()[2]!
    expect(otherModel.model).toBe(claudeSonnet.id)
    expect(otherModel.messages).toEqual([
      { role: 'user', content: 'Think first' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Again' },
    ])
    expect(getChatModel(chatId).model()).toBe(gpt4oMini.id)
    expect(lastAssistant(chatId).model).toBe(claudeSonnet.id)
  })

  test('While streaming: the footer keeps "≈", and its value rises each time the output character count crosses a multiple of 4. It never drops.', async () => {
    const chunks = ['abcd', 'efgh', 'ij', 'klmnop'].map((text) => ({
      delayMs: 30,
      data: chunk({ content: text }),
    }))
    mockChatStream([...chunks, { data: chunk({ content: '' }, 'stop') }])
    const estimates: number[] = []
    const pending = send('new', input('Count'))
    const chatId = await waitForActiveChat()
    const unsubscribe = getChatModel(chatId).messages.subscribe(() => {
      const message = lastAssistant(chatId)
      if (message) estimates.push(message.estimateCost)
    })
    await pending
    unsubscribe()
    for (let index = 1; index < estimates.length; index++) {
      expect(estimates[index]!).toBeGreaterThanOrEqual(estimates[index - 1]!)
    }
    expect(lastAssistant(chatId).estimateCost).toBeGreaterThan(0)
    expect(lastAssistant(chatId).timing.firstTokenAt).not.toBeNull()
    expect(lastAssistant(chatId).timing.endAt).not.toBeNull()
  })

  test('The provider name comes from the response (provider field) and citations from annotations', async () => {
    mockChatStream(citationsScript)
    await send('new', input('Search'))
    const chatId = onlyChatId()
    expect(lastAssistant(chatId)).toMatchObject({
      provider: 'Perplexity',
      citations: [{ url: 'https://example.com/a', title: 'Alpha', domain: 'example.com' }],
    })
  })

  test('the provider falls back to the X-Provider-Name header', async () => {
    mockChatStream({ chunks: plainTextScript, headers: { 'X-Provider-Name': 'Groq' } })
    await send('new', input('Header'))
    expect(lastAssistant(onlyChatId()).provider).toBe('Groq')
  })
})

describe('F-12 / F-12b / R-5 versions', () => {
  test('A failed attempt with no text stays as a version only while it carries its error card. It is dropped once a later attempt of the same turn succeeds.', async () => {
    mockChatStreams([errorOnlyScript, plainTextScript])
    await send('new', input('Question'))
    const chatId = onlyChatId()
    const failed = lastAssistant(chatId)
    expect(failed).toMatchObject({ status: 'error', content: '', error: { code: 503 } })

    await retry(chatId, failed.id)
    expect(bodies()[1]!.messages).toEqual([{ role: 'user', content: 'Question' }])
    await expect.poll(() => getChatModel(chatId).messages().has(failed.id)).toBe(false)
    expect(
      (await backend.listMessages(chatId)).some((message) => message.id === failed.id),
    ).toBe(false)
    expect(getChatModel(chatId).path().at(-1)).toMatchObject({
      versions: [lastAssistant(chatId).id],
      message: { status: 'done', content: 'Hello' },
    })
  })

  test('A failed attempt that showed some text stays as a version.', async () => {
    mockChatStreams([midStreamErrorScript, plainTextScript])
    await send('new', input('Question'))
    const chatId = onlyChatId()
    const partial = lastAssistant(chatId)
    expect(partial).toMatchObject({
      status: 'error',
      content: 'Partial',
      error: { kind: 'provider-disconnected', code: 502 },
    })

    await retry(chatId, partial.id)
    expect(bodies()[1]!.messages).toEqual([{ role: 'user', content: 'Question' }])
    const lastNode = getChatModel(chatId).path().at(-1)!
    expect(lastNode.versions).toEqual([partial.id, lastAssistant(chatId).id])
    expect(lastNode.versionIndex).toBe(1)

    getChatModel(chatId).selectVersion(partial.id)
    await expect
      .poll(() => getChatModel(chatId).path().at(-1)?.message.id)
      .toBe(partial.id)
    expect((await backend.getChat(chatId))!.selection).toMatchObject({
      [partial.parentId!]: partial.id,
    })
  })

  test('After switching versions, requests contain only the shown path.', async () => {
    mockChatStreams([plainTextScript, plainTextScript, plainTextScript])
    await send('new', input('Q'))
    const chatId = onlyChatId()
    const first = lastAssistant(chatId)
    await regenerate(chatId, first.id)
    getChatModel(chatId).selectVersion(first.id)
    await expect
      .poll(() => getChatModel(chatId).path().at(-1)?.message.id)
      .toBe(first.id)
    await send(chatId, input('Follow-up'))
    expect(bodies()[2]!.messages).toEqual([
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Follow-up' },
    ])
    expect(getChatModel(chatId).path().map((node) => node.message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })

  test('The body ends at the edited user message and contains nothing after it (R-3).', async () => {
    mockChatStreams([plainTextScript, plainTextScript, plainTextScript])
    await send('new', input('Original'))
    const chatId = onlyChatId()
    await send(chatId, input('Second turn'))
    const original = getChatModel(chatId).path()[0]!.message

    await editAndSend(chatId, original.id, input('Edited'))
    expect(bodies()[2]!.messages).toEqual([{ role: 'user', content: 'Edited' }])
    const path = getChatModel(chatId).path()
    expect(path[0]).toMatchObject({ versionIndex: 1, message: { content: 'Edited' } })
    expect(path[0]!.versions).toHaveLength(2)
    expect(path).toHaveLength(2)

    getChatModel(chatId).selectVersion(original.id)
    await expect.poll(() => getChatModel(chatId).path()).toHaveLength(4)
  })

  test('"Save & send" with unchanged text sends nothing', async () => {
    mockChatStream(plainTextScript)
    await send('new', input('Same'))
    const chatId = onlyChatId()
    const original = getChatModel(chatId).path()[0]!.message
    await editAndSend(chatId, original.id, input('Same'))
    expect(bodies()).toHaveLength(1)
  })
})

describe('F-18 broken, empty, or refused reply', () => {
  test('A quota error (402) mid-stream shows the 402 card, not "Connection lost".', async () => {
    mockChatStream(midStreamPaymentScript)
    await send('new', input('Pay'))
    expect(lastAssistant(onlyChatId())).toMatchObject({
      status: 'error',
      content: 'Partial',
      error: { code: 402 },
    })
    expect(lastAssistant(onlyChatId()).error!.kind).not.toBe('connection-lost')
    expectStreamErrorAdapted(402, true)
  })

  test('finish_reason: "length" with content: the text ends with the note "Reply cut off at the length limit."', async () => {
    mockChatStream(lengthScript)
    await send('new', input('Long'))
    expect(lastAssistant(onlyChatId())).toMatchObject({
      status: 'cut-off',
      content: 'truncated',
      error: { kind: 'cut-off', title: 'Reply cut off at the length limit.' },
    })
  })

  test('Empty content, finish_reason: "stop", no reasoning tokens: "The model returned an empty reply." with Retry.', async () => {
    mockChatStream(emptyStopScript)
    await send('new', input('Nothing?'))
    expect(lastAssistant(onlyChatId())).toMatchObject({
      status: 'error',
      content: '',
      error: { kind: 'empty-reply' },
    })
  })

  test('finish_reason: "content_filter" or message.refusal: a refusal bubble with the refusal text', async () => {
    mockChatStream(refusalScript)
    await send('new', input('Refuse'))
    expect(lastAssistant(onlyChatId())).toMatchObject({
      status: 'refused',
      refusal: "I can't help with that request.",
      error: { kind: 'refusal' },
    })
  })

  test('HTTP errors classify into cards and keep the user message', async () => {
    mockChatStream({ status: 401 })
    await send('new', input('Who am I'))
    const chatId = onlyChatId()
    expect(lastAssistant(chatId)).toMatchObject({
      status: 'error',
      error: { kind: 'auth-rejected', code: 401 },
    })
    expect(bodies()).toHaveLength(1)
  })
})

describe('F-19 privacy', () => {
  test('With ZDR on, the body has provider.zdr: true. With "Exclude…" off, data_collection is absent.', async () => {
    globalPrivacy.set({ denyDataCollection: false, zdr: true })
    mockChatStream(plainTextScript)
    await send('new', input('Private'))
    expect(bodies()[0]!.provider).toEqual({ zdr: true })
  })

  test('The chat override wins over the global setting', async () => {
    mockChatStreams([plainTextScript, plainTextScript])
    await send('new', input('One'))
    const chatId = onlyChatId()
    getChatModel(chatId).updateSettings({
      privacyOverride: { denyDataCollection: false, zdr: false },
      systemPrompt: 'Be brief',
    })
    await expect
      .poll(() => libraryRecords()[0]!.settings.systemPrompt)
      .toBe('Be brief')
    await send(chatId, input('Two'))
    expect(bodies()[1]).not.toHaveProperty('provider')
    expect(bodies()[1]!.messages[0]).toEqual({ role: 'system', content: 'Be brief' })
  })
})

describe('F-13 delete while streaming', () => {
  test('Deleting the open chat aborts its stream, keeps the partial text in the tombstone, and Undo restores it.', async () => {
    mockChatStream({ chunks: [{ data: chunk({ content: 'Partial' }) }], hang: true })
    const pending = send('new', input('Delete me'))
    const chatId = await waitForActiveChat()
    await waitForStatus(chatId, 'streaming')
    deleteChats([chatId])
    await pending
    expect(library.chats()).toHaveLength(0)
    const stored = await backend.listMessages(chatId)
    expect(stored.find((message) => message.role === 'assistant')).toMatchObject({
      status: 'stopped',
      content: 'Partial',
    })
    undoDelete()
    await expect.poll(() => library.chats().length).toBe(1)
    expect((await backend.getChat(chatId))!.deletedAt).toBeNull()
  })

  test('After 8 s, the chat\'s records are gone', async () => {
    overrideTimings({ undoMs: 200 })
    mockChatStream(plainTextScript)
    await send('new', input('Short lived'))
    const chatId = onlyChatId()
    deleteChats([chatId])
    expect(libraryRecords()[0]!.deletedByTab).toBe(tabId)
    await expect
      .poll(async () => (await backend.getChat(chatId)) ?? null, { timeout: 2000 })
      .toBeNull()
    expect(await backend.listMessages(chatId)).toEqual([])
  })
})

const midStreamRateLimitScript = [
  { data: chunk({ content: 'Partial' }) },
  {
    data: chunk({ content: '' }, 'error', {
      error: {
        code: 429,
        message: 'Rate limit exceeded upstream',
        metadata: { error_type: 'rate_limit' },
      },
    }),
  },
]

describe('F-17b / F-18 mid-stream errors are mapped by their SSE error code', () => {
  test('A mid-stream 429 keeps the partial text under the rate-limit card; the next request includes it and regenerate omits the replaced version', async () => {
    mockChatStreams([midStreamRateLimitScript, plainTextScript, plainTextScript])
    await send('new', input('Question'))
    const chatId = onlyChatId()
    const partial = lastAssistant(chatId)
    expect(partial).toMatchObject({
      status: 'error',
      content: 'Partial',
      error: { kind: 'rate-limited', code: 429 },
    })
    expect(partial.error!.title).toMatch(/^Rate limited/)
    expect(partial.error!.title).not.toContain('mid-reply')
    expectStreamErrorAdapted(429, true)
    expect(
      (await backend.listMessages(chatId)).find((message) => message.id === partial.id),
    ).toMatchObject({ status: 'error', content: 'Partial' })

    await send(chatId, input('Follow-up'))
    expect(bodies()[1]!.messages).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Partial' },
      { role: 'user', content: 'Follow-up' },
    ])

    await regenerate(chatId, partial.id)
    expect(bodies()[2]!.messages).toEqual([{ role: 'user', content: 'Question' }])
  })

  test('A mid-stream 502 after some text says "The provider disconnected mid-reply (502)."', async () => {
    mockChatStream(midStreamErrorScript)
    await send('new', input('Question'))
    expect(lastAssistant(onlyChatId())).toMatchObject({
      status: 'error',
      content: 'Partial',
      error: {
        kind: 'provider-disconnected',
        code: 502,
        title: 'The provider disconnected mid-reply (502).',
      },
    })
    expectStreamErrorAdapted(502, true)
  })

  test('A 200 response whose only chunk is an error shows the card for that code, never "mid-reply"', async () => {
    mockChatStream(errorOnlyScript)
    await send('new', input('Question'))
    const failed = lastAssistant(onlyChatId())
    expect(failed).toMatchObject({
      status: 'error',
      content: '',
      error: { kind: 'unavailable', code: 503 },
    })
    expect(failed.error!.title).not.toContain('mid-reply')
    expectStreamErrorAdapted(503, false)
  })

  test('An error-only 502 chunk before any content is not described as a disconnect mid-reply', async () => {
    mockChatStream([
      {
        data: chunk({ content: '' }, 'error', {
          error: { code: 502, message: 'Bad gateway', metadata: { error_type: 'server' } },
        }),
      },
    ])
    await send('new', input('Question'))
    const failed = lastAssistant(onlyChatId())
    expect(failed).toMatchObject({ status: 'error', content: '', error: { code: 502 } })
    expect(failed.error!.title).not.toContain('mid-reply')
    expectStreamErrorAdapted(502, false)
  })
})

describe('Sync publisher', () => {
  test('The R-5 sibling drop publishes message-deleted for every dropped attempt', async () => {
    mockChatStreams([errorOnlyScript, plainTextScript])
    await send('new', input('Question'))
    const chatId = onlyChatId()
    const failed = lastAssistant(chatId)
    await retry(chatId, failed.id)
    await expect
      .poll(() => published.filter((event) => event.type === 'message-deleted'))
      .toEqual([{ type: 'message-deleted', chatId, messageId: failed.id }])
  })

  test('A received message-deleted removes the message from the loaded chat', async () => {
    mockChatStream(errorOnlyScript)
    await send('new', input('Question'))
    const chatId = onlyChatId()
    const failed = lastAssistant(chatId)
    syncReceived({ type: 'message-deleted', chatId, messageId: failed.id })
    await expect.poll(() => getChatModel(chatId).messages().has(failed.id)).toBe(false)
  })

  test('Stream and message events go through the injected publisher with the live tab id', async () => {
    const responder = new BroadcastChannel('atelier.tabs')
    responder.onmessage = (event: MessageEvent<{ type: string; tabId: string; nonce: string }>) => {
      if (event.data?.type !== 'claim') return
      responder.postMessage({ type: 'taken', tabId: event.data.tabId, nonce: event.data.nonce })
    }
    const bootTab = tabId
    const claimedTab = await claimTabId()
    responder.close()
    expect(claimedTab).not.toBe(bootTab)
    expect(tabId).toBe(claimedTab)

    mockChatStream(plainTextScript)
    await send('new', input('Question'))
    const chatId = onlyChatId()
    expect(lastAssistant(chatId).ownerTab).toBe(claimedTab)
    expect(published).toContainEqual({ type: 'stream', chatId, tabId: claimedTab, active: true })
    expect(published).toContainEqual({ type: 'stream', chatId, tabId: claimedTab, active: false })
    expect(published.some((event) => event.type === 'message')).toBe(true)
  })
})

describe('Send block contributors', () => {
  test('A registered contributor blocks Send after the built-in checks and unregistering lifts it', async () => {
    const pendingChat = getChatModel('new')
    pendingChat.draft.text.set('Ready to send')
    expect(pendingChat.sendBlock()).toBeNull()

    const unregister = sendBlockContributors.register(() => ({
      code: 'compare-pending',
      label: 'Pick a reply to keep first',
    }))
    expect(pendingChat.sendBlock()).toEqual({
      code: 'compare-pending',
      label: 'Pick a reply to keep first',
    })

    unregister()
    expect(pendingChat.sendBlock()).toBeNull()
  })

  test('Built-in checks win over contributors', async () => {
    const unregister = sendBlockContributors.register(() => ({
      code: 'compare-pending',
      label: 'Pick a reply to keep first',
    }))
    const pendingChat = getChatModel('new')
    expect(pendingChat.sendBlock()).toMatchObject({ code: 'empty' })
    unregister()
  })
})
