import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { button, createActor, role, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'

import { ui } from '../app/ui'
import { refreshKeyMeta } from '../auth'
import { formatUsd } from '../money/format'
import { repo } from '../storage/repo'
import type { AssistantMessage } from '../storage/types'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))
const rajKey = 'sk-or-v1-rajlimit74'

const nowAt = Date.parse('2026-10-05T12:00:00.000Z')
const octoberFifthAfternoon = Date.parse('2026-10-05T16:00:00.000Z')
const octoberFifthNight = Date.parse('2026-10-05T03:30:00.000Z')
const septemberSixth = Date.parse('2026-09-06T12:00:00.000Z')
const septemberFourth = Date.parse('2026-09-04T16:00:00.000Z')
const octoberThird = Date.parse('2026-10-03T15:00:00.000Z')

const gptCost = 1.25
const claudeCost = 0.000412
const includedEdgeCost = 0.5
const excludedEdgeCost = 2
const estimateOnlyCost = 0.0042

const gptModel = 'openai/gpt-4o-mini'
const claudeModel = 'anthropic/claude-sonnet-4'
const geminiModel = 'google/gemini-2.5-flash'
const draftModel = 'custom/draft'

const originalNow = Date.now
const originalResolved = Intl.DateTimeFormat.prototype.resolvedOptions
const originalScan = repo.scanMessages.bind(repo)

let clock: number | null = nowAt
let timeZone = 'America/New_York'
let locale = 'en-US'
let fetchImpl: typeof fetch | null = null

const keyboard = userEvent.setup() as unknown as UserEvent

const shoot = async (name: string) => {
  document.querySelector('[data-slot="LocalSpend"]')?.scrollIntoView({
    block: 'center',
    inline: 'nearest',
  })
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-03b', name)
}

const settings = () => role('dialog', 'Settings')

const localUsage = () => role('region', 'Local usage').within(settings())

const installClock = () => {
  Date.now = () => clock ?? originalNow()
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(
    this: Intl.DateTimeFormat,
  ) {
    return { ...originalResolved.call(this), timeZone, locale }
  }
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    get: () => locale,
  })
  document.documentElement.lang = locale
}

const spendCell = (tableLabel: string, rowKey: string) => {
  const table = document.querySelector(`[aria-label="${tableLabel}"]`)
  if (!table) return ''
  const row = [...table.querySelectorAll('tr')].find((candidate) => {
    if (candidate.getAttribute('data-spend-key') === rowKey) return true
    return candidate.querySelector('th')?.textContent?.trim() === rowKey
  })
  return row?.querySelector('td')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}

const dayTableText = () =>
  document.querySelector('[aria-label="Spend by day"]')?.textContent ?? ''

const openAccount = async () => {
  ui.appSettings.set('appearance')
  await I.see(text('Theme').within(settings()).options({ timeout: 10_000 }).wait())
  ui.appSettings.set('account')
  await I.see(localUsage().options({ timeout: 10_000 }).wait())
}

const patchAssistant = async (
  chatId: string,
  messageId: string,
  patch: Partial<AssistantMessage>,
) => {
  const stored = (await repo.listMessages(chatId)).find(
    (message) => message.id === messageId,
  )
  if (!stored || stored.role !== 'assistant') {
    throw new Error(`missing assistant ${messageId}`)
  }
  await repo.putMessage({ ...stored, ...patch, rev: stored.rev + 1 })
}

