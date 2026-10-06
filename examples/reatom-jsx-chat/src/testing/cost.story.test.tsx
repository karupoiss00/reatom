import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { commands } from '../app/commands'
import { extraEstimateLines } from '../app/ui'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import {
  estimateTokens,
  formatContextLength,
  formatTokenCount,
  formatUsd,
} from '../money'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import {
  catalogModels as fixtureModels,
  freeModelId,
} from './fixtures/models'
import {
  installOpenRouterMock,
  mockChatStream,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-cost-story'
const modelLabel = 'OpenAI: GPT-4o-mini'
const miniId = 'openai/gpt-4o-mini'
const noWebPriceId = 'google/gemini-2.5-pro'
const contextLength = 128_000
const webSearchPrice = 0.014
const stillLife = 'Sketch a quiet still life.'
const totalExplanation = 'Total cost of replies in this chat'
const byokExplanation =
  "Billed by the provider on your own key. OpenRouter's fee is not shown per message (5% of list price after a $25k/month allowance), and the provider's bill is not in this response."
const exactMoney = '0.00¢ · 10 in · 4 out (3 reasoning)'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
  hover: (element: Element) => Promise<void>
  unhover: (element: Element) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

let extraUnmount: (() => void) | null = null

const chipLabel = () =>
  document.querySelector('[data-cost-label]')?.textContent ?? ''

const footerLine = () =>
  document.querySelector('[data-cost-line]')?.textContent ?? ''

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const expectedChip = (chars: number) => {
  const input = estimateTokens(chars)
  return `This chat: ${formatUsd(0)} · ${formatTokenCount(input)} / ${formatContextLength(contextLength)}`
}

const openPopover = (sentence: string) =>
  [...document.querySelectorAll('[popover]')].find(
    (panel) =>
      panel.matches(':popover-open') && panel.textContent?.includes(sentence),
  )

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shot('F-11', name)
}

const chunk = (
  content: string,
  finish: 'stop' | null = null,
  extra: Record<string, unknown> = {},
) => ({
  id: 'gen-cost-1',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: miniId,
  provider: 'OpenAI',
  choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  ...extra,
})

const usage = (
  cost: number,
  isByok: boolean,
  reasoningTokens = 0,
) => ({
  prompt_tokens: 10,
  completion_tokens: 4,
  total_tokens: 14,
  cost,
  is_byok: isByok,
  completion_tokens_details: { reasoning_tokens: reasoningTokens },
})

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const reloadApp = async () => {
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(fixtureModels)
  mockKey(limitedKey)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

const freshChat = async (modelId: string) => {
  if (location.pathname !== '/') commands.newChat()
  await expect.poll(() => location.pathname).toBe('/')
  activeChat().setModel(modelId)
  await expect.poll(() => activeChat().model()).toBe(modelId)
}

const sendDraft = async (value: string) => {
  setDraft(value)
  await keyboard.keyboard('{Enter}')
}

const liveAmount = (text: string) => {
  const cents = text.match(/≈\s*(-?\d+(?:\.\d+)?)¢/)
  if (cents?.[1]) return Number(cents[1]) / 100
  const dollars = text.match(/≈\s*\$(\d+(?:\.\d+)?)/)
  return dollars?.[1] ? Number(dollars[1]) : null
}

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  extraEstimateLines.set([])
  await page.viewport(desktop.width, desktop.height)
})

