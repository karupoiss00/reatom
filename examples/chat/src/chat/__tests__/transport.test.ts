import { HTTPClient } from '@openrouter/sdk'
import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { overrideTimings } from '../../app/timings'
import { apiKey } from '../../auth/keyStore'
import { catalogModels } from '../../catalog/catalog'
import { errorAdapters } from '../../errors'
import { createMemoryRepo } from '../../storage/memoryRepo'
import { setRepoBackend } from '../../storage/repo'
import { mockChatStreams, requestsTo } from '../../testing/openrouter-mock'
import {
  errorOnlyScript,
  midStreamErrorScript,
  plainTextScript,
} from '../../testing/fixtures/sse'
import { cancelCostSettlement, send } from '../engine'
import { library } from '../library'
import { gpt4oMini } from './fixtures'

const input = (text: string) => ({ text, attachments: [] })

const hookedClients = () =>
  vi.mocked(HTTPClient.prototype.addHook).mock.instances

const clientsThatSent = () => {
  const hooked = new Set(hookedClients())
  return vi
    .mocked(HTTPClient.prototype.request)
    .mock.instances.filter((client) => hooked.has(client))
}

beforeEach(async () => {
  context.reset()
  overrideTimings()
  setRepoBackend(createMemoryRepo())
  apiKey.set('sk-or-v1-test')
  catalogModels.set([gpt4oMini])
  await library.reload()
  vi.spyOn(HTTPClient.prototype, 'addHook')
  vi.spyOn(HTTPClient.prototype, 'request')
  vi.mocked(HTTPClient.prototype.addHook).mockClear()
  vi.mocked(HTTPClient.prototype.request).mockClear()
  vi.spyOn(errorAdapters, 'fromStreamErrorChunk')
  vi.spyOn(errorAdapters, 'classifyFailure')
  vi.mocked(errorAdapters.fromStreamErrorChunk).mockClear()
  vi.mocked(errorAdapters.classifyFailure).mockClear()
})

afterEach(() => {
  cancelCostSettlement()
  vi.mocked(HTTPClient.prototype.addHook).mockRestore()
  vi.mocked(HTTPClient.prototype.request).mockRestore()
  vi.mocked(errorAdapters.fromStreamErrorChunk).mockRestore()
  vi.mocked(errorAdapters.classifyFailure).mockRestore()
})

describe('streamChat transport', () => {
  test('Every streamChat call builds a fresh client through createOpenRouterClient with its own httpClient', async () => {
    mockChatStreams([plainTextScript, plainTextScript])
    await send('new', input('One'))
    const chatId = library.chats()[0]!.id
    await send(chatId, input('Two'))

    const hooked = hookedClients()
    const sent = clientsThatSent()
    expect(hooked).toHaveLength(2)
    expect(sent).toEqual(hooked)
    expect(hooked[0]).not.toBe(hooked[1])
    expect(
      requestsTo('/api/v1/chat/completions')[0]?.headers.authorization,
    ).toBe('Bearer sk-or-v1-test')
  })
})

describe('Stream error adapter wiring', () => {
  test('The raw error chunk reaches fromStreamErrorChunk with contentReceived: true after partial text', async () => {
    mockChatStreams([midStreamErrorScript])
    await send('new', input('Question'))

    expect(errorAdapters.fromStreamErrorChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 502,
          metadata: expect.objectContaining({ error_type: 'server' }),
        }),
      }),
      { contentReceived: true },
    )
    expect(errorAdapters.classifyFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stream-error',
        code: 502,
        contentReceived: true,
      }),
      expect.objectContaining({ contentReceived: true }),
    )
  })

  test('An error-only chunk is adapted with contentReceived: false', async () => {
    mockChatStreams([errorOnlyScript])
    await send('new', input('Question'))

    expect(errorAdapters.fromStreamErrorChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 503 }),
      }),
      { contentReceived: false },
    )
    expect(errorAdapters.classifyFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stream-error',
        code: 503,
        contentReceived: false,
      }),
      expect.objectContaining({ contentReceived: false }),
    )
  })
})
