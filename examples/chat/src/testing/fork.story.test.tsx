import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { formatUsd } from '../money/format'
import { repo } from '../storage/repo'
import type { AssistantMessage } from '../storage/types'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { chatBodies, mockChatStream } from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-fork-story'
const modelId = 'openai/gpt-4o-mini'
const modelLabel = 'OpenAI: GPT-4o-mini'
const question = 'How do lenses bend light?'
const cutOffText = 'A lens bends light'
const hiddenSibling = 'Aperture only.'
const freshTry = 'A separate try.'
const laterQuestion = 'And the mount?'
const laterReply = 'It holds the glass.'
const continuedTail = ' until it focuses.'
const continuedText = `${cutOffText}${continuedTail}`
const cutOffNotice = 'Reply cut off at the length limit.'
const failedNotice = 'The provider disconnected mid-reply (502).'
const firstCost = 0.00004
const continueCost = 0.00002

const keyboard = userEvent.setup() as unknown as UserEvent

const settle = () => new Promise((resolve) => setTimeout(resolve, 240))

type WireBody = {
  messages?: Array<{ role?: string; content?: unknown }>
}

const bodies = () => chatBodies() as WireBody[]

const expectFreshTurn = (body: WireBody | undefined) => {
  const messages = body?.messages ?? []
  expect(messages.at(-1)).toEqual({ role: 'user', content: question })
  expect(messages.some((message) => message.role === 'assistant')).toBe(false)
  expect(JSON.stringify(messages)).not.toContain(cutOffText)
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

const sendDraft = async (value: string) => {
  setDraft(value)
  await keyboard.keyboard('{Enter}')
}

const thread = () => document.querySelector<HTMLElement>('[data-slot="Thread"]')

const headerTitle = () =>
  document.querySelector('[data-slot="ChatHeader"] h1')?.textContent ?? ''

const assistantRows = () => [
  ...document.querySelectorAll<HTMLElement>('[data-role="assistant"]'),
]

const namedButton = (root: ParentNode | null | undefined, name: string) =>
  [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (element) =>
      (element.getAttribute('aria-label') ?? element.textContent ?? '').trim() ===
      name,
  )

const versionText = (root: ParentNode | null | undefined) =>
  root?.querySelector('[data-version]')?.textContent ?? ''

const usage = (cost: number) => ({
  prompt_tokens: 10,
  completion_tokens: 4,
  total_tokens: 14,
  cost,
  is_byok: false,
  completion_tokens_details: { reasoning_tokens: 0 },
})

const frame = (
  id: string,
  content: string,
  finish: 'stop' | 'length' | 'error' | null,
  extra: Record<string, unknown> = {},
) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: modelId,
  choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
  ...extra,
})

const script = (id: string, content: string, finish: 'stop' | 'length', cost: number) => ({
  chunks: [
    { data: frame(id, content, null) },
    { data: frame(id, '', finish, { usage: usage(cost) }) },
  ],
})

const continueScript = {
  firstTokenDelayMs: 400,
  chunks: [
    { data: frame('gen-continue', ' until', null) },
    { delayMs: 2_800, data: frame('gen-continue', ' it focuses.', null) },
    {
      data: frame('gen-continue', '', 'stop', { usage: usage(continueCost) }),
    },
  ],
}

const failScript = {
  chunks: [
    {
      data: {
        ...frame('gen-fail', '', 'error'),
        error: {
          code: 502,
          message: 'Provider disconnected',
          metadata: { error_type: 'server' },
        },
      },
    },
  ],
}

const storedAssistants = async (chatId: string) => {
  const stored = await repo.listMessages(chatId)
  return stored.filter(
    (message): message is AssistantMessage => message.role === 'assistant',
  )
}

const fullyOnScreen = (element: Element | null | undefined) => {
  expect(element).toBeTruthy()
  const rect = element!.getBoundingClientRect()
  expect(rect.height).toBeGreaterThan(0)
  expect(rect.width).toBeGreaterThan(0)
  expect(rect.top).toBeGreaterThanOrEqual(-1)
  expect(rect.left).toBeGreaterThanOrEqual(-1)
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1)
}

