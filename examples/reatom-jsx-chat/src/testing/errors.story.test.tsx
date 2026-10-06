import { createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { ui } from '../app/ui'
import { oauthOutcome, keyMeta } from '../auth'
import { readPendingOAuth } from '../auth/pkce'
import { activeChat, newChat } from '../chat'
import { catalogById } from '../catalog'
import { resetExternalNavigator, setExternalNavigator } from '../platform/external'
import { activeChatId, openChat } from '../routes'
import { createDefaultChatSettings } from '../storage/records'
import { library } from '../chat/library'
import type { AttachmentRef } from '../storage/types'
import { addCreditsUrl, keyPageUrl } from '../features/keychip/model'
import { contrastRatio, resolvedBackground } from '../ui'
import { bootApp, unmountApp } from './boot'
import {
  forbidden403,
  moderation403,
  payload413,
  paymentCredits402,
  paymentInFlight402,
  paymentKeyLimit402,
  paymentRequired402,
  rateLimit429,
  rateLimitFreeCap429,
  timeout408,
  unauthorized401,
  unavailable503,
  unknown418,
} from './fixtures/errors'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels, freeModelId } from './fixtures/models'
import {
  emptyReasoningLengthScript,
  emptyStopScript,
  lengthWithContentScript,
  midStreamErrorScript,
  midStreamPaymentScript,
  refusalScript,
} from './fixtures/sse'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockGeneration,
  mockKey,
  mockModels,
  resetOpenRouterMock,
  type MockChatScript,
} from './openrouter-mock'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 900 }
const storyKey = 'sk-or-v1-errors-story'
const storyKeyMeta = { ...limitedKey, limit: 10, limit_reset: 'monthly' }

const keyboard = userEvent.setup() as unknown as UserEvent

const settle = () => new Promise((resolve) => setTimeout(resolve, 350))

let online = true

const installOnline = () => {
  online = true
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
}

const setOnline = (next: boolean) => {
  online = next
  window.dispatchEvent(new Event(next ? 'online' : 'offline'))
}

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="Composer"] [data-send]')

const latestCard = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="ErrorCard"]')].at(-1)

const retryButton = () =>
  latestCard()?.querySelector<HTMLButtonElement>('[data-action="retry"]') ?? null

const dailyCapSentence =
  'Free models are also capped per day (50/day under 10 credits purchased, 1,000/day otherwise).'

const iconByKind: Record<string, { icon: string; name: string }> = {
  'auth-rejected': { icon: 'key', name: 'Key rejected' },
  'out-of-credits': { icon: 'warning', name: 'Payment required' },
  'key-limit': { icon: 'warning', name: 'Payment required' },
  'in-flight-budget': { icon: 'warning', name: 'Payment required' },
  'payment-required': { icon: 'warning', name: 'Payment required' },
  moderation: { icon: 'danger', name: 'Request blocked' },
  'refused-403': { icon: 'danger', name: 'Request blocked' },
  timeout: { icon: 'warning', name: 'Timed out' },
  'rate-limited': { icon: 'warning', name: 'Rate limited' },
  unavailable: { icon: 'warning', name: 'Model unavailable' },
  'context-too-long': { icon: 'warning', name: 'Conversation too long' },
  'unknown-model': { icon: 'warning', name: 'Unknown model' },
  'bad-request': { icon: 'warning', name: 'Request rejected' },
  'param-rejected': { icon: 'warning', name: 'Request rejected' },
  'too-large': { icon: 'warning', name: 'Request rejected' },
  unknown: { icon: 'danger', name: 'Something went wrong' },
  'provider-disconnected': { icon: 'warning', name: 'Model unavailable' },
  'connection-lost': { icon: 'offline', name: 'Connection lost' },
  'empty-reasoning': { icon: 'info', name: 'Incomplete reply' },
  'empty-reply': { icon: 'info', name: 'Incomplete reply' },
  'cut-off': { icon: 'info', name: 'Incomplete reply' },
  refusal: { icon: 'danger', name: 'Request blocked' },
}

const expectShotIcon = () => {
  const card = latestCard()
  expect(card).toBeTruthy()
  const kind = card?.getAttribute('data-kind') ?? ''
  const expected = iconByKind[kind]
  expect(expected, `icon for ${kind}`).toBeTruthy()
  const icon = card?.querySelector<HTMLElement>('[data-icon]')
  expect(icon?.getAttribute('data-icon')).toBe(expected?.icon)
  expect(icon?.getAttribute('aria-label')).toBe(expected?.name)
}

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const card = latestCard()
  card?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  expectShotIcon()
  await shot(flowId, name)
}