test('Raj reads local spend by day and by model', async () => {
  installClock()
  await bootApp({
    key: rajKey,
    keyMeta: limitedKey,
    viewport: desktop,
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  ui.appSettings.set('account')
  await I.see(settings().options({ timeout: 10_000 }).wait())
  await I.see(text('$74.50').within(settings()))
  await I.see(
    text('No spend recorded in this browser yet').within(settings()).wait(),
  )
  await settle()
  await shoot('empty')

  await seedChats([
    {
      id: 'spend-chat',
      title: 'Spend notes',
      model: gptModel,
      messages: [
        {
          id: 'u-gpt',
          role: 'user',
          content: 'Afternoon',
          createdAt: octoberFifthAfternoon,
        },
        {
          id: 'a-gpt',
          role: 'assistant',
          content: 'Afternoon reply',
          model: gptModel,
          createdAt: octoberFifthAfternoon,
          parentId: 'u-gpt',
        },
        {
          id: 'u-claude',
          role: 'user',
          content: 'Night',
          createdAt: octoberFifthNight,
        },
        {
          id: 'a-claude',
          role: 'assistant',
          content: 'Night reply',
          model: claudeModel,
          createdAt: octoberFifthNight,
          parentId: 'u-claude',
        },
        {
          id: 'u-edge',
          role: 'user',
          content: 'Within the window',
          createdAt: septemberSixth,
        },
        {
          id: 'a-edge',
          role: 'assistant',
          content: 'Still in the window',
          model: gptModel,
          createdAt: septemberSixth,
          parentId: 'u-edge',
        },
        {
          id: 'u-old',
          role: 'user',
          content: 'Outside the window',
          createdAt: septemberFourth,
        },
        {
          id: 'a-old',
          role: 'assistant',
          content: 'Older than 30 days',
          model: geminiModel,
          createdAt: septemberFourth,
          parentId: 'u-old',
        },
      ],
    },
  ])
  await patchAssistant('spend-chat', 'a-gpt', {
    usage: {
      promptTokens: 20,
      completionTokens: 30,
      reasoningTokens: 0,
      cost: gptCost,
      isByok: false,
      source: 'usage',
    },
  })
  await patchAssistant('spend-chat', 'a-claude', {
    usage: {
      promptTokens: 4,
      completionTokens: 2,
      reasoningTokens: 0,
      cost: claudeCost,
      isByok: false,
      source: 'usage',
    },
  })
  await patchAssistant('spend-chat', 'a-edge', {
    usage: {
      promptTokens: 8,
      completionTokens: 8,
      reasoningTokens: 0,
      cost: includedEdgeCost,
      isByok: false,
      source: 'usage',
    },
  })
  await patchAssistant('spend-chat', 'a-old', {
    usage: {
      promptTokens: 12,
      completionTokens: 12,
      reasoningTokens: 0,
      cost: excludedEdgeCost,
      isByok: false,
      source: 'usage',
    },
  })

  const daySum = gptCost + claudeCost + includedEdgeCost
  const modelSum = daySum + excludedEdgeCost

  await openAccount()
  await expect
    .poll(() => spendCell('Spend by day', 'Total'))
    .toBe(formatUsd(daySum))
  await expect
    .poll(() => spendCell('Spend by model', 'Total'))
    .toBe(formatUsd(modelSum))
  expect(spendCell('Spend by day', 'Oct 5, 2026')).toBe(formatUsd(gptCost))
  expect(spendCell('Spend by day', 'Oct 4, 2026')).toBe(formatUsd(claudeCost))
  expect(spendCell('Spend by day', 'Sep 6, 2026')).toBe(formatUsd(includedEdgeCost))
  expect(dayTableText()).not.toContain('Sep 4')
  expect(spendCell('Spend by model', gptModel)).toBe(
    formatUsd(gptCost + includedEdgeCost),
  )
  expect(spendCell('Spend by model', claudeModel)).toBe(formatUsd(claudeCost))
  expect(spendCell('Spend by model', geminiModel)).toBe(formatUsd(excludedEdgeCost))
  expect(spendCell('Spend by day', 'Oct 4, 2026')).not.toContain('est.')
  expect(spendCell('Spend by day', 'Total')).not.toContain('est.')
  await settle()
  await shoot('populated')

  timeZone = 'Asia/Tokyo'
  await openAccount()
  await expect.poll(() => spendCell('Spend by day', 'Oct 6, 2026')).toBe(formatUsd(gptCost))
  expect(spendCell('Spend by day', 'Oct 5, 2026')).toBe(formatUsd(claudeCost))
  expect(spendCell('Spend by day', 'Sep 6, 2026')).toBe(formatUsd(includedEdgeCost))
  expect(spendCell('Spend by day', 'Total')).toBe(formatUsd(daySum))
  expect(dayTableText()).not.toContain('Oct 4, 2026')

  timeZone = 'America/New_York'
  locale = 'ru-RU'
  document.documentElement.lang = 'ru-RU'
  await openAccount()
  await expect.poll(() => spendCell('Spend by day', 'Oct 4, 2026')).toBe(formatUsd(claudeCost))
  expect(dayTableText()).toContain('Sep 6, 2026')
  expect(dayTableText()).not.toMatch(/сентябр/i)

  locale = 'en-US'
  document.documentElement.lang = 'en'
  await seedChats([
    {
      id: 'spend-estimate',
      title: 'Stopped draft',
      model: draftModel,
      messages: [
        {
          id: 'u-est',
          role: 'user',
          content: 'Stop here',
          createdAt: octoberThird,
        },
        {
          id: 'a-est',
          role: 'assistant',
          content: 'Partial',
          model: draftModel,
          createdAt: octoberThird,
          parentId: 'u-est',
          status: 'stopped',
        },
      ],
    },
  ])
  await patchAssistant('spend-estimate', 'a-est', { estimateCost: estimateOnlyCost })

  const estimatedDaySum = daySum + estimateOnlyCost
  const estimatedModelSum = modelSum + estimateOnlyCost
  await openAccount()
  await expect
    .poll(() => spendCell('Spend by day', 'Oct 3, 2026'))
    .toBe(`${formatUsd(estimateOnlyCost)} est.`)
  expect(spendCell('Spend by day', 'Oct 4, 2026')).toBe(formatUsd(claudeCost))
  expect(spendCell('Spend by day', 'Total')).toBe(`${formatUsd(estimatedDaySum)} est.`)
  expect(spendCell('Spend by model', draftModel)).toBe(
    `${formatUsd(estimateOnlyCost)} est.`,
  )
  expect(spendCell('Spend by model', geminiModel)).toBe(formatUsd(excludedEdgeCost))
  expect(spendCell('Spend by model', 'Total')).toBe(
    `${formatUsd(estimatedModelSum)} est.`,
  )
  await settle()
  await shoot('estimates')

  fetchImpl = globalThis.fetch
  let rejected = 0
  globalThis.fetch = async () => {
    rejected += 1
    throw new TypeError('Failed to fetch')
  }
  refreshKeyMeta({ force: true })
  await openAccount()
  await expect
    .poll(() => spendCell('Spend by day', 'Total'))
    .toBe(`${formatUsd(estimatedDaySum)} est.`)
  expect(spendCell('Spend by model', 'Total')).toBe(
    `${formatUsd(estimatedModelSum)} est.`,
  )
  expect(rejected).toBeGreaterThan(0)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  globalThis.fetch = fetchImpl
  fetchImpl = null

  repo.scanMessages = async () => {
    throw new Error('IndexedDB unavailable')
  }
  await openAccount()
  await I.see(text("Couldn't read local usage.").within(localUsage()).wait())
  await I.see(button('Retry').within(localUsage()))
  repo.scanMessages = originalScan
  await I.click(button('Retry').within(localUsage()))
  await expect
    .poll(() => spendCell('Spend by day', 'Total'))
    .toBe(`${formatUsd(estimatedDaySum)} est.`)
})

test.afterEach(async () => {
  repo.scanMessages = originalScan
  if (fetchImpl) globalThis.fetch = fetchImpl
  fetchImpl = null
  Date.now = originalNow
  Intl.DateTimeFormat.prototype.resolvedOptions = originalResolved
  document.documentElement.lang = 'en'
  ui.appSettings.set(null)
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})
