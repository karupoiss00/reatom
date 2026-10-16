import { OpenRouter } from '@openrouter/sdk'
import type { ChatStreamChunk } from '@openrouter/sdk/models/chatstreamchunk'
import {
  BadGatewayResponseError,
  BadRequestResponseError,
  ConnectionError,
  EdgeNetworkTimeoutResponseError,
  ForbiddenResponseError,
  NotFoundResponseError,
  OpenRouterDefaultError,
  OpenRouterError,
  PayloadTooLargeResponseError,
  PaymentRequiredResponseError,
  ProviderOverloadedResponseError,
  RequestAbortedError,
  RequestTimeoutResponseError,
  ServiceUnavailableResponseError,
  TooManyRequestsResponseError,
  UnauthorizedResponseError,
} from '@openrouter/sdk/models/errors'
import { atom, withIndexedDb } from '@reatom/core'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'

import { createOpenRouterClient } from '../api/client'
import { exchangedKey, expiredAuthCode } from './fixtures/auth'
import {
  badGateway502,
  contextLength400,
  edgeTimeout524,
  forbidden403,
  freeModelCapMessage,
  gatewayTimeout504,
  maxTokens400,
  moderation403,
  overloaded529,
  payload413,
  paymentCredits402,
  paymentInFlight402,
  paymentKeyLimit402,
  paymentRequired402,
  providerRateLimitMessage,
  rateLimit429,
  rateLimitFreeCap429,
  rejected400,
  timeout408,
  tokenLimit400,
  unauthorized401,
  unavailable503,
  unknown418,
  unknownModel400,
  unknownModel404,
} from './fixtures/errors'
import { generationRecord } from './fixtures/generation'
import { freeTierKey, limitedKey, unlimitedKey } from './fixtures/keys'
import {
  catalogModels,
  curatedMiniModelId,
  freeModelId,
  longContextModelId,
  noParamsModelId,
  paidTwinModelId,
  reasoningEfforts,
  reasoningEffortsModelId,
  visionModelId,
} from './fixtures/models'
import { providerList } from './fixtures/providers'
import {
  byokUsageScript,
  citationsScript,
  contentFilterScript,
  emptyReasoningLengthScript,
  emptyStopScript,
  encryptedReasoningScript,
  errorOnlyScript,
  freeUsageScript,
  lengthScript,
  lengthWithContentScript,
  midStreamErrorScript,
  midStreamPaymentScript,
  plainTextScript,
  reasoningScript,
  refusalScript,
  slowStreamScript,
  slowStreamText,
} from './fixtures/sse'
import { registerDbNameForReset, resetBrowserState } from './env'
import {
  allowExternalPassthrough,
  chatBodies,
  externalRequests,
  installOpenRouterMock,
  mockAuthExchange,
  mockChatStream,
  mockChatStreamFor,
  mockChatStreams,
  mockGeneration,
  mockKey,
  mockModels,
  mockProviders,
  mockRouteDelay,
  openRouterRequests,
  requestsTo,
  resetOpenRouterMock,
  uninstallOpenRouterMock,
  type MockChatChunk,
  type MockChatScript,
} from './openrouter-mock'

const apiKey = atom('sk-or-v1-fixture', 'openrouter.apiKey')
const client = createOpenRouterClient(apiKey)