const detailValue = (label: string) => {
  const rows = [
    ...(latestCard()?.querySelectorAll<HTMLElement>('[data-error-details] div') ?? []),
  ]
  const row = rows.find((node) => node.querySelector('dt')?.textContent === label)
  return row?.querySelector('dd')?.textContent ?? ''
}

const openDetails = async (expected: {
  code: string
  message: string
  requestId?: string
}) => {
  const card = latestCard()
  expect(card?.querySelector('[data-action="details"]')).toBeTruthy()
  if (!card?.querySelector('[data-error-details]')) {
    card?.querySelector<HTMLButtonElement>('[data-action="details"]')?.click()
  }
  await expect
    .poll(() => latestCard()?.querySelector('[data-error-details]')?.textContent ?? '')
    .toContain(expected.message)
  expect(detailValue('Code')).toBe(expected.code)
  expect(detailValue('Message')).toBe(expected.message)
  if (expected.requestId !== undefined) {
    expect(detailValue('Request id')).toBe(expected.requestId)
  }
}

const lastUserId = () =>
  activeChat()
    .path()
    .map((node) => node.message)
    .filter((message) => message.role === 'user')
    .at(-1)?.id

const expectEditTargetsUser = () => {
  const userId = lastUserId()
  expect(userId).toBeTruthy()
  const edit = latestCard()?.querySelector<HTMLButtonElement>(
    '[data-action="edit-message"]',
  )
  expect(edit).toBeTruthy()
  edit?.click()
  expect(ui.editing()).toBe(userId)
}

const expectRetryHoldsThenSends = async () => {
  const retry = retryButton()
  expect(retry).toBeTruthy()
  expect(retry?.disabled).toBe(false)
  expect(chatBodies()).toHaveLength(1)
  retry?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
}

const expectChrome = (notice: boolean) => {
  const card = latestCard()
  expect(card).toBeTruthy()
  const title = card?.querySelector<HTMLElement>('[data-error-title]')
  expect(title?.textContent?.trim().length ?? 0).toBeGreaterThan(0)
  const ratio = contrastRatio(
    getComputedStyle(title!).color,
    resolvedBackground(title!),
  )
  expect(ratio).toBeGreaterThanOrEqual(4.5)
  const iconName = card?.querySelector('[role="img"]')?.getAttribute('aria-label')
  expect(iconName?.length ?? 0).toBeGreaterThan(0)
  expect(card?.getAttribute('data-notice')).toBe(notice ? 'true' : 'false')
  if (!notice) expect(card?.textContent).toContain('Details')
}

const arm = async (script: MockChatScript) => {
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(fixtureModels)
  mockKey(storyKeyMeta)
  mockGeneration(generationRecord)
  mockChatStream(script)
  await keyMeta.retry()
  await expect.poll(() => keyMeta.data()?.limit ?? null).toBe(10)
}

const beginChat = async () => {
  ui.picker.set(null)
  ui.editing.set(null)
  if (oauthOutcome().status !== 'idle') oauthOutcome.set({ status: 'idle' })
  if (activeChatId() !== 'new') {
    newChat()
    await expect.poll(() => activeChatId()).toBe('new')
  }
  activeChat().setModel('openai/gpt-4o-mini')
}

const sendText = async (value: string) => {
  setDraft(value)
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(1)
}

const showFailure = async (
  script: MockChatScript,
  snippet: string,
  prepare?: () => void,
) => {
  await beginChat()
  prepare?.()
  await arm(script)
  await sendText('Hello from the error story')
  expect(chatBodies()).toHaveLength(1)
  await expect
    .poll(() => latestCard()?.textContent ?? '', { timeout: 5000 })
    .toContain(snippet)
  await settle()
  expect(chatBodies()).toHaveLength(1)
  return latestCard()!
}

const http = (
  status: number,
  message: string,
  metadata?: Record<string, unknown>,
  headers?: Record<string, string>,
) => ({
  status,
  headers,
  body: {
    error: {
      code: status,
      message,
      ...(metadata ? { metadata } : {}),
    },
  },
})

