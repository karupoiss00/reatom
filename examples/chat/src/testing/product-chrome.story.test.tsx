import { button, createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { catalogById } from '../catalog'
import { activeChat } from '../chat'
import { formatUsd } from '../money'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels, curatedMiniModelId, longContextModelId } from './fixtures/models'
import { chatBodies, mockChatStreamFor } from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-product-chrome'
const claudeId = 'anthropic/claude-sonnet-4'
const undatedId = 'vendor/undated'
const release = 'Jul 2024'

const keyboard = userEvent.setup() as unknown as UserEvent

const undatedModel = {
  ...catalogModels.find((model) => model.id === curatedMiniModelId)!,
  id: undatedId,
  canonical_slug: undatedId,
  name: 'Vendor: Undated',
  created: 0,
}

const storyModels = [...catalogModels, undatedModel]

const chipLabel = () =>
  document.querySelector('[data-cost-label]')?.textContent ?? ''

const emptyChatTotal = `This chat: ${formatUsd(0)}`

const showQuote = async (modelId: string, outputTokens: number) => {
  activeChat().draft.text.set('')
  activeChat().setModel(modelId)
  await expect.poll(() => activeChat().model()).toBe(modelId)
  activeChat().updateSettings({ params: { maxTokens: outputTokens } })
  await expect.poll(() => activeChat().settings().params.maxTokens).toBe(outputTokens)
  await expect.poll(() => chipLabel()).toContain(emptyChatTotal)
  expect(chipLabel()).not.toContain('≈')
  expect(chipLabel()).toMatch(/ · .+ \/ .+/)
}

const searchField = () =>
  document.querySelector<HTMLInputElement>('[data-slot="ModelPicker"] input')

const compareSwitch = () =>
  document.querySelector<HTMLInputElement>('[data-testid="model-picker-compare-switch"]')

const compareModels = () =>
  document.querySelector<HTMLElement>('[data-testid="model-picker-compare-models"]')

const pickerOpen = () =>
  document.querySelector('[data-slot="ModelPicker"]')?.closest('dialog')?.open ?? false

const allSection = () => document.querySelector<HTMLElement>('[data-picker-section="all"]')

const openPicker = async () => {
  document.querySelector<HTMLButtonElement>('[data-slot="ModelChip"]')?.click()
  await expect.poll(() => searchField()).toBeTruthy()
  await expect.poll(() => pickerOpen()).toBe(true)
}