const readChat = async (script: readonly MockChatChunk[]) => {
  mockChatStream(script)
  const result = await client.chat.send(
    {
      chatRequest: {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
    },
    { retries: { strategy: 'none' } },
  )
  if (!(result instanceof ReadableStream)) {
    throw new Error('Expected an OpenRouter chat stream')
  }
  const chunks: ChatStreamChunk[] = []
  for await (const chunk of result as AsyncIterable<ChatStreamChunk>) {
    chunks.push(chunk)
  }
  return chunks
}

const chatBody = () => {
  const request = openRouterRequests().find((entry) =>
    entry.url.includes('/chat/completions'),
  )
  return request
}

beforeAll(() => {
  installOpenRouterMock()
})

afterAll(() => {
  uninstallOpenRouterMock()
})

beforeEach(() => {
  resetOpenRouterMock()
})

test('models.list parses the catalog through the SDK', async () => {
  mockModels(catalogModels)
  const page = await client.models.list()
  const models = page.result.data
  expect(page.result.totalCount).toBe(catalogModels.length)
  expect(models.map((model) => model.id)).toEqual(
    catalogModels.map((model) => model.id),
  )
  expect(
    models.find((model) => model.id.endsWith(':free'))?.pricing.prompt,
  ).toBe('0')
  expect(
    models.some((model) =>
      model.supportedParameters.some((parameter) => parameter === 'reasoning'),
    ),
  ).toBe(true)
  expect(
    models.some((model) =>
      model.architecture.inputModalities.some(
        (modality) => modality === 'image',
      ),
    ),
  ).toBe(true)
  expect(
    models.some((model) =>
      model.architecture.inputModalities.some(
        (modality) => modality === 'file',
      ),
    ),
  ).toBe(true)
  expect(models.some((model) => (model.contextLength ?? 0) >= 1_000_000)).toBe(
    true,
  )
  expect(openRouterRequests()[0]?.url).toContain('/models')
  expect(openRouterRequests()[0]?.method).toBe('GET')
})

test('getCurrentKeyMetadata parses limited, unlimited, and free-tier keys', async () => {
  mockKey(limitedKey)
  const limited = await client.apiKeys.getCurrentKeyMetadata()
  expect(limited.data.limit).toBe(100)
  expect(limited.data.limitRemaining).toBe(74.5)
  expect(limited.data.isFreeTier).toBe(false)
  expect(limited.data.byokUsage).toBe(17.38)

  mockKey(unlimitedKey)
  const unlimited = await client.apiKeys.getCurrentKeyMetadata()
  expect(unlimited.data.limit).toBeNull()
  expect(unlimited.data.limitRemaining).toBeNull()

  mockKey(freeTierKey)
  const freeTier = await client.apiKeys.getCurrentKeyMetadata()
  expect(freeTier.data.isFreeTier).toBe(true)
  expect(freeTier.data.freeModelDailyRequests.remaining).toBe(12)

  const keyRequests = openRouterRequests().filter((entry) =>
    entry.url.includes('/key'),
  )
  expect(keyRequests).toHaveLength(3)
  expect(keyRequests[0]?.headers.authorization).toContain('sk-or-v1-fixture')
})

test('chat stream parses text, usage cost, and the request body', async () => {
  const chunks = await readChat(plainTextScript)
  const text = chunks
    .map((chunk) => chunk.choices[0]?.delta.content ?? '')
    .join('')
  expect(text).toBe('Hello')
  const usage = chunks.at(-1)?.usage
  expect(usage?.cost).toBe(0.000012)
  expect(usage?.isByok).toBe(false)
  expect(chunks.at(-1)?.choices[0]?.finishReason).toBe('stop')

  const request = chatBody()
  expect(request?.method).toBe('POST')
  expect(request?.body).toMatchObject({
    model: 'openai/gpt-4o-mini',
    stream: true,
    messages: [{ role: 'user', content: 'Hello' }],
  })
  expect(request?.headers.authorization).toContain('sk-or-v1-fixture')
})

test('chat stream parses reasoning deltas and BYOK usage', async () => {
  const chunks = await readChat(reasoningScript)
  expect(
    chunks.some((chunk) => chunk.choices[0]?.delta.reasoning === 'think'),
  ).toBe(true)
  const detail = chunks
    .flatMap((chunk) => chunk.choices[0]?.delta.reasoningDetails ?? [])
    .find((entry) => entry.type === 'reasoning.text')
  expect(detail && 'text' in detail ? detail.text : undefined).toBe('think')
  const usage = chunks.at(-1)?.usage
  expect(usage?.cost).toBe(0.000021)
  expect(usage?.isByok).toBe(true)
  expect(usage?.completionTokensDetails?.reasoningTokens).toBe(3)
})

test('mid-stream error chunk is yielded with finish_reason error', async () => {
  const chunks = await readChat(midStreamErrorScript)
  const failed = chunks.find((chunk) => chunk.error)
  expect(failed?.error?.code).toBe(502)
  expect(failed?.error?.message).toBe('Provider disconnected')
  expect(failed?.error?.metadata?.errorType).toBe('server')
  expect(failed?.choices[0]?.finishReason).toBe('error')
  expect(
    chunks.some((chunk) => chunk.choices[0]?.delta.content === 'Partial'),
  ).toBe(true)
})

test('finish_reason length is parsed with usage cost', async () => {
  const chunks = await readChat(lengthScript)
  expect(chunks.at(-1)?.choices[0]?.finishReason).toBe('length')
  expect(chunks.at(-1)?.usage?.cost).toBe(0.00004)
  expect(chunks.at(-1)?.usage?.isByok).toBe(false)
})

test('AbortSignal rejects chat.send with RequestAbortedError', async () => {
  mockChatStream([{ delayMs: 5_000, data: plainTextScript[0]!.data }])
  const controller = new AbortController()
  const pending = client.chat.send(
    {
      chatRequest: {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
    },
    { signal: controller.signal, retries: { strategy: 'none' } },
  )
  controller.abort()
  await expect(pending).rejects.toBeInstanceOf(RequestAbortedError)
})

test('generations.getGeneration parses cost and isByok', async () => {
  mockGeneration(generationRecord)
  const generation = await client.generations.getGeneration({
    id: 'gen-fixture',
  })
  expect(generation.data.id).toBe('gen-fixture')
  expect(generation.data.totalCost).toBe(0.000012)
  expect(generation.data.isByok).toBe(true)
  expect(generation.data.nativeTokensReasoning).toBe(3)
  expect(generation.data.streamed).toBe(true)
  const request = openRouterRequests().find((entry) =>
    entry.url.includes('/generation'),
  )
  expect(new URL(request?.url ?? '').searchParams.get('id')).toBe('gen-fixture')
})

test('the client factory is the OpenRouter SDK', () => {
  expect(client).toBeInstanceOf(OpenRouter)
})

const send = (model = 'openai/gpt-4o-mini') =>
  client.chat.send(
    {
      chatRequest: {
        model,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
    },
    { retries: { strategy: 'none' } },
  )

const collect = async (model?: string) => {
  const result = await send(model)
  if (!(result instanceof ReadableStream)) {
    throw new Error('Expected an OpenRouter chat stream')
  }
  const chunks: ChatStreamChunk[] = []
  for await (const chunk of result as AsyncIterable<ChatStreamChunk>) {
    chunks.push(chunk)
  }
  return chunks
}

const textOf = (chunks: readonly ChatStreamChunk[]) =>
  chunks.map((chunk) => chunk.choices[0]?.delta.content ?? '').join('')

const collectFrom = async (result: unknown) => {
  if (!(result instanceof ReadableStream)) {
    throw new Error('Expected an OpenRouter chat stream')
  }
  const chunks: ChatStreamChunk[] = []
  for await (const chunk of result as AsyncIterable<ChatStreamChunk>) {
    chunks.push(chunk)
  }
  return chunks
}

test('mockChatStreams serves one script per POST', async () => {
  mockChatStreams([plainTextScript, lengthScript])
  mockChatStream(reasoningScript)
  const first = await collect()
  const second = await collect()
  expect(textOf(first)).toBe('Hello')
  expect(second.at(-1)?.choices[0]?.finishReason).toBe('length')
  const third = await collect()
  expect(textOf(third)).toBe('Hi')
  expect(chatBodies()).toHaveLength(3)
  expect(requestsTo('/chat/completions')).toHaveLength(3)
})

test('mockChatStreamFor routes each model to its own script', async () => {
  mockChatStreamFor('openai/gpt-4o-mini', plainTextScript)
  mockChatStreamFor('anthropic/claude-sonnet-4', lengthScript)
  mockChatStream(reasoningScript)
  const mini = await collect('openai/gpt-4o-mini')
  const claude = await collect('anthropic/claude-sonnet-4')
  const miniAgain = await collect('openai/gpt-4o-mini')
  expect(textOf(mini)).toBe('Hello')
  expect(claude.at(-1)?.choices[0]?.finishReason).toBe('length')
  expect(textOf(miniAgain)).toBe('Hello')
  expect(chatBodies()).toMatchObject([
    { model: 'openai/gpt-4o-mini' },
    { model: 'anthropic/claude-sonnet-4' },
    { model: 'openai/gpt-4o-mini' },
  ])
})

test('hang keeps the stream open until abort', async () => {
  mockChatStream({
    hang: true,
    chunks: [{ data: plainTextScript[1]!.data }],
    headers: { 'X-Provider-Name': 'OpenAI', 'request-id': 'req_hang' },
  })
  const controller = new AbortController()
  const result = await client.chat.send(
    {
      chatRequest: {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
    },
    { signal: controller.signal, retries: { strategy: 'none' } },
  )
  expect(result).toBeInstanceOf(ReadableStream)
  let settled = false
  const pending = (async () => {
    const chunks: ChatStreamChunk[] = []
    for await (const chunk of result as AsyncIterable<ChatStreamChunk>) {
      chunks.push(chunk)
    }
    settled = true
    return chunks
  })()
  const opened = await Promise.race([
    pending.then(
      () => 'ended' as const,
      () => 'failed' as const,
    ),
    new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 40)),
  ])
  expect(opened).toBe('open')
  expect(settled).toBe(false)
  controller.abort()
  await expect(pending).rejects.toThrow()
})

test('networkError makes fetch reject with TypeError', async () => {
  mockChatStream({ networkError: true })
  const error = await send().then(
    () => {
      throw new Error('Expected a network failure')
    },
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(ConnectionError)
  expect((error as ConnectionError).cause).toBeInstanceOf(TypeError)
  expect(
    ((error as ConnectionError).cause as TypeError).message.toLowerCase(),
  ).toContain('failed to fetch')
  expect(requestsTo('/chat/completions')).toHaveLength(1)
})

test('script headers survive on the SDK error', async () => {
  mockChatStream(rateLimit429)
  const error = await send().then(
    () => {
      throw new Error('Expected a 429')
    },
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(TooManyRequestsResponseError)
  const http = error as TooManyRequestsResponseError
  expect(http.headers.get('retry-after')).toBe('23')
  expect(http.headers.get('x-provider-name')).toBe('OpenAI')
  expect(http.headers.get('request-id')).toBe('req_429')
  expect(http.error.message).toBe(providerRateLimitMessage)
})

const httpCases: Array<{
  name: string
  fixture: MockChatScript
  error: new (...args: never[]) => OpenRouterError
  status: number
  assert?: (error: OpenRouterError) => void
}> = [
  {
    name: '401',
    fixture: unauthorized401,
    error: UnauthorizedResponseError,
    status: 401,
  },
  {
    name: '402 openrouter_credits',
    fixture: paymentCredits402,
    error: PaymentRequiredResponseError,
    status: 402,
    assert: (error) => {
      expect(
        (error as PaymentRequiredResponseError).error.metadata?.limit_source,
      ).toBe('openrouter_credits')
    },
  },
  {
    name: '402 openrouter_key_limit',
    fixture: paymentKeyLimit402,
    error: PaymentRequiredResponseError,
    status: 402,
    assert: (error) => {
      expect(
        (error as PaymentRequiredResponseError).error.metadata?.limit_source,
      ).toBe('openrouter_key_limit')
    },
  },
  {
    name: '402 openrouter_in_flight_budget',
    fixture: paymentInFlight402,
    error: PaymentRequiredResponseError,
    status: 402,
    assert: (error) => {
      const payment = error as PaymentRequiredResponseError
      expect(payment.error.metadata?.limit_source).toBe(
        'openrouter_in_flight_budget',
      )
      expect(payment.headers.get('retry-after')).toBe('12')
    },
  },
  {
    name: '402 without limit_source',
    fixture: paymentRequired402,
    error: PaymentRequiredResponseError,
    status: 402,
    assert: (error) => {
      expect(
        (error as PaymentRequiredResponseError).error.metadata?.limit_source,
      ).toBeUndefined()
    },
  },
  {
    name: '403 moderation',
    fixture: moderation403,
    error: ForbiddenResponseError,
    status: 403,
    assert: (error) => {
      const metadata = (error as ForbiddenResponseError).error.metadata
      expect(metadata?.reasons).toEqual(['violence'])
      expect(metadata?.flagged_input).toBe(
        'a flagged excerpt under one hundred characters',
      )
      expect(metadata?.provider_name).toBe('Anthropic')
    },
  },
  {
    name: '403 without moderation fields',
    fixture: forbidden403,
    error: ForbiddenResponseError,
    status: 403,
    assert: (error) => {
      expect((error as ForbiddenResponseError).error.metadata).toBeUndefined()
    },
  },
  {
    name: '408',
    fixture: timeout408,
    error: RequestTimeoutResponseError,
    status: 408,
  },
  {
    name: '429 free-model cap',
    fixture: rateLimitFreeCap429,
    error: TooManyRequestsResponseError,
    status: 429,
    assert: (error) => {
      const limited = error as TooManyRequestsResponseError
      expect(limited.error.message).toBe(freeModelCapMessage)
      expect(limited.headers.get('retry-after')).toBe('23')
    },
  },
  {
    name: '429 without free-model cap',
    fixture: rateLimit429,
    error: TooManyRequestsResponseError,
    status: 429,
    assert: (error) => {
      const message = (error as TooManyRequestsResponseError).error.message
      expect(message).toBe(providerRateLimitMessage)
      expect(message).not.toContain('free-models-per-day')
    },
  },
  {
    name: '502',
    fixture: badGateway502,
    error: BadGatewayResponseError,
    status: 502,
  },
  {
    name: '503',
    fixture: unavailable503,
    error: ServiceUnavailableResponseError,
    status: 503,
    assert: (error) => {
      expect(error.headers.get('retry-after')).toBe('8')
      expect(error.headers.get('x-provider-name')).toBe('OpenAI')
      expect(error.headers.get('request-id')).toBe('req_503')
    },
  },
  {
    name: '504',
    fixture: gatewayTimeout504,
    error: OpenRouterDefaultError,
    status: 504,
    assert: (error) => {
      expect(error.body).toContain('Gateway timeout')
    },
  },
  {
    name: '524',
    fixture: edgeTimeout524,
    error: EdgeNetworkTimeoutResponseError,
    status: 524,
  },
  {
    name: '529',
    fixture: overloaded529,
    error: ProviderOverloadedResponseError,
    status: 529,
  },
  {
    name: '400 context_length_exceeded',
    fixture: contextLength400,
    error: BadRequestResponseError,
    status: 400,
    assert: (error) => {
      expect(
        (error as BadRequestResponseError).error.metadata?.error_type,
      ).toBe('context_length_exceeded')
    },
  },
  {
    name: '400 max_tokens_exceeded',
    fixture: maxTokens400,
    error: BadRequestResponseError,
    status: 400,
    assert: (error) => {
      expect(
        (error as BadRequestResponseError).error.metadata?.error_type,
      ).toBe('max_tokens_exceeded')
    },
  },
  {
    name: '400 token_limit_exceeded',
    fixture: tokenLimit400,
    error: BadRequestResponseError,
    status: 400,
  },
  {
    name: '400 unknown model',
    fixture: unknownModel400,
    error: BadRequestResponseError,
    status: 400,
    assert: (error) => {
      expect((error as BadRequestResponseError).error.message).toContain(
        'no-such/model',
      )
    },
  },
  {
    name: '400 rejected parameter',
    fixture: rejected400,
    error: BadRequestResponseError,
    status: 400,
  },
  {
    name: '404 unknown model',
    fixture: unknownModel404,
    error: NotFoundResponseError,
    status: 404,
  },
  {
    name: '413',
    fixture: payload413,
    error: PayloadTooLargeResponseError,
    status: 413,
  },
  {
    name: '418 unknown code',
    fixture: unknown418,
    error: OpenRouterDefaultError,
    status: 418,
  },
]

test('HTTP error fixtures parse through chat.send', async () => {
  for (const entry of httpCases) {
    resetOpenRouterMock()
    mockChatStream(entry.fixture)
    const error = await send().then(
      () => {
        throw new Error(`Expected ${entry.name} to fail`)
      },
      (caught: unknown) => caught,
    )
    expect(error, entry.name).toBeInstanceOf(entry.error)
    const http = error as OpenRouterError
    expect(http.statusCode, entry.name).toBe(entry.status)
    entry.assert?.(http)
  }
})

test('mid-stream 402 parses and drops limit_source', async () => {
  const chunks = await readChat(midStreamPaymentScript)
  const failed = chunks.find((chunk) => chunk.error)
  expect(textOf(chunks)).toContain('Partial')
  expect(failed?.error?.code).toBe(402)
  expect(failed?.error?.message).toBe('Insufficient credits')
  expect(failed?.error?.metadata?.errorType).toBe('payment_required')
  expect(failed?.error?.metadata).not.toHaveProperty('limit_source')
  expect(failed?.choices[0]?.finishReason).toBe('error')
})

test('an error-only 200 yields the error chunk', async () => {
  const chunks = await readChat(errorOnlyScript)
  expect(chunks).toHaveLength(1)
  expect(chunks[0]?.error?.code).toBe(503)
  expect(chunks[0]?.choices[0]?.finishReason).toBe('error')
  expect(textOf(chunks)).toBe('')
})

test('empty length with reasoning tokens parses', async () => {
  const chunks = await readChat(emptyReasoningLengthScript)
  expect(textOf(chunks)).toBe('')
  expect(
    chunks.some(
      (chunk) => chunk.choices[0]?.delta.reasoning === 'planning the answer',
    ),
  ).toBe(true)
  expect(chunks.at(-1)?.choices[0]?.finishReason).toBe('length')
  expect(chunks.at(-1)?.usage?.completionTokensDetails?.reasoningTokens).toBe(
    3900,
  )
})

test('empty stop parses as an empty reply', async () => {
  const chunks = await readChat(emptyStopScript)
  expect(textOf(chunks)).toBe('')
  expect(chunks.at(-1)?.choices[0]?.finishReason).toBe('stop')
  expect(chunks.at(-1)?.usage?.completionTokensDetails?.reasoningTokens).toBe(0)
})

test('length with content parses', async () => {
  const chunks = await readChat(lengthWithContentScript)
  expect(textOf(chunks)).toBe('truncated')
  expect(chunks.at(-1)?.choices[0]?.finishReason).toBe('length')
})

test('content_filter and refusal parse', async () => {
  const filtered = await readChat(contentFilterScript)
  expect(filtered.at(-1)?.choices[0]?.finishReason).toBe('content_filter')
  const refused = await readChat(refusalScript)
  expect(refused.at(-1)?.choices[0]?.delta.refusal).toBe(
    "I can't help with that request.",
  )
  expect(refused.at(-1)?.choices[0]?.finishReason).toBe('content_filter')
})

test('encrypted-only reasoning parses without text', async () => {
  const chunks = await readChat(encryptedReasoningScript)
  const detail = chunks
    .flatMap((chunk) => chunk.choices[0]?.delta.reasoningDetails ?? [])
    .find((entry) => entry.type === 'reasoning.encrypted')
  expect(detail && 'data' in detail ? detail.data : undefined).toBe(
    'ciphertext-fixture',
  )
  expect(chunks.some((chunk) => chunk.choices[0]?.delta.reasoning)).toBe(false)
  expect(textOf(chunks)).toBe('')
})

test('citations and provider are stripped while the chunk parses', async () => {
  const chunks = await readChat(citationsScript)
  const last = chunks.at(-1)
  expect(textOf(chunks)).toBe('See sources')
  expect(last).not.toHaveProperty('citations')
  expect(last).not.toHaveProperty('provider')
  expect(last?.choices[0]?.delta).not.toHaveProperty('annotations')
})

test('BYOK usage and free usage with cost 0 parse', async () => {
  const byok = await readChat(byokUsageScript)
  expect(byok.at(-1)?.usage?.isByok).toBe(true)
  expect(byok.at(-1)?.usage?.cost).toBe(0.000021)
  const free = await readChat(freeUsageScript)
  expect(free.at(-1)?.usage?.cost).toBe(0)
  expect(free.at(-1)?.usage?.isByok).toBe(false)
  expect(free.at(-1)?.model).toBe(freeModelId)
})

test('a 20k-character slow stream parses', async () => {
  const chunks = await readChat(slowStreamScript)
  expect(textOf(chunks)).toBe(slowStreamText)
  expect(slowStreamText).toHaveLength(20_000)
  expect(chunks.at(-1)?.choices[0]?.finishReason).toBe('stop')
  expect(chunks.at(-1)?.usage?.cost).toBe(0)
})

test('models.list parses free twin, vision, long context, empty params, and efforts', async () => {
  mockModels(catalogModels)
  const page = await client.models.list()
  const models = page.result.data
  const free = models.find((model) => model.id === freeModelId)
  const paid = models.find((model) => model.id === paidTwinModelId)
  expect(free?.id.endsWith(':free')).toBe(true)
  expect(paid?.id).toBe(freeModelId.slice(0, -':free'.length))
  expect(free?.pricing.prompt).toBe('0')
  expect(paid?.pricing.prompt).not.toBe('0')
  expect(
    models
      .find((model) => model.id === visionModelId)
      ?.architecture.inputModalities.includes('image'),
  ).toBe(true)
  expect(
    models.find((model) => model.id === longContextModelId)?.contextLength ?? 0,
  ).toBeGreaterThanOrEqual(200_000)
  expect(
    models.find((model) => model.id === noParamsModelId)?.supportedParameters,
  ).toEqual([])
  expect(
    models.find((model) => model.id === reasoningEffortsModelId)?.reasoning
      ?.supportedEfforts,
  ).toEqual([...reasoningEfforts])
  expect(models.some((model) => model.id === curatedMiniModelId)).toBe(true)
})

test('POST /auth/keys parses the exchange and an expired code', async () => {
  mockAuthExchange(exchangedKey)
  const exchanged = await client.oAuth.exchangeAuthCodeForAPIKey({
    requestBody: {
      code: 'auth-code',
      codeVerifier: 'verifier-fixture',
      codeChallengeMethod: 'S256',
    },
  })
  expect(exchanged.key).toBe('sk-or-v1-exchanged')
  expect(exchanged.userId).toBe('user_fixture')
  const exchange = requestsTo('/auth/keys')
  expect(exchange).toHaveLength(1)
  expect(exchange[0]?.method).toBe('POST')
  expect(exchange[0]?.body).toMatchObject({
    code: 'auth-code',
    code_verifier: 'verifier-fixture',
    code_challenge_method: 'S256',
  })

  mockAuthExchange(expiredAuthCode)
  const expired = await client.oAuth
    .exchangeAuthCodeForAPIKey({
      requestBody: { code: 'stale', codeVerifier: 'verifier-fixture' },
    })
    .then(
      () => {
        throw new Error('Expected an expired code')
      },
      (caught: unknown) => caught,
    )
  expect(expired).toBeInstanceOf(ForbiddenResponseError)
  expect((expired as ForbiddenResponseError).statusCode).toBe(403)
  expect((expired as ForbiddenResponseError).error.message).toBe(
    'Authorization code expired',
  )
})

test('GET /providers parses the provider list', async () => {
  mockProviders(providerList)
  const page = await client.providers.list()
  expect(page.data.map((provider) => provider.slug)).toEqual([
    'openai',
    'anthropic',
    'google',
  ])
  expect(page.data[0]?.name).toBe('OpenAI')
  expect(page.data[2]?.privacyPolicyUrl).toBeNull()
  expect(requestsTo('/providers')[0]?.method).toBe('GET')
})

test('mockRouteDelay waits before the SDK call resolves', async () => {
  mockModels(catalogModels)
  mockRouteDelay('/models', 40)
  const started = Date.now()
  const page = await client.models.list()
  expect(Date.now() - started).toBeGreaterThanOrEqual(30)
  expect(page.result.data).toHaveLength(catalogModels.length)
})

const openHeldStore = (name: string, storeName: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const open = (version?: number) => {
      const request =
        version === undefined
          ? indexedDB.open(name)
          : indexedDB.open(name, version)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName)
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        if (db.objectStoreNames.contains(storeName)) {
          resolve(db)
          return
        }
        const nextVersion = db.version + 1
        db.close()
        open(nextVersion)
      }
    }
    open()
  })

const putRecord = (
  db: IDBDatabase,
  storeName: string,
  key: string,
  value: string,
) =>
  new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })

