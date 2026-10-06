import { button, createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { catalogById } from '../catalog'
import { activeChat } from '../chat'
import { assembleContext, contextCharacterCount } from '../chat/context'
import {
  defaultOutputTokens,
  estimateCost,
  estimateTokens,
  formatEstimate,
} from '../money'
import { bootApp, unmountApp } from './boot'
import { paymentInFlight402, unavailable503 } from './fixtures/errors'
import { limitedKey } from './fixtures/keys'
import { chatBodies, mockChatStreamFor } from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const phone = { width: 390, height: 800 }
const storyKey = 'sk-or-v1-compare-story'
const primaryId = 'openai/gpt-4o-mini'
const secondId = 'anthropic/claude-sonnet-4'
const primaryName = 'OpenAI: GPT-4o-mini'
const secondName = 'Anthropic: Claude Sonnet 4'
const prompt = 'Compare the north light'
const north = 'North light.'
const warm = 'Warm stone.'
const budgetAsk = 'Check the in-flight budget'
const bothFailAsk = 'Both of these fail'
const hold = 'Pick a reply to continue'
const different = 'Pick a different model.'
const sendsTwo = 'Sends 2 requests'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

type WireBody = { model?: string }

const bodies = () => chatBodies() as WireBody[]

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-send]')

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const searchField = () =>
  document.querySelector<HTMLInputElement>(
    '[data-slot="ModelPicker"] input',
  )

const pickerOpen = () =>
  document.querySelector('[data-slot="ModelPicker"]')?.closest('dialog')
    ?.open ?? false

const rows = (roleName: 'user' | 'assistant') => [
  ...document.querySelectorAll<HTMLElement>(`[data-role="${roleName}"]`),
]

const panels = () => [
  ...document.querySelectorAll<HTMLElement>('[data-compare-panel]'),
]

const panel = (modelId: string) =>
  panels().find((item) => item.dataset.model === modelId) ?? null

const visiblePanels = () =>
  panels().filter((item) => getComputedStyle(item).display !== 'none')

const latestAssistant = () => rows('assistant').at(-1) ?? null

const versionText = () =>
  latestAssistant()?.querySelector('[data-version]')?.textContent ?? ''

const versionButton = (name: string) =>
  [...(latestAssistant()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (item) => item.getAttribute('aria-label') === name,
  ) ?? null

const pairedEstimate = () => {
  const chat = activeChat()
  const settings = chat.settings()
  const wire = assembleContext({
    path: chat.path().map((node) => node.message),
    systemPrompt: settings.systemPrompt,
    requestModel: primaryId,
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
  const cost = (modelId: string) => {
    const model = catalogById().get(modelId)
    if (!model) return 0
    return estimateCost({
      inputTokens,
      outputTokens,
      promptPrice: model.promptPrice,
      completionPrice: model.completionPrice,
    })
  }
  return formatEstimate(cost(primaryId) + cost(secondId))
}

const contentChunk = (content: string, id: string, model: string) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model,
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
})

const finishChunk = (id: string, model: string, cost: number) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model,
  choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
  usage: {
    prompt_tokens: 12,
    completion_tokens: 4,
    total_tokens: 16,
    cost,
    is_byok: false,
    completion_tokens_details: { reasoning_tokens: 0 },
  },
})

const streamScript = (
  content: string,
  id: string,
  model: string,
  finishDelayMs: number,
  cost: number,
) => ({
  firstTokenDelayMs: 180,
  chunks: [
    { data: contentChunk(content, id, model) },
    { delayMs: finishDelayMs, data: finishChunk(id, model, cost) },
  ],
})

const fastScript = (content: string, id: string, model: string) => ({
  firstTokenDelayMs: 40,
  chunks: [
    { data: contentChunk(content, id, model) },
    { delayMs: 80, data: finishChunk(id, model, 0.000021) },
  ],
})

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const columns = document.querySelector('[data-slot="CompareColumns"]')
  const target =
    columns ??
    document.querySelector('[data-compare-estimate]') ??
    document.querySelector('[data-role="assistant"] [data-version]')
  target?.scrollIntoView({ block: 'center', inline: 'nearest' })
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await settle()
  await shot('F-25', name)
}

const compareSwitch = () =>
  document.querySelector<HTMLInputElement>('[data-testid="model-picker-compare-switch"]')

const openModelPicker = async () => {
  document.querySelector<HTMLButtonElement>('[data-slot="ModelChip"]')?.click()
  await expect.poll(() => searchField()).toBeTruthy()
}