const filterModels = async (query: string) => {
  const field = searchField()
  if (!field) throw new Error('missing search')
  field.focus()
  field.value = query
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

const modelOption = (modelId: string) =>
  document.querySelector<HTMLElement>(
    `[data-picker-section="all"] [data-model-id="${modelId}"] [role="option"]`,
  )

const fastScript = (content: string, id: string, model: string) => ({
  firstTokenDelayMs: 30,
  chunks: [
    {
      data: {
        id,
        object: 'chat.completion.chunk',
        created: 1710000000,
        model,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      },
    },
    {
      delayMs: 40,
      data: {
        id,
        object: 'chat.completion.chunk',
        created: 1710000000,
        model,
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 4,
          total_tokens: 12,
          cost: 0.000021,
          is_byok: false,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ],
})

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya reads costs, search, and compare from the model list', async () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    models: storyModels,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => catalogById().has(curatedMiniModelId)).toBe(true)

  await showQuote(catalogModels.find((model) => model.pricing.prompt === '0')!.id, 500)
  expect(document.querySelector('.cost-chip')).toBeTruthy()
  await shot('model-picker', 'cost-zero')

  await showQuote(curatedMiniModelId, 500)
  await shot('model-picker', 'cost-subcent')

  await showQuote(longContextModelId, 1000)
  await shot('model-picker', 'cost-cent')

  await showQuote(claudeId, 80_000)
  const costBox = document.querySelector('[data-cost-chip]')?.getBoundingClientRect()
  const searchBox = document
    .querySelector('[data-web-search-toggle]')
    ?.getBoundingClientRect()
  if (!costBox || !searchBox) throw new Error('missing composer controls')
  expect(Math.abs(costBox.top - searchBox.top)).toBeLessThan(2)
  expect(Math.abs(costBox.height - searchBox.height)).toBeLessThan(2)
  await shot('model-picker', 'cost-dollars')

  expect(document.querySelector('[data-web-chip]')).toBeNull()
  await I.click(button('Web search'))
  await expect
    .poll(() => document.querySelector('[data-web-search-toggle]')?.getAttribute('aria-pressed'))
    .toBe('true')
  expect(document.querySelector('[data-web-chip]')).toBeNull()
  expect(document.querySelector('[data-slot="WebSearchToggle"]')?.textContent ?? '').not.toContain(
    'Web',
  )
  await shot('model-picker', 'web-search-on')

  expect(
    [...document.querySelectorAll('[data-composer-tools] button')].some(
      (item) => item.textContent?.trim() === 'Compare',
    ),
  ).toBe(false)
  expect(document.querySelector('[data-slot="AttachmentTray"] [data-slot="CompareButton"] button')).toBeNull()

  await openPicker()
  expect(compareSwitch()?.getAttribute('aria-pressed')).toBe('false')
  expect(compareSwitch()?.getAttribute('aria-label')).toMatch(/Compare/)
  expect(compareSwitch()?.getAttribute('role')).toBe('switch')
  expect([...document.querySelectorAll('button')].some((item) => /All models/.test(item.textContent ?? ''))).toBe(
    false,
  )
  expect(allSection()?.querySelector(':scope > button')).toBeNull()
  expect(allSection()?.textContent).toContain('All models')
  const listedIds = [...(allSection()?.querySelectorAll('[data-model-id]') ?? [])].map(
    (row) => row.getAttribute('data-model-id'),
  )
  expect(listedIds.length).toBe(storyModels.length)
  expect(
    allSection()
      ?.querySelector(`[data-model-id="${curatedMiniModelId}"] [data-testid="model-release-date"]`)
      ?.textContent,
  ).toBe(release)
  expect(
    allSection()?.querySelector(
      `[data-model-id="${undatedId}"] [data-testid="model-release-date"]`,
    ),
  ).toBeNull()
  await shot('model-picker', 'list')

  await filterModels(curatedMiniModelId)
  await expect.poll(() => modelOption(curatedMiniModelId)).toBeTruthy()
  modelOption(curatedMiniModelId)?.click()
  await expect.poll(() => pickerOpen()).toBe(false)
  expect(compareModels()?.getAttribute('data-model-ids') ?? '').toBe('')
  expect(document.querySelector('[data-slot="ModelChip"]')?.textContent).toContain('GPT-4o-mini')

  await openPicker()
  compareSwitch()?.click()
  await expect.poll(() => compareSwitch()?.getAttribute('aria-pressed')).toBe('true')
  await filterModels('gpt-4o-mini')
  await expect.poll(() => modelOption(curatedMiniModelId)).toBeTruthy()
  modelOption(curatedMiniModelId)?.click()
  await filterModels('claude-sonnet-4')
  await expect.poll(() => modelOption(claudeId)).toBeTruthy()
  modelOption(claudeId)?.click()
  await expect.poll(() => compareModels()?.getAttribute('data-model-ids')).toBe(
    `${curatedMiniModelId},${claudeId}`,
  )
  await filterModels('')
  await expect
    .poll(
      () =>
        document
          .querySelector(`[data-picker-section="all"] [data-model-id="${curatedMiniModelId}"]`)
          ?.getAttribute('data-compare-selected') === 'true' &&
        document
          .querySelector(`[data-picker-section="all"] [data-model-id="${claudeId}"]`)
          ?.getAttribute('data-compare-selected') === 'true',
    )
    .toBe(true)
  await shot('model-picker', 'compare-on')
  await filterModels('gemini-2.5-pro')
  await expect.poll(() => modelOption(longContextModelId)).toBeTruthy()
  modelOption(longContextModelId)?.click()
  expect(compareModels()?.getAttribute('data-model-ids')).toBe(`${curatedMiniModelId},${claudeId}`)

  await I.press('{Escape}')
  await expect.poll(() => pickerOpen()).toBe(false)
  expect(document.querySelector('[data-compare-model]')?.textContent).toContain('Claude Sonnet 4')
  expect(document.querySelector('[data-slot="ModelChip"]')?.textContent).toContain('GPT-4o-mini')
  expect(document.querySelector('[data-compare-estimate]')?.textContent).toContain('Sends 2 requests')

  mockChatStreamFor(curatedMiniModelId, fastScript('North light.', 'gen-chrome-mini', curatedMiniModelId))
  mockChatStreamFor(claudeId, fastScript('Warm stone.', 'gen-chrome-claude', claudeId))
  const composer = document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')
  composer?.focus()
  activeChat().draft.text.set('Compare the north light')
  const send = () =>
    document.querySelector<HTMLButtonElement>('[data-slot="Composer"] [data-send]')
  await expect.poll(() => send()?.disabled).toBe(false)
  const postsBefore = chatBodies().length
  send()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 8_000 }).toBe(postsBefore + 2)
  expect(chatBodies().slice(postsBefore).map((body) => (body as { model?: string }).model).sort()).toEqual(
    [claudeId, curatedMiniModelId].sort(),
  )
}, 60_000)