const readRecord = (name: string, storeName: string, key: string) =>
  new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve(undefined)
        return
      }
      const get = db
        .transaction(storeName, 'readonly')
        .objectStore(storeName)
        .get(key)
      get.onsuccess = () => {
        const value = get.result
        db.close()
        resolve(value)
      }
      get.onerror = () => {
        db.close()
        reject(get.error)
      }
    }
  })

const countRecords = (name: string, storeName: string) =>
  new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return
      request.transaction?.abort()
      request.result.close()
    }
    request.onerror = () => {
      if (request.error?.name === 'AbortError') resolve(0)
      else reject(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) {
        db.close()
        resolve(0)
        return
      }
      const count = db
        .transaction(storeName, 'readonly')
        .objectStore(storeName)
        .count()
      count.onsuccess = () => {
        const total = count.result
        db.close()
        resolve(total)
      }
      count.onerror = () => {
        db.close()
        reject(count.error)
      }
    }
  })

const databaseIsListed = async (name: string) =>
  (await indexedDB.databases()).some((info) => info.name === name)

const waitForRecords = async (name: string, storeName: string) => {
  const started = Date.now()
  while (Date.now() - started < 1_000) {
    if ((await countRecords(name, storeName)) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${name}/${storeName}`)
}

let persistSerial = 0

test('resetBrowserState clears web storage and indexed records', async () => {
  localStorage.setItem('atelier.keep', 'yes')
  sessionStorage.setItem('atelier.tab', 'tab-1')
  const held = await openHeldStore('atelier', 'notes')
  await putRecord(held, 'notes', 'keep', 'yes')
  held.close()
  await resetBrowserState()
  expect(localStorage.getItem('atelier.keep')).toBeNull()
  expect(sessionStorage.getItem('atelier.tab')).toBeNull()
  expect(await databaseIsListed('atelier')).toBe(true)
  expect(await countRecords('atelier', 'notes')).toBe(0)
})

const chatUrl = 'https://openrouter.ai/api/v1/chat/completions'

const postRaw = (model = 'openai/gpt-4o-mini') =>
  fetch(chatUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    }),
  })

test('reset clears live idb and withIndexedDb stores in under 500ms', async () => {
  const held = await openHeldStore('atelier', 'notes')
  await putRecord(held, 'notes', 'keep', 'yes')
  persistSerial += 1
  const persistKey = `testing.reset.${persistSerial}`
  const catalog = atom(['cached'], persistKey).extend(withIndexedDb(persistKey))
  catalog.subscribe()
  catalog.set(['held'])
  await waitForRecords('reatom_default', 'atoms')
  try {
    const started = performance.now()
    await resetBrowserState()
    expect(performance.now() - started).toBeLessThan(500)
    expect(await readRecord('atelier', 'notes', 'keep')).toBeUndefined()
    expect(await countRecords('reatom_default', 'atoms')).toBe(0)
  } finally {
    held.close()
  }
})

test('a write after reset survives closing the connection', async () => {
  const held = await openHeldStore('atelier', 'notes')
  try {
    await resetBrowserState()
    await putRecord(held, 'notes', 'after', 'survives')
  } finally {
    held.close()
  }
  expect(await readRecord('atelier', 'notes', 'after')).toBe('survives')
})

test('reset does not create a database that does not exist', async () => {
  const absentName = 'testing.reset.missing'
  registerDbNameForReset(absentName)
  expect(await databaseIsListed(absentName)).toBe(false)
  await resetBrowserState()
  expect(await databaseIsListed(absentName)).toBe(false)
})

test('reset twenty times with open connections does not hang', async () => {
  const atelier = await openHeldStore('atelier', 'notes')
  const catalog = await openHeldStore('atelier.catalog', 'notes')
  try {
    const started = performance.now()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await resetBrowserState()
    }
    expect(performance.now() - started).toBeLessThan(2_000)
  } finally {
    atelier.close()
    catalog.close()
  }
})

test('a stale delayed request does not consume the next queue', async () => {
  mockRouteDelay('/chat/completions', 40)
  mockChatStreams([plainTextScript])
  const stale = postRaw()
  await new Promise((resolve) => setTimeout(resolve, 10))
  resetOpenRouterMock()
  await expect(stale).rejects.toMatchObject({ name: 'AbortError' })
  mockChatStreams([lengthScript])
  const response = await postRaw()
  const text = await response.text()
  expect(text).toContain('truncated')
  expect(chatBodies()).toHaveLength(1)
})

test('queued scripts win over a sticky per-model script', async () => {
  mockChatStreamFor('openai/gpt-4o-mini', reasoningScript)
  mockChatStreams([plainTextScript])
  const queued = await collect()
  const sticky = await collect()
  expect(textOf(queued)).toBe('Hello')
  expect(textOf(sticky)).toBe('Hi')
})

test('non-OpenRouter fetches are recorded and blocked, same-origin passes', async () => {
  const blocked = await fetch('https://example.com/secret').then(
    () => {
      throw new Error('Expected the external fetch to be blocked')
    },
    (caught: unknown) => caught,
  )
  expect(blocked).toBeInstanceOf(TypeError)
  expect((blocked as TypeError).message).toBe('blocked by test mock')
  expect(externalRequests()[0]?.url).toBe('https://example.com/secret')
  allowExternalPassthrough((url) => url.hostname === 'cdn.example')
  const allowed = await fetch('https://cdn.example/asset.js').then(
    () => {
      throw new Error('Expected the opted-in host to reach the network')
    },
    (caught: unknown) => caught,
  )
  expect(allowed).toBeInstanceOf(TypeError)
  expect((allowed as TypeError).message.toLowerCase()).toContain(
    'failed to fetch',
  )
  const page = await fetch(`${location.origin}/`)
  expect(page).toBeInstanceOf(Response)
})

test('buffered SSE ends with a blank line after [DONE]', async () => {
  mockChatStream(plainTextScript)
  const response = await postRaw()
  const text = await response.text()
  expect(text.endsWith('data: [DONE]\n\n')).toBe(true)
})

test('streams send X-Generation-Id from a per-script chunk id', async () => {
  mockChatStream(plainTextScript)
  const response = await postRaw()
  const id = plainTextScript[0]?.data.id
  expect(id).toMatch(/^gen-/)
  expect(id).not.toBe(reasoningScript[0]?.data.id)
  expect(response.headers.get('x-generation-id')).toBe(id)
})

test('comment gap and firstTokenDelayMs wait after headers', async () => {
  mockChatStream([{ comment: true, delayMs: 40 }, ...plainTextScript])
  const commentStarted = Date.now()
  const commentResult = await send()
  expect(Date.now() - commentStarted).toBeLessThan(30)
  expect(textOf(await collectFrom(commentResult))).toBe('Hello')
  expect(Date.now() - commentStarted).toBeGreaterThanOrEqual(30)

  mockChatStream({ firstTokenDelayMs: 40, chunks: plainTextScript })
  const delayStarted = Date.now()
  const delayed = await send()
  expect(Date.now() - delayStarted).toBeLessThan(30)
  expect(textOf(await collectFrom(delayed))).toBe('Hello')
  expect(Date.now() - delayStarted).toBeGreaterThanOrEqual(30)
})

test('raw SSE keeps citations, annotations, provider, and limit_source', async () => {
  mockChatStream(citationsScript)
  const citations = await (await postRaw()).text()
  expect(citations).toContain('"citations"')
  expect(citations).toContain('"annotations"')
  expect(citations).toContain('"provider":"Perplexity"')
  expect(citations).toContain('https://example.com/a')
  expect(citations).toContain('Missing url')

  mockChatStream(midStreamPaymentScript)
  const payment = await (await postRaw()).text()
  expect(payment).toContain('"limit_source":"openrouter_credits"')
})