const shoot = async (name: string, anchor?: Element | null) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  anchor?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  await settle()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-26', name)
}

const openSidebarChat = async (title: string) => {
  const row = [...document.querySelectorAll('[data-slot="Sidebar"] li')].find(
    (item) => item.getAttribute('aria-label') === title,
  )
  row?.querySelector('button')?.click()
  await expect.poll(() => headerTitle()).toBe(title)
}

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya forks the visible path and continues a cut-off reply', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 30 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)

  mockChatStream(script('gen-cutoff', cutOffText, 'length', firstCost))
  await sendDraft(question)
  await expect.poll(() => assistantRows()[0]?.textContent ?? '').toContain(cutOffNotice)
  const originalId = location.pathname.split('/').pop() ?? ''
  const originalTitle = headerTitle()
  expect(originalTitle).toBe(question)
  const cutOffRow = () => assistantRows()[0]
  expect(cutOffRow()?.querySelector('[data-error-title]')?.textContent).toBe(cutOffNotice)
  expect(cutOffRow()?.querySelector('[data-notice="true"]')).toBeTruthy()
  const cutOffId = () =>
    [...activeChat().messages().values()].find(
      (message) => message.role === 'assistant' && message.content === cutOffText,
    )?.id

  mockChatStream(script('gen-sibling', hiddenSibling, 'stop', 0.00001))
  await expect.poll(() => namedButton(cutOffRow(), 'Regenerate')?.disabled).toBe(false)
  await settle()
  const beforeRegenerate = bodies().length
  namedButton(cutOffRow(), 'Regenerate')?.click()
  await expect.poll(() => bodies().length).toBe(beforeRegenerate + 1)
  expectFreshTurn(bodies().at(-1))
  await expect
    .poll(() => cutOffRow()?.textContent ?? '', { timeout: 8_000 })
    .toContain(hiddenSibling)
  await expect.poll(() => versionText(cutOffRow())).toBe('2/2')
  await expect.poll(() => namedButton(cutOffRow(), 'Regenerate')?.disabled).toBe(false)
  await settle()
  namedButton(cutOffRow(), 'Previous version')?.click()
  await expect.poll(() => cutOffRow()?.textContent ?? '').toContain(cutOffText)
  expect(thread()?.textContent ?? '').not.toContain(hiddenSibling)
  expect(versionText(cutOffRow())).toBe('1/2')

  const partialId = cutOffId()
  expect(partialId).toBeTruthy()
  mockChatStream(script('gen-retry', freshTry, 'stop', 0.00001))
  await expect.poll(() => namedButton(cutOffRow(), 'Retry')?.disabled ?? true).toBe(false)
  await settle()
  const beforeRetry = bodies().length
  namedButton(cutOffRow(), 'Retry')?.click()
  await expect.poll(() => bodies().length).toBe(beforeRetry + 1)
  expectFreshTurn(bodies().at(-1))
  await expect
    .poll(() => cutOffRow()?.textContent ?? '', { timeout: 8_000 })
    .toContain(freshTry)
  expect(cutOffRow()?.textContent ?? '').not.toContain(cutOffText)
  expect(cutOffRow()?.getAttribute('data-message-id')).not.toBe(partialId)
  const retried = [...activeChat().messages().values()].find(
    (message) => message.role === 'assistant' && message.content === freshTry,
  )
  expect(retried?.id).toBeTruthy()
  expect(retried?.id).not.toBe(partialId)
  expect(versionText(cutOffRow())).toBe('3/3')
  namedButton(cutOffRow(), 'Previous version')?.click()
  await expect.poll(() => cutOffRow()?.textContent ?? '').toContain(hiddenSibling)
  namedButton(cutOffRow(), 'Previous version')?.click()
  await expect.poll(() => cutOffRow()?.textContent ?? '').toContain(cutOffText)
  expect(versionText(cutOffRow())).toBe('1/3')
  expect(thread()?.textContent ?? '').not.toContain(freshTry)

  mockChatStream(script('gen-later', laterReply, 'stop', 0.00001))
  await sendDraft(laterQuestion)
  await expect.poll(() => thread()?.textContent ?? '').toContain(laterReply)
  expect(assistantRows()).toHaveLength(2)

  const forkTitle = `${originalTitle} (fork)`
  const forkFromCutoff = namedButton(assistantRows()[0], 'Fork to new chat')
  expect(forkFromCutoff).toBeTruthy()
  forkFromCutoff?.click()
  await expect.poll(() => headerTitle()).toBe(forkTitle)
  await expect.poll(() => location.pathname).not.toBe(`/c/${originalId}`)
  const forkId = location.pathname.split('/').pop() ?? ''
  expect(forkId).not.toBe(originalId)

  await expect.poll(() => thread()?.textContent ?? '').toContain(question)
  await expect.poll(() => thread()?.textContent ?? '').toContain(cutOffText)
  expect(assistantRows()[0]?.querySelector('[data-error-title]')?.textContent).toBe(
    cutOffNotice,
  )
  const forkedThread = thread()?.textContent ?? ''
  expect(forkedThread).not.toContain(hiddenSibling)
  expect(forkedThread).not.toContain(freshTry)
  expect(forkedThread).not.toContain(laterQuestion)
  expect(forkedThread).not.toContain(laterReply)
  expect(assistantRows()).toHaveLength(1)
  expect(versionText(assistantRows()[0])).toBe('1/1')

  const originalStored = await repo.listMessages(originalId)
  expect(originalStored.map((message) => message.content)).toEqual(
    expect.arrayContaining([question, cutOffText, hiddenSibling, laterQuestion, laterReply]),
  )
  expect(headerTitle()).toBe(forkTitle)
  const originalRecord = (await repo.listChats()).find((chat) => chat.id === originalId)
  expect(originalRecord?.title).toBe(originalTitle)

  const forkStored = await repo.listMessages(forkId)
  expect(forkStored.map((message) => message.content).sort()).toEqual(
    [cutOffText, question].sort(),
  )
  expect(forkStored.every((message) => message.chatId === forkId)).toBe(true)
  expect(new Set(forkStored.map((message) => message.id)).size).toBe(forkStored.length)
  expect(originalStored.some((message) => forkStored.some((copy) => copy.id === message.id))).toBe(
    false,
  )

  fullyOnScreen(document.querySelector('[data-slot="ChatHeader"] h1'))
  fullyOnScreen(assistantRows()[0]?.querySelector('[data-message-content]'))
  fullyOnScreen(assistantRows()[0]?.querySelector('[data-error-title]'))
  await shoot('forked', assistantRows()[0])

  const continuedId = assistantRows()[0]?.getAttribute('data-message-id')
  expect(continuedId).toBeTruthy()
  mockChatStream(continueScript)
  const beforeContinue = bodies().length
  await I.click(button('Continue'))
  await expect.poll(() => bodies().length).toBe(beforeContinue + 1)
  const continuedRequest = bodies().at(-1)
  expect(continuedRequest?.messages?.at(-1)).toEqual({
    role: 'assistant',
    content: cutOffText,
  })
  expect(JSON.stringify(continuedRequest?.messages)).not.toContain(hiddenSibling)
  expect(JSON.stringify(continuedRequest?.messages)).not.toContain(laterQuestion)
  expect(JSON.stringify(continuedRequest?.messages)).not.toContain(laterReply)

  await expect
    .poll(() => assistantRows()[0]?.textContent ?? '')
    .toContain(`${cutOffText} until`)
  expect(assistantRows()[0]?.textContent ?? '').not.toContain('it focuses.')
  expect(versionText(assistantRows()[0])).toBe('1/1')
  await I.see(text(/Continuing/))
  fullyOnScreen(assistantRows()[0]?.querySelector('[data-message-content]'))
  await shoot('continuing', assistantRows()[0])

  await expect.poll(() => assistantRows()[0]?.textContent ?? '', { timeout: 8_000 }).toContain(
    continuedText,
  )
  expect(assistantRows()[0]?.getAttribute('data-message-id')).toBe(continuedId)
  expect(versionText(assistantRows()[0])).toBe('1/1')
  expect(assistantRows()).toHaveLength(1)
  await expect.poll(() => assistantRows()[0]?.textContent ?? '').not.toContain(cutOffNotice)

  const continued = [...activeChat().messages().values()].find(
    (message) => message.id === continuedId,
  )
  expect(continued?.role).toBe('assistant')
  if (continued?.role !== 'assistant') throw new Error('missing continued reply')
  expect(continued.content).toBe(continuedText)
  expect(continued.extraUsage).toHaveLength(1)
  expect(continued.usage?.cost).toBeCloseTo(firstCost, 8)
  expect(continued.extraUsage[0]?.cost).toBeCloseTo(continueCost, 8)
  const summed = (continued.usage?.cost ?? 0) + (continued.extraUsage[0]?.cost ?? 0)
  const costLine = assistantRows()[0]?.querySelector('[data-cost-line]')?.textContent ?? ''
  expect(costLine.startsWith(formatUsd(summed))).toBe(true)
  expect(formatUsd(summed)).not.toBe(formatUsd(continued.extraUsage[0]!.cost))
  expect(formatUsd(continued.usage!.cost)).not.toBe(formatUsd(summed))
  fullyOnScreen(assistantRows()[0]?.querySelector('[data-cost-line]'))
  fullyOnScreen(assistantRows()[0]?.querySelector('[data-message-content]'))
  await shoot('continued', assistantRows()[0])

  mockChatStream(failScript)
  await openSidebarChat(originalTitle)
  await expect.poll(() => thread()?.textContent ?? '').toContain(cutOffText)
  await expect.poll(() => thread()?.textContent ?? '').toContain(laterReply)
  await expect.poll(() => thread()?.textContent ?? '').toContain(cutOffNotice)
  const failedRow = () => assistantRows()[0]
  const failedId = failedRow()?.getAttribute('data-message-id')
  expect(failedId).toBe(cutOffId())
  expect(versionText(failedRow())).toBe('1/3')
  const beforeFail = bodies().length
  await I.click(button('Continue'))
  await expect.poll(() => bodies().length).toBe(beforeFail + 1)
  expect(bodies().at(-1)?.messages?.at(-1)).toEqual({
    role: 'assistant',
    content: cutOffText,
  })
  await expect.poll(() => failedRow()?.textContent ?? '').toContain(failedNotice)
  expect(failedRow()?.textContent ?? '').toContain(cutOffText)
  expect(failedRow()?.textContent ?? '').not.toContain(continuedTail)
  expect(failedRow()?.getAttribute('data-message-id')).toBe(failedId)
  expect(versionText(failedRow())).toBe('1/3')
  const failedCard = failedRow()?.querySelector('[data-slot="ErrorCard"]')
  expect(failedCard?.getAttribute('data-kind')).toBe('provider-disconnected')
  expect(failedCard?.querySelector('[data-error-title]')?.textContent).toBe(failedNotice)
  const failedMessage = [...activeChat().messages().values()].find(
    (message) => message.id === failedId,
  )
  expect(failedMessage?.role).toBe('assistant')
  if (failedMessage?.role === 'assistant') {
    expect(failedMessage.content).toBe(cutOffText)
    expect(failedMessage.extraUsage).toEqual([])
    expect(failedMessage.usage?.cost).toBeCloseTo(firstCost, 8)
  }
  const content = failedRow()?.querySelector('[data-message-content]')
  const notice = failedRow()?.querySelector('[data-error-title]')
  content?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  fullyOnScreen(content)
  fullyOnScreen(notice)
  expect(content!.compareDocumentPosition(notice!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  await shoot('continue-failed', content)

  const originalAfter = await storedAssistants(originalId)
  expect(originalAfter.some((message) => message.content === hiddenSibling)).toBe(true)
  expect(originalAfter.some((message) => message.id === failedId && message.content === cutOffText)).toBe(
    true,
  )
  expect((await repo.getChat(originalId))?.title).toBe(originalTitle)
  expect((await repo.getChat(forkId))?.title).toBe(forkTitle)
}, 60_000)