const streamChunk = (
  delta: Record<string, unknown>,
  finish: string | null,
  extra: Record<string, unknown> = {},
) => ({
  data: {
    id: 'gen-error-story',
    object: 'chat.completion.chunk',
    created: 1710000000,
    model: 'openai/gpt-4o-mini',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...extra,
  },
})

const modelOf = (body: unknown) =>
  body && typeof body === 'object' && 'model' in body
    ? (body as { model?: unknown }).model
    : undefined

const effortOf = (body: unknown) => {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  const reasoning = record.reasoning
  if (reasoning && typeof reasoning === 'object' && 'effort' in reasoning) {
    return (reasoning as { effort?: unknown }).effort
  }
  return record.reasoning_effort
}

const maxTokensOf = (body: unknown) => {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  return record.maxTokens ?? record.max_tokens
}

const bootStory = async () => {
  resetLocation()
  installOnline()
  setExternalNavigator(() => {})
  await bootApp({
    key: storyKey,
    keyMeta: storyKeyMeta,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => activeChat().model()).toBeTruthy()
  await expect.poll(() => keyMeta.data()?.limit ?? null).toBe(10)
}

afterEach(async () => {
  resetExternalNavigator()
  setOnline(true)
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Tom sees auth and payment cards and nothing retries on its own', async () => {
  await bootStory()

  await showFailure(unauthorized401, 'Your OpenRouter key was rejected.')
  expectChrome(false)
  await I.see(text('Reconnect'))
  const chatId = activeChatId()
  const navigated: string[] = []
  setExternalNavigator((url) => {
    navigated.push(url)
  })
  await shoot('F-17', 'reconnect-required')
  await openDetails({ code: '401', message: 'User not found.' })
  document.querySelector<HTMLButtonElement>('[data-action="reconnect"]')?.click()
  await expect.poll(() => readPendingOAuth()?.returnTo ?? null).toBe(`/c/${chatId}`)
  expect(navigated.length).toBeGreaterThan(0)
  expect(chatBodies()).toHaveLength(1)

  await showFailure(paymentCredits402, "You're out of OpenRouter credits.")
  expectChrome(false)
  const credits = latestCard()?.querySelector<HTMLAnchorElement>(
    '[data-action="add-credits"]',
  )
  expect(credits?.getAttribute('href')).toBe('https://openrouter.ai/credits')
  expect(latestCard()?.textContent).not.toMatch(/Retry in \d/)
  await shoot('F-17', 'out-of-credits')
  await openDetails({ code: '402', message: 'Insufficient credits' })
  expect(chatBodies()).toHaveLength(1)

  await showFailure(paymentRequired402, 'Payment required by OpenRouter.')
  const addCredits = latestCard()?.querySelector<HTMLAnchorElement>(
    '[data-action="add-credits"]',
  )
  const raiseLimit = latestCard()?.querySelector<HTMLAnchorElement>(
    '[data-action="raise-limit"]',
  )
  expect(addCredits?.textContent?.trim()).toBe('Add credits')
  expect(raiseLimit?.textContent?.trim()).toBe('Raise limit on OpenRouter')
  expect(addCredits?.getAttribute('href')).toBe(addCreditsUrl)
  expect(raiseLimit?.getAttribute('href')).toBe(keyPageUrl())
  await openDetails({ code: '402', message: 'Payment required' })
  expect(chatBodies()).toHaveLength(1)

  await showFailure(
    paymentKeyLimit402,
    'This key reached its spending limit ($10.00, resets monthly).',
  )
  const limit = latestCard()?.querySelector<HTMLAnchorElement>(
    '[data-action="raise-limit"]',
  )
  expect(limit?.getAttribute('href') ?? '').toContain('https://openrouter.ai/keys')
  await shoot('F-17', 'key-limit')
  await openDetails({ code: '402', message: 'Key limit exceeded' })
  expect(chatBodies()).toHaveLength(1)

  await showFailure(
    paymentInFlight402,
    'Too many requests in flight for your budget. Retry in 12s.',
  )
  expect(retryButton()?.disabled).toBe(true)
  await shoot('F-17', 'in-flight-countdown')
  await settle()
  expect(retryButton()?.disabled).toBe(true)
  expect(chatBodies()).toHaveLength(1)
  await openDetails({
    code: '402',
    message: 'Too many requests in flight for your budget',
    requestId: 'req_402_inflight',
  })

  await showFailure(
    moderation403,
    "The request was blocked by Anthropic's moderation: violence.",
  )
  expect(latestCard()?.textContent).toContain(
    'a flagged excerpt under one hundred characters',
  )
  expect(latestCard()?.textContent).not.toContain('Retry')
  await shoot('F-17', 'moderation')
  await openDetails({ code: '403', message: 'Request blocked by moderation' })
  expectEditTargetsUser()
  expect(chatBodies()).toHaveLength(1)

  await showFailure(forbidden403, 'OpenRouter refused this request (403).')
  expectChrome(false)
  expect(latestCard()?.querySelector('[data-error-details]')).toBeNull()
  await openDetails({ code: '403', message: 'OpenRouter refused this request' })
  await shoot('F-17', 'refused')
  expect(chatBodies()).toHaveLength(1)

  await showFailure(
    [
      streamChunk({ content: 'Kept this' }, null),
      streamChunk({ content: '' }, 'error', {
        error: { code: 401, message: 'User not found.' },
      }),
    ],
    'Your OpenRouter key was rejected.',
  )
  expect(latestCard()?.closest('[data-slot="AssistantMessage"]')?.textContent).toContain(
    'Kept this',
  )
  await shoot('F-17', 'card-under-partial-text')
  expect(chatBodies()).toHaveLength(1)
}, 90_000)

test('Lena waits out rate limits and availability without an automatic retry', async () => {
  await bootStory()

  await showFailure(timeout408, 'The model took too long to respond.')
  expectChrome(false)
  expect(retryButton()?.disabled).toBe(false)
  await shoot('F-17b', 'timeout')
  await openDetails({ code: '408', message: 'Request timed out' })
  await expectRetryHoldsThenSends()

  await showFailure(
    rateLimitFreeCap429,
    'Rate limited. Retry in 23s',
    () => {
      activeChat().setModel(freeModelId)
    },
  )
  expect(latestCard()?.textContent).toContain(
    'Free models are also capped per day (50/day under 10 credits purchased, 1,000/day otherwise).',
  )
  expect(retryButton()?.disabled).toBe(true)
  expect(latestCard()?.textContent).toContain('Use paid version')
  await shoot('F-17b', 'rate-limited')
  await settle()
  expect(chatBodies()).toHaveLength(1)
  expect(retryButton()?.disabled).toBe(true)
  document.querySelector<HTMLButtonElement>('[data-action="use-paid"]')?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
  expect(modelOf(chatBodies().at(-1))).toBe('meta-llama/llama-3.3-8b-instruct')

  await showFailure(
    {
      ...rateLimit429,
      headers: { ...rateLimit429.headers, 'Retry-After': '1' },
    },
    'Rate limited. Retry in 1s',
  )
  expect(retryButton()?.disabled).toBe(true)
  expect(chatBodies()).toHaveLength(1)
  await expect
    .poll(() => retryButton()?.disabled ?? true, { timeout: 4000 })
    .toBe(false)
  expect(latestCard()?.textContent ?? '').not.toMatch(/Retry in [1-9]/)
  expect(latestCard()?.textContent ?? '').not.toContain(dailyCapSentence)
  await shoot('F-17b', 'countdown-done')
  expect(chatBodies()).toHaveLength(1)
  await openDetails({
    code: '429',
    message: 'Provider returned error',
    requestId: 'req_429',
  })
  expect(latestCard()?.textContent ?? '').not.toContain(dailyCapSentence)

  await showFailure(
    unavailable503,
    'is unavailable right now.',
    () => {
      activeChat().setModel('anthropic/claude-sonnet-4')
      activeChat().updateSettings({
        privacyOverride: { denyDataCollection: false, zdr: false },
        routing: { mode: 'auto', allowFallbacks: true },
      })
    },
  )
  expect(latestCard()?.textContent).toContain('Try OpenAI: GPT-4o-mini')
  expect(latestCard()?.textContent).not.toContain(
    'Your privacy or routing settings may exclude all providers.',
  )
  await shoot('F-17b', 'unavailable-with-fallback')
  await openDetails({
    code: '503',
    message: 'No endpoints available matching your request',
    requestId: 'req_503',
  })
  expect(chatBodies()).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('[data-action="try-fallback"]')?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
  expect(modelOf(chatBodies().at(-1))).toBe('openai/gpt-4o-mini')

  await showFailure(unavailable503, 'is unavailable right now.', () => {
    activeChat().setModel('anthropic/claude-sonnet-4')
  })
  expect(latestCard()?.textContent).toContain(
    'Your privacy or routing settings may exclude all providers.',
  )
  expect(latestCard()?.textContent).toContain('Loosen privacy for this chat')
  await shoot('F-17b', 'excluded-by-settings')
  expect(retryButton()).toBeTruthy()
  expect(retryButton()?.disabled).toBe(true)
  expect(chatBodies()).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('[data-action="loosen-privacy"]')?.click()
  await expect.poll(() => activeChat().settings().privacyOverride).toEqual({
    denyDataCollection: false,
    zdr: false,
  })
  expect(retryButton()?.disabled).toBe(false)
  expect(chatBodies()).toHaveLength(1)

  await showFailure(unavailable503, 'Loosen routing', () => {
    activeChat().setModel('anthropic/claude-sonnet-4')
    activeChat().updateSettings({
      privacyOverride: { denyDataCollection: false, zdr: false },
      routing: { mode: 'only', providers: ['anthropic'], allowFallbacks: false },
    })
  })
  expect(chatBodies()).toHaveLength(1)
  expect(retryButton()?.disabled).toBe(true)
  document.querySelector<HTMLButtonElement>('[data-action="loosen-routing"]')?.click()
  await expect.poll(() => activeChat().settings().routing).toEqual({
    mode: 'auto',
    allowFallbacks: true,
  })
  expect(retryButton()?.disabled).toBe(true)
  expect(chatBodies()).toHaveLength(1)

  await showFailure(
    {
      ...unavailable503,
      headers: { ...unavailable503.headers, 'Retry-After': '1' },
    },
    'is unavailable right now.',
  )
  expect(retryButton()).toBeTruthy()
  expect(retryButton()?.disabled).toBe(true)
  expect(chatBodies()).toHaveLength(1)
  await expect
    .poll(() => retryButton()?.disabled ?? true, { timeout: 4000 })
    .toBe(false)
  expect(chatBodies()).toHaveLength(1)
}, 90_000)

test('Maya gets a card that says what to change, and nothing retries on its own', async () => {
  await bootStory()

  await showFailure(
    http(400, 'This endpoint maximum context length is 128000 tokens.', {
      error_type: 'context_length_exceeded',
    }),
    'This conversation is too long for',
  )
  expect(latestCard()?.textContent).toMatch(/\(≈.+ of .+ tokens\)\./)
  expect(latestCard()?.textContent).toContain('Switch to a longer-context model')
  expect(latestCard()?.textContent).toContain('New chat with the last 4 messages')
  expect(latestCard()?.textContent).toContain('Google: Gemini 2.5 Flash')
  expectChrome(false)
  await shoot('F-17c', 'too-long')
  await openDetails({
    code: '400',
    message: 'This endpoint maximum context length is 128000 tokens.',
  })
  expect(chatBodies()).toHaveLength(1)
  document
    .querySelector<HTMLButtonElement>('[data-model="google/gemini-2.5-flash"]')
    ?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
  expect(modelOf(chatBodies().at(-1))).toBe('google/gemini-2.5-flash')

  await showFailure(
    http(400, 'The model `no-such/model` does not exist'),
    "OpenRouter doesn't know model `no-such/model`.",
    () => {
      activeChat().setModel('no-such/model')
    },
  )
  await shoot('F-17c', 'unknown-model')
  await openDetails({
    code: '400',
    message: 'The model `no-such/model` does not exist',
  })
  expect(chatBodies()).toHaveLength(1)
  document.querySelector<HTMLButtonElement>('[data-action="pick-model"]')?.click()
  expect(ui.picker()).toEqual({ purpose: 'chat' })
  expect(chatBodies()).toHaveLength(1)
  ui.picker.set(null)

  await showFailure(
    http(400, 'The image payload could not be read'),
    'OpenRouter rejected the request: The image payload could not be read.',
  )
  await shoot('F-17c', 'rejected')
  await openDetails({
    code: '400',
    message: 'The image payload could not be read',
  })
  expectEditTargetsUser()
  expect(chatBodies()).toHaveLength(1)

  await showFailure(payload413, 'This request is too large.')
  expect(latestCard()?.textContent).toContain('Edit message')
  expect(retryButton()).toBeNull()
  await shoot('F-17c', 'too-large')
  await openDetails({ code: '413', message: 'Request entity too large' })
  expectEditTargetsUser()
  expect(chatBodies()).toHaveLength(1)

  await showFailure(unknown418, 'Something went wrong (code 418).')
  expect(latestCard()?.textContent).not.toBe('Provider returned error')
  expect(latestCard()?.textContent).toContain('Details')
  await shoot('F-17c', 'unknown')
  await openDetails({ code: '418', message: 'Unknown teapot' })
  await expectRetryHoldsThenSends()

  await showFailure(
    http(400, 'temperature must be between 0 and 2'),
    'rejected parameter temperature.',
    () => {
      activeChat().updateSettings({ params: { temperature: 1.5 } })
    },
  )
  expect(latestCard()?.textContent).toContain('Reset parameters and retry')
  await openDetails({
    code: '400',
    message: 'temperature must be between 0 and 2',
  })
  expect(chatBodies()).toHaveLength(1)
  document
    .querySelector<HTMLButtonElement>('[data-action="reset-params-retry"]')
    ?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
  expect(activeChat().settings().params).toEqual({})
  expect(chatBodies().at(-1)).not.toMatchObject({ temperature: expect.anything() })

  await showFailure(
    http(400, 'context length exceeded', { error_type: 'context_length_exceeded' }),
    'No larger-context model available',
    () => {
      activeChat().setModel('google/gemini-2.5-pro')
    },
  )
  const larger = latestCard()?.querySelector<HTMLButtonElement>(
    '[data-action="switch-longer-context"]',
  )
  expect(larger?.disabled).toBe(true)
  expect(chatBodies()).toHaveLength(1)

  const clip: AttachmentRef = {
    id: 'att-clip',
    kind: 'image',
    name: 'clip.png',
    mime: 'image/png',
    size: 1200,
  }
  const [seedId] = await seedChats([
    {
      id: 'tail-source',
      title: 'Tail source',
      model: 'openai/gpt-4o-mini',
      settings: {
        ...createDefaultChatSettings(),
        systemPrompt: 'Be brief.',
      },
      messages: [
        { role: 'user', content: 'alpha' },
        { role: 'assistant', content: 'reply alpha' },
        { role: 'user', content: 'beta' },
        { role: 'assistant', content: 'reply beta' },
        { role: 'user', content: 'gamma', attachments: [clip] },
        { role: 'assistant', content: 'reply gamma' },
      ],
    },
  ])
  await library.reload()
  openChat(seedId!)
  await expect.poll(() => activeChat().path().length).toBe(6)
  await arm(
    http(400, 'context length exceeded', { error_type: 'context_length_exceeded' }),
  )
  await sendText('delta')
  await expect
    .poll(() => latestCard()?.textContent ?? '', { timeout: 5000 })
    .toContain('New chat with the last 4 messages')
  expect(chatBodies()).toHaveLength(1)
  const sourceTail = activeChat().path().map((node) => node.message)
  const failedTurn = sourceTail.at(-1)
  expect(failedTurn?.role).toBe('assistant')
  expect(failedTurn?.content).toBe('')
  expect(failedTurn?.role === 'assistant' ? failedTurn.error : null).not.toBeNull()
  const sourceId = activeChatId()
  document.querySelector<HTMLButtonElement>('[data-action="new-chat-last-4"]')?.click()
  await expect.poll(() => activeChatId() !== sourceId && activeChatId() !== 'new').toBe(
    true,
  )
  await expect.poll(() => activeChat().path().length).toBeGreaterThan(0)
  const copied = activeChat().path().map((node) => node.message)
  expect(copied.map((message) => [message.role, message.content])).toEqual([
    ['user', 'gamma'],
    ['assistant', 'reply gamma'],
    ['user', 'delta'],
  ])
  expect(copied.some((message) => message.content.length === 0)).toBe(false)
  expect(activeChat().settings().systemPrompt).toBe('Be brief.')
  expect(
    copied.some(
      (message) =>
        message.role === 'user' &&
        message.attachments.some((item) => item.id === 'att-clip'),
    ),
  ).toBe(true)
  expect(chatBodies()).toHaveLength(1)
  expect(catalogById().size).toBeGreaterThan(0)
}, 90_000)

test('Lena keeps partial text and sees an inline notice, never an automatic retry', async () => {
  await bootStory()

  await showFailure(midStreamErrorScript, 'The provider disconnected mid-reply (502).')
  expect(latestCard()?.getAttribute('data-notice')).toBe('false')
  expect(latestCard()?.closest('[data-slot="AssistantMessage"]')?.textContent).toContain(
    'Partial',
  )
  expectChrome(false)
  await shoot('F-18', 'partial-card')
  await openDetails({ code: '502', message: 'Provider disconnected' })
  await expectRetryHoldsThenSends()

  await showFailure(midStreamPaymentScript, "You're out of OpenRouter credits.")
  expect(latestCard()?.textContent).not.toContain('Connection lost')
  expect(latestCard()?.closest('[data-slot="AssistantMessage"]')?.textContent).toContain(
    'Partial',
  )
  await shoot('F-18', 'quota-mid-stream')
  await openDetails({ code: '402', message: 'Insufficient credits' })
  expect(chatBodies()).toHaveLength(1)

  await showFailure(
    emptyReasoningLengthScript,
    'used its whole token budget on thinking (3,900 reasoning tokens) and wrote no answer.',
    () => {
      activeChat().setModel('openai/o3-mini')
      activeChat().updateSettings({
        params: { reasoningEffort: 'high', maxTokens: 800 },
      })
    },
  )
  expect(latestCard()?.getAttribute('data-notice')).toBe('true')
  expect(latestCard()?.textContent).toContain('Retry with lower effort')
  expect(latestCard()?.textContent).not.toContain('Retry with higher max tokens')
  expectChrome(true)
  await shoot('F-18', 'empty-reasoning')
  expect(chatBodies()).toHaveLength(1)
  document
    .querySelector<HTMLButtonElement>('[data-action="retry-lower-effort"]')
    ?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
  expect(effortOf(chatBodies().at(-1))).toBe('medium')

  await showFailure(
    emptyReasoningLengthScript,
    'Retry with higher max tokens',
    () => {
      activeChat().setModel('meta-llama/llama-3.3-8b-instruct')
      activeChat().updateSettings({ params: { maxTokens: 64 } })
    },
  )
  expect(chatBodies()).toHaveLength(1)
  document
    .querySelector<HTMLButtonElement>('[data-action="retry-higher-max-tokens"]')
    ?.click()
  await expect.poll(() => chatBodies().length, { timeout: 5000 }).toBe(2)
  expect(Number(maxTokensOf(chatBodies().at(-1)))).toBeGreaterThan(64)

  await showFailure(emptyStopScript, 'The model returned an empty reply.')
  expect(latestCard()?.getAttribute('data-notice')).toBe('true')
  expect(retryButton()).toBeTruthy()
  await shoot('F-18', 'empty-reply')
  expect(chatBodies()).toHaveLength(1)

  await showFailure(lengthWithContentScript, 'Reply cut off at the length limit.')
  expect(latestCard()?.getAttribute('data-notice')).toBe('true')
  expect(latestCard()?.closest('[data-slot="AssistantMessage"]')?.textContent).toContain(
    'truncated',
  )
  await shoot('F-18', 'cut-off')
  await expectRetryHoldsThenSends()

  await showFailure(refusalScript, 'Refused by')
  expect(latestCard()?.textContent).toContain("I can't help with that request.")
  expect(latestCard()?.getAttribute('data-notice')).toBe('true')
  await shoot('F-18', 'refused')
  expectEditTargetsUser()
  expect(chatBodies()).toHaveLength(1)

  await beginChat()
  await arm({ networkError: true })
  await sendText('Hello from the error story')
  expect(chatBodies()).toHaveLength(1)
  await expect
    .poll(() => retryButton()?.textContent ?? '', { timeout: 5000 })
    .toContain('Retry')
  await settle()
  expect(chatBodies()).toHaveLength(1)
  const lostBubble = latestCard()?.closest('[data-slot="AssistantMessage"]')
  const lostPhrase = 'Connection lost'
  expect(latestCard()?.querySelector('[data-error-title]')).toBeNull()
  expect(latestCard()?.querySelector('[data-error-sentence]')).toBeNull()
  expect((lostBubble?.textContent ?? '').split(lostPhrase).length - 1).toBe(1)
  expect(latestCard()?.getAttribute('data-notice')).toBe('true')
  expect(retryButton()?.disabled).toBe(false)
  await shoot('F-18', 'connection-lost')
  expect(chatBodies()).toHaveLength(1)
  setOnline(false)
  await expect.poll(() => retryButton()?.disabled ?? false).toBe(true)
  setOnline(true)
  await expect.poll(() => retryButton()?.disabled ?? true).toBe(false)
  expect(chatBodies()).toHaveLength(1)
}, 90_000)