const setPickerQuery = async (query: string) => {
  const field = searchField()
  if (!field) throw new Error('missing search')
  field.focus()
  field.value = query
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

const clickListed = async (modelId: string) => {
  const option = () =>
    document.querySelector<HTMLElement>(
      `[data-picker-section="all"] [data-model-id="${modelId}"] [role="option"]`,
    )
  await expect.poll(() => option()).toBeTruthy()
  option()?.click()
}

const setCompareSwitch = async (on: boolean) => {
  const pressed = compareSwitch()?.getAttribute('aria-pressed') === 'true'
  if (pressed !== on) compareSwitch()?.click()
  await expect.poll(() => compareSwitch()?.getAttribute('aria-pressed')).toBe(
    on ? 'true' : 'false',
  )
}

const closeModelPicker = async () => {
  await I.press('{Escape}')
  await expect.poll(() => pickerOpen()).toBe(false)
}

const pickModel = async (modelId: string, query: string) => {
  await openModelPicker()
  await setCompareSwitch(false)
  await setCompareSwitch(true)
  if (modelId === primaryId) {
    await setPickerQuery(primaryId)
    await clickListed(primaryId)
    await clickListed(primaryId)
    await closeModelPicker()
    return
  }
  await setPickerQuery(primaryId)
  await clickListed(primaryId)
  await setPickerQuery(query)
  await clickListed(modelId)
  await expect
    .poll(() => document.querySelector('[data-compare-model]')?.getAttribute('data-compare-model'))
    .toBe(modelId)
  await closeModelPicker()
}

const stopButton = (modelId: string) =>
  panel(modelId)?.querySelector<HTMLButtonElement>(
    'button[aria-label^="Stop "]',
  ) ?? null

const continueButton = (modelId: string) =>
  [...(panel(modelId)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (item) => item.textContent?.trim() === 'Continue with this',
  ) ?? null

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya compares two models and keeps one reply', async () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(primaryName)

  await pickModel(primaryId, primaryId)
  await expect.poll(() => document.body.textContent ?? '').toContain(different)
  expect(document.querySelector('[data-compare-model]')).toBeNull()
  expect(document.body.textContent ?? '').not.toContain(sendsTwo)

  setDraft(prompt)
  await pickModel(secondId, 'claude-sonnet-4')
  await expect
    .poll(() => document.querySelector('[data-slot="ModelChip"]')?.textContent ?? '')
    .toContain(primaryName)
  expect(document.querySelector('[data-compare-model]')?.textContent).toContain(
    secondName,
  )
  expect(document.querySelector('[data-compare-estimate]')?.textContent).toContain(
    sendsTwo,
  )
  expect(document.querySelector('[data-compare-estimate]')?.textContent).toContain(
    pairedEstimate(),
  )
  await shoot('setup')

  mockChatStreamFor(
    primaryId,
    streamScript(north, 'gen-compare-mini', primaryId, 4_500, 0.000012),
  )
  mockChatStreamFor(
    secondId,
    streamScript(warm, 'gen-compare-claude', secondId, 20_000, 0.000044),
  )
  const postsBefore = bodies().length
  field()?.focus()
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(() => bodies().length, { timeout: 8_000 })
    .toBe(postsBefore + 2)
  const sent = bodies().slice(postsBefore)
  expect(sent.map((body) => body.model).sort()).toEqual([primaryId, secondId].sort())

  await expect.poll(() => panel(primaryId)?.textContent ?? '').toContain(north)
  await expect.poll(() => panel(secondId)?.textContent ?? '').toContain(warm)
  expect(panel(primaryId)?.dataset.status).toBe('streaming')
  expect(panel(secondId)?.dataset.status).toBe('streaming')
  expect(stopButton(primaryId)).toBeTruthy()
  expect(stopButton(secondId)).toBeTruthy()
  expect(panel(primaryId)?.querySelector('[data-compare-timing]')?.textContent).toMatch(
    /\d+(\.\d+)?s/,
  )
  expect(panel(secondId)?.querySelector('[data-compare-timing]')?.textContent).toMatch(
    /\d+(\.\d+)?s/,
  )
  expect(panel(primaryId)?.textContent).toMatch(/≈|\$/)
  expect(panel(secondId)?.textContent).toMatch(/≈|\$/)
  await shoot('both-streaming')

  await page.viewport(phone.width, phone.height)
  await expect.poll(() => visiblePanels().length).toBe(1)
  const tabs = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="CompareColumns"] [role="tab"]',
    ),
  ]
  expect(tabs).toHaveLength(2)
  const primaryTab = tabs.find((tab) =>
    (tab.getAttribute('aria-label') ?? '').includes(primaryName),
  )
  const secondTab = tabs.find((tab) =>
    (tab.getAttribute('aria-label') ?? '').includes(secondName),
  )
  expect(primaryTab?.getAttribute('aria-label')).toMatch(/Streaming/)
  expect(secondTab?.getAttribute('aria-label')).toMatch(/Streaming/)
  await shoot('phone-tabs')
  await page.viewport(desktop.width, desktop.height)
  await expect.poll(() => visiblePanels().length).toBe(2)

  await expect
    .poll(() => panel(primaryId)?.dataset.status, { timeout: 8_000 })
    .toBe('done')
  expect(panel(secondId)?.dataset.status).toBe('streaming')
  expect(stopButton(secondId)).toBeTruthy()
  expect(stopButton(primaryId)).toBeNull()
  await shoot('one-done')

  const postsAtStop = bodies().length
  stopButton(secondId)?.click()
  await expect.poll(() => panel(secondId)?.dataset.status).toBe('stopped')
  expect(panel(primaryId)?.dataset.status).toBe('done')
  expect(panel(primaryId)?.textContent).toContain(north)
  expect(bodies()).toHaveLength(postsAtStop)

  expect(sendButton()?.disabled).toBe(true)
  expect(sendButton()?.getAttribute('aria-label')).toBe(hold)
  expect(document.body.textContent).toContain(hold)

  continueButton(primaryId)?.click()
  await expect.poll(() => panel(primaryId)).toBeNull()
  await expect.poll(() => versionText()).toBe('1/2')
  await expect.poll(() => latestAssistant()?.textContent ?? '').toContain(north)
  versionButton('Next version')?.click()
  await expect.poll(() => versionText()).toBe('2/2')
  await expect.poll(() => latestAssistant()?.textContent ?? '').toContain(warm)
  versionButton('Previous version')?.click()
  await expect.poll(() => versionText()).toBe('1/2')
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).not.toBe(hold)
  await shoot('chosen')

  setDraft(budgetAsk)
  await pickModel(secondId, 'claude-sonnet-4')
  mockChatStreamFor(primaryId, fastScript('Budget cleared.', 'gen-compare-ok', primaryId))
  mockChatStreamFor(secondId, paymentInFlight402)
  const postsBeforeFailure = bodies().length
  field()?.focus()
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(() => bodies().length, { timeout: 8_000 })
    .toBe(postsBeforeFailure + 2)
  await expect
    .poll(() => panel(secondId)?.textContent ?? '')
    .toContain('Too many requests in flight for your budget. Retry in 12s.')
  await expect
    .poll(() => panel(primaryId)?.textContent ?? '', { timeout: 8_000 })
    .toContain('Budget cleared.')
  await expect
    .poll(() => panel(primaryId)?.dataset.status, { timeout: 8_000 })
    .toBe('done')
  expect(panel(secondId)?.querySelector('[data-slot="ErrorCard"]')).toBeTruthy()
  await shoot('one-failed')
  continueButton(primaryId)?.click()
  await expect.poll(() => document.querySelector('[data-compare-panel]')).toBeNull()
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).not.toBe(hold)

  setDraft(bothFailAsk)
  await pickModel(secondId, 'claude-sonnet-4')
  mockChatStreamFor(primaryId, paymentInFlight402)
  mockChatStreamFor(secondId, unavailable503)
  field()?.focus()
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(() => panels().length, { timeout: 8_000 })
    .toBe(2)
  await expect
    .poll(() => panel(primaryId)?.querySelector('[data-slot="ErrorCard"]'))
    .toBeTruthy()
  await expect
    .poll(() => panel(secondId)?.querySelector('[data-slot="ErrorCard"]'))
    .toBeTruthy()
  expect(panel(primaryId)?.textContent).toContain(
    'Too many requests in flight for your budget. Retry in 12s.',
  )
  expect(panel(secondId)?.textContent).toContain(`${secondName} is unavailable right now.`)
  await I.click(button('Exit compare'))
  await expect.poll(() => document.querySelector('[data-compare-panel]')).toBeNull()
  expect(rows('user').some((row) => row.textContent?.includes(bothFailAsk))).toBe(
    true,
  )
  expect(document.body.textContent).not.toContain(hold)
}, 60_000)