test('Raj sees the estimate, the live cost, and what the reply cost', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)

  const typed = 'x'.repeat(4000)
  const started = performance.now()
  setDraft(typed)
  await expect
    .poll(() => chipLabel(), { timeout: 100, interval: 5 })
    .toBe(expectedChip(typed.length))
  expect(performance.now() - started).toBeLessThan(100)
  const draftedTokens = estimateTokens(typed.length)
  const meter = document.querySelector<HTMLElement>('[data-context-ring]')
  const fill = document.querySelector('[data-context-fill]')
  expect(meter?.getAttribute('role')).toBe('meter')
  expect(meter?.getAttribute('aria-valuenow')).toBe(String(draftedTokens))
  expect(meter?.getAttribute('aria-valuemax')).toBe(String(contextLength))
  expect(fill?.getAttribute('stroke-dashoffset')).toBe(
    String(100 - Math.min(100, (draftedTokens / contextLength) * 100)),
  )

  const beforeModel = chipLabel()
  const modelStarted = performance.now()
  activeChat().setModel('anthropic/claude-sonnet-4')
  await expect
    .poll(() => chipLabel(), { timeout: 100, interval: 5 })
    .not.toBe(beforeModel)
  expect(performance.now() - modelStarted).toBeLessThan(100)
  activeChat().setModel(miniId)
  await expect.poll(() => chipLabel()).toBe(expectedChip(typed.length))

  activeChat().updateSettings({ params: { maxTokens: 1000 } })
  await expect.poll(() => chipLabel()).toBe(expectedChip(typed.length))
  activeChat().updateSettings({ params: {}, webSearch: true })
  extraEstimateLines.set([
    { key: 'pdf', label: '+ PDF parsing', amount: 0.02 },
  ])
  const contextChars = 160_000
  activeChat().updateSettings({ systemPrompt: 'x'.repeat(contextChars) })
  setDraft(stillLife)
  await expect
    .poll(() => chipLabel())
    .toBe(expectedChip(contextChars + stillLife.length))
  const lines = () =>
    [...document.querySelectorAll('[data-estimate-line]')].map(
      (line) => line.textContent ?? '',
    )
  await expect
    .poll(() => lines().join('\n'))
    .toContain(`+ web search ${formatUsd(webSearchPrice)}`)
  expect(lines().join('\n')).toContain(`+ PDF parsing ${formatUsd(0.02)}`)

  expect(openPopover(totalExplanation)).toBeUndefined()
  const aboutTotal = document.querySelector<HTMLElement>('[data-chat-total]')
  if (!aboutTotal) throw new Error('missing chat total')
  await keyboard.hover(aboutTotal)
  await expect.poll(() => openPopover(totalExplanation)).toBeTruthy()
  expect(document.activeElement).not.toBe(openPopover(totalExplanation))
  document
    .querySelector('[data-slot="CostChip"]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await shoot('estimate')
  await keyboard.unhover(aboutTotal)
  await expect.poll(() => openPopover(totalExplanation)).toBeUndefined()

  activeChat().updateSettings({ webSearch: false })
  extraEstimateLines.set([])
  await expect.poll(() => lines().length).toBe(0)
  activeChat().setModel(noWebPriceId)
  activeChat().updateSettings({ webSearch: true })
  extraEstimateLines.set([
    { key: 'pdf', label: '+ PDF parsing', amount: 0.02 },
  ])
  await expect
    .poll(() => lines())
    .toEqual([`+ PDF parsing ${formatUsd(0.02)}`])
  expect(lines().join('\n')).not.toContain('Web search may add cost')
  expect(
    document.querySelector('[data-cost-notes], [data-web-search-notice]')
      ?.textContent ?? '',
  ).not.toContain('Web search may add cost')
  expect(
    document.querySelector('[data-slot="WebSearchToggle"] [role="tooltip"]')
      ?.textContent ?? '',
  ).toContain('Web search may add cost')
  expect(lines().join('\n')).not.toContain(
    `+ web search ${formatUsd(webSearchPrice)}`,
  )

  activeChat().setModel(miniId)
  activeChat().updateSettings({ webSearch: false, systemPrompt: '', params: {} })
  extraEstimateLines.set([])
  setDraft('')
  await expect.poll(() => lines().length).toBe(0)

  const reply = 'Soft light on the bowl. The cloth is warm and still today.'
  mockChatStream({
    chunks: [
      { data: chunk(reply.slice(0, 20)) },
      { delayMs: 120, data: chunk(reply.slice(20, 40)) },
      { delayMs: 120, data: chunk(reply.slice(40)) },
      {
        delayMs: 2200,
        data: chunk('', 'stop', { usage: usage(0.000012, false, 3) }),
      },
    ],
  })
  await sendDraft('What did this cost?')
  const liveSamples: number[] = []
  await expect.poll(() => footerLine()).toContain('≈')
  await expect
    .poll(
      () => {
        const amount = liveAmount(footerLine())
        if (amount !== null && liveSamples.at(-1) !== amount) {
          liveSamples.push(amount)
        }
        return amount
      },
      { timeout: 4_000, interval: 20 },
    )
    .not.toBeNull()
  for (let index = 1; index < liveSamples.length; index += 1) {
    expect(liveSamples[index]).toBeGreaterThanOrEqual(liveSamples[index - 1]!)
  }
  expect(document.querySelector('[data-slot="CostFooter"]')).toBeTruthy()
  expect(footerLine()).toContain('≈')
  document
    .querySelector('[data-slot="CostFooter"]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await shoot('live')
  expect(footerLine()).toContain('≈')
  await expect
    .poll(() => footerLine(), { timeout: 8_000 })
    .toMatch(
      /0\.00¢ · 10 in · 4 out \(3 reasoning\) · \d+(?:\.\d)?s to first token · \d+(?:\.\d)?s · via OpenAI/,
    )
  expect(footerLine()).toContain(exactMoney)
  expect(footerLine()).not.toContain('≈')
  const exactLine = footerLine()
  document
    .querySelector('[data-cost-line]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await shoot('exact')
  expect(
    document.querySelector('[data-slot="ChatHeader"]')?.textContent ?? '',
  ).not.toContain('This chat:')
  expect(chipLabel()).toContain(`This chat: ${formatUsd(0.000012)}`)
  expect(chipLabel()).not.toContain('≈')

  await expect.poll(() => location.pathname).toMatch(/^\/c\//)
  const chatId = location.pathname.split('/').pop() ?? ''
  await expect.poll(async () => {
    const stored = await repo.listMessages(chatId)
    return stored.some(
      (message) =>
        message.role === 'assistant' &&
        message.usage?.cost === 0.000012 &&
        message.usage.promptTokens === 10 &&
        message.usage.completionTokens === 4 &&
        message.usage.reasoningTokens === 3 &&
        message.provider === 'OpenAI' &&
        message.timing.firstTokenAt !== null &&
        message.timing.endAt !== null,
    )
  }).toBe(true)
  await reloadApp()
  openChat(chatId)
  await expect.poll(() => footerLine(), { timeout: 8_000 }).toBe(exactLine)

  await freshChat(miniId)
  mockChatStream([
    { data: chunk('Billed through your key.') },
    {
      data: chunk('', 'stop', { usage: usage(0.000012, true, 3) }),
    },
  ])
  await sendDraft('Was this on my key?')
  await expect
    .poll(() => footerLine(), { timeout: 8_000 })
    .toMatch(
      /0\.00¢ · 10 in · 4 out \(3 reasoning\) · \d+(?:\.\d)?s to first token · \d+(?:\.\d)?s · via OpenAI/,
    )
  expect(footerLine()).toContain(exactMoney)
  expect(document.querySelector('[data-byok]')?.textContent).toBe('BYOK')
  expect(footerLine()).not.toMatch(/provider's bill/i)
  expect(footerLine()).toContain(formatUsd(0.000012))
  await I.click(button('About BYOK'))
  await expect.poll(() => openPopover(byokExplanation)).toBeTruthy()
  document
    .querySelector('[data-byok]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await shoot('byok')
  await keyboard.keyboard('{Escape}')

  await freshChat(freeModelId)
  mockChatStream([
    {
      data: {
        ...chunk('A free reply.'),
        model: freeModelId,
        provider: 'Meta',
      },
    },
    {
      data: {
        ...chunk('', 'stop', { usage: usage(0, false) }),
        model: freeModelId,
        provider: 'Meta',
      },
    },
  ])
  await sendDraft('Say it for free')
  await expect
    .poll(() => footerLine(), { timeout: 8_000 })
    .toMatch(/^Free · \d+ in · \d+ out · \d+(?:\.\d)?s to first token/)
  expect(footerLine()).not.toContain('≈')
  expect(footerLine()).not.toContain('$0.00')
  document
    .querySelector('[data-cost-line]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await shoot('free')

  await freshChat(miniId)
  mockChatStream([
    { data: chunk('The stream ended early.') },
    { data: chunk('', 'stop') },
  ])
  await sendDraft('Stop before the bill')
  await expect
    .poll(() => footerLine(), { timeout: 8_000 })
    .toMatch(/^≈ .+ estimate$/)
  await I.see(text('Exact cost unavailable'))
  const assistant = [...activeChat().messages().values()].find(
    (message) => message.role === 'assistant',
  )
  expect(assistant?.role === 'assistant' ? assistant.usage : 'missing').toBeNull()
  document
    .querySelector('[data-slot="CostFooter"]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await shoot('estimate-only')

  await freshChat(miniId)
  activeChat().updateSettings({
    systemPrompt: 'x'.repeat(839_800),
  })
  setDraft('Hello')
  await expect
    .poll(() => chipLabel())
    .toBe('Too long for this model (210k / 128k)')
  expect(document.querySelector('[data-slot="CostChip"]')?.getAttribute('data-tone')).toBe(
    'warning',
  )
  expect(sendButton()?.disabled).toBe(false)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Send')
  await I.see(text('Switch to a longer-context model'))
  await I.see(text('Google: Gemini 2.5 Pro · 1M'))
  await I.see(text('New chat with the last 4 messages'))
  document
    .querySelector('[data-context-actions]')
    ?.scrollIntoView({ block: 'end', inline: 'nearest' })
  await shoot('over-context')

  await freshChat(freeModelId)
  mockChatStream([
    {
      data: {
        ...chunk('An unpriced reply.'),
        model: freeModelId,
        provider: 'Meta',
      },
    },
    {
      data: {
        ...chunk('', 'stop', { usage: usage(Number.NaN, false) }),
        model: freeModelId,
        provider: 'Meta',
      },
    },
  ])
  await sendDraft('What if the cost is not a number?')
  await expect
    .poll(() => footerLine(), { timeout: 8_000 })
    .toContain('\u2014')
  expect(footerLine()).not.toContain('$0.00')
  expect(footerLine()).not.toContain('Free')
}, 90_000)
