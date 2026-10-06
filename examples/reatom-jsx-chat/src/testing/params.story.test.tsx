import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { ui } from '../app/ui'
import { sessionMode } from '../auth/session'
import { activeChat } from '../chat'
import { modelName } from '../catalog'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import { toast } from '../ui'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import {
  catalogModels as fixtureModels,
  curatedMiniModelId,
  noParamsModelId,
  paidTwinModelId,
  reasoningEffortsModelId,
} from './fixtures/models'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 1000 }
const storyKey = 'sk-or-v1-params-story'
const paramsChatId = 'chat-params'
const otherChatId = 'chat-params-other'
const llamaLimit = 16_384
const fallbackEfforts = ['none', 'minimal', 'low', 'medium', 'high']
const o3Efforts = ['minimal', 'low', 'medium', 'high']

const keyboard = userEvent.setup() as unknown as UserEvent

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

type ChatBody = {
  temperature?: number
  top_p?: number
  max_tokens?: number
  reasoning?: { effort?: string }
  reasoning_effort?: unknown
}

let extraUnmount: (() => void) | null = null

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const replyScript = {
  chunks: [
    {
      data: {
        id: 'gen-params',
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: paidTwinModelId,
        choices: [
          { index: 0, delta: { content: 'Noted.' }, finish_reason: null },
        ],
      },
    },
    {
      data: {
        id: 'gen-params',
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: paidTwinModelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    },
  ],
}

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-16', name)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
}

const onScreen = (element: Element) => {
  const box = element.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(box.top).toBeGreaterThanOrEqual(0)
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1)
}

const advanced = () =>
  document.querySelector<HTMLElement>('[data-slot="AdvancedSection"]')

const advancedTab = () =>
  [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) =>
    (tab.textContent ?? '').includes('Advanced'),
  )

const overriddenDot = () =>
  advancedTab()?.querySelector<HTMLElement>('[data-overridden]') ?? null

const slider = (label: string) =>
  advanced()?.querySelector<HTMLInputElement>(
    `input[type="range"][aria-label="${label}"]`,
  ) ?? null

const maxTokens = () =>
  advanced()?.querySelector<HTMLInputElement>(
    'input[aria-label="Max output tokens"]',
  ) ?? null

const effortGroup = () =>
  advanced()?.querySelector<HTMLElement>('[aria-label="Reasoning effort"]') ??
  null

const effortChip = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] button[aria-label^="Effort:"]',
  )

const effortMenuLabels = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menu"][aria-label^="Effort:"] [data-menu-label]',
    ),
  ].map((item) => item.dataset.menuLabel)

const effortMarks = () =>
  effortChip()?.querySelector<SVGElement>('[data-effort]')?.getAttribute('data-effort') ??
  null

const effortMarkCount = () =>
  effortChip()?.querySelector<SVGElement>('[data-marks]')?.getAttribute('data-marks') ??
  null

const unsupportedLine = () =>
  advanced()?.querySelector<HTMLElement>('[data-unsupported]') ?? null

const composer = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const bodyAt = (index: number) => chatBodies()[index] as ChatBody | undefined

const closeDialogs = () => {
  ui.chatSettings.set(null)
  ui.appSettings.set(null)
}

const openAdvanced = async () => {
  closeDialogs()
  ui.chatSettings.set('advanced')
  await expect
    .poll(() => advanced()?.isConnected ?? false)
    .toBe(true)
}

const clearToasts = () => {
  for (const key of toast.keys()) toast.dismiss(key)
}

const setControl = (input: HTMLInputElement, value: string) => {
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const sendLine = async (value: string, posts: number) => {
  closeDialogs()
  await expect.poll(() => document.querySelector('dialog[open]')).toBeNull()
  const field = composer()
  if (!field) throw new Error('missing composer')
  field.focus()
  activeChat().draft.text.set(value)
  await expect.poll(() => sendButton()?.disabled).toBe(false)
  sendButton()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 4_000 }).toBe(posts)
  await expect
    .poll(() => activeChat().streaming(), { timeout: 4_000 })
    .toBeNull()
}

const expectOmitted = (body: ChatBody | undefined) => {
  expect(body).not.toHaveProperty('temperature')
  expect(body).not.toHaveProperty('top_p')
  expect(body).not.toHaveProperty('max_tokens')
  expect(body).not.toHaveProperty('reasoning')
  expect(body).not.toHaveProperty('reasoning_effort')
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
  mockChatStream(replyScript)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

const unsupportedCopy = (modelId: string, parameters: string) =>
  `Not supported by ${modelName(modelId)}: ${parameters}`

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  resetLocation()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya tunes only the parameters the model accepts', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: paramsChatId,
        title: 'Parameter notes',
        model: paidTwinModelId,
      },
      {
        id: otherChatId,
        title: 'Untouched chat',
        model: paidTwinModelId,
      },
    ],
  })
  mockChatStream(replyScript)
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(paramsChatId)
  await expect.poll(() => activeChat().id).toBe(paramsChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await expect.poll(() => modelName(paidTwinModelId)).toContain('Llama')

  await openAdvanced()
  const temperature = slider('Temperature')
  const topP = slider('Top P')
  const limit = maxTokens()
  expect(temperature).toBeInstanceOf(HTMLInputElement)
  expect(temperature!.min).toBe('0')
  expect(temperature!.max).toBe('2')
  expect(topP).toBeInstanceOf(HTMLInputElement)
  expect(topP!.min).toBe('0')
  expect(topP!.max).toBe('1')
  expect(limit).toBeInstanceOf(HTMLInputElement)
  expect(Number(limit!.max)).toBe(llamaLimit)
  expect(effortGroup()).toBeNull()
  expect(effortChip()).toBeNull()
  expect(unsupportedLine()?.textContent).toBe(
    unsupportedCopy(paidTwinModelId, 'reasoning'),
  )
  expect(overriddenDot()).toBeNull()
  onScreen(temperature!)
  onScreen(unsupportedLine()!)
  await settle()
  await shoot('defaults')

  await sendLine('Defaults stay off the wire', 1)
  expectOmitted(bodyAt(0))

  await openAdvanced()
  setControl(slider('Temperature')!, '0.4')
  setControl(slider('Top P')!, '0.5')
  setControl(maxTokens()!, '200')
  await expect.poll(() => activeChat().settings().params).toEqual({
    temperature: 0.4,
    topP: 0.5,
    maxTokens: 200,
  })
  await expect.poll(() => overriddenDot()).toBeTruthy()
  onScreen(overriddenDot()!)
  onScreen(slider('Temperature')!)
  await settle()
  await shoot('overridden')

  await sendLine('Send the overrides', 2)
  expect(bodyAt(1)?.temperature).toBe(0.4)
  expect(bodyAt(1)?.top_p).toBe(0.5)
  expect(bodyAt(1)?.max_tokens).toBe(200)
  expect(bodyAt(1)).not.toHaveProperty('reasoning')
  expect(bodyAt(1)).not.toHaveProperty('reasoning_effort')

  await openAdvanced()
  setControl(maxTokens()!, '99999')
  const rejection = `Can't exceed ${llamaLimit.toLocaleString('en-US')} tokens for this model.`
  await expect.poll(() => advanced()?.textContent ?? '').toContain(rejection)
  expect(activeChat().settings().params.maxTokens).toBe(200)
  const error = advanced()?.querySelector('[role="alert"]')
  expect(error?.textContent).toBe(rejection)
  onScreen(error!)
  await settle()
  await shoot('invalid')

  advanced()
    ?.querySelector<HTMLButtonElement>('[data-reset-params]')
    ?.click()
  await expect.poll(() => activeChat().settings().params).toEqual({})
  await expect.poll(() => overriddenDot()).toBeNull()
  expect(maxTokens()?.value).toBe('')

  await sendLine('Defaults again', 3)
  expectOmitted(bodyAt(2))

  await openAdvanced()
  setControl(slider('Temperature')!, '0.4')
  setControl(slider('Top P')!, '0.5')
  setControl(maxTokens()!, '200')
  await expect.poll(() => activeChat().settings().params.maxTokens).toBe(200)
  closeDialogs()
  activeChat().setModel(reasoningEffortsModelId)
  await expect.poll(() => activeChat().model()).toBe(reasoningEffortsModelId)
  await expect
    .poll(async () => (await repo.getChat(paramsChatId))?.model)
    .toBe(reasoningEffortsModelId)
  await settle()
  await expect.poll(() => activeChat().settings().params).toEqual({
    temperature: 0.4,
  })
  expect(JSON.stringify(chatBodies())).not.toContain('reasoning_effort')

  clearToasts()
  await openAdvanced()
  expect(slider('Temperature')).toBeInstanceOf(HTMLInputElement)
  expect(slider('Top P')).toBeNull()
  expect(maxTokens()).toBeNull()
  expect(unsupportedLine()?.textContent).toBe(
    unsupportedCopy(reasoningEffortsModelId, 'top_p, max_tokens'),
  )
  expect(
    [...(effortGroup()?.querySelectorAll<HTMLElement>('[data-effort]') ?? [])].map(
      (option) => option.dataset.effort,
    ),
  ).toEqual(o3Efforts)
  onScreen(unsupportedLine()!)
  expect(document.querySelector('dialog[open]')?.textContent).toContain(
    'Reasoning effort',
  )
  await settle()
  await shoot('unsupported')
  closeDialogs()
  expect(effortChip()?.getAttribute('aria-label')).toBe('Effort: medium')
  expect(effortMarks()).toBe('medium')
  expect(effortMarkCount()).toBe('3')

  await sendLine('Effort stays at the default', 4)
  expect(bodyAt(3)?.temperature).toBe(0.4)
  expect(bodyAt(3)).not.toHaveProperty('top_p')
  expect(bodyAt(3)).not.toHaveProperty('max_tokens')
  expect(bodyAt(3)).not.toHaveProperty('reasoning')
  expect(bodyAt(3)).not.toHaveProperty('reasoning_effort')

  effortChip()?.click()
  await expect.poll(() => effortMenuLabels()).toEqual(o3Efforts)
  document
    .querySelector<HTMLButtonElement>(
      '[role="menu"][aria-label^="Effort:"] [data-menu-label="high"]',
    )
    ?.click()
  await expect
    .poll(() => activeChat().settings().params.reasoningEffort)
    .toBe('high')
  expect(effortChip()?.getAttribute('aria-label')).toBe('Effort: high')
  expect(effortMarks()).toBe('high')
  expect(effortMarkCount()).toBe('4')

  await sendLine('Send high effort', 5)
  expect(bodyAt(4)?.reasoning).toEqual({ effort: 'high' })
  expect(bodyAt(4)).not.toHaveProperty('reasoning_effort')
  expect(JSON.stringify(bodyAt(4))).not.toContain('reasoning_effort')

  activeChat().setModel(curatedMiniModelId)
  await expect.poll(() => activeChat().model()).toBe(curatedMiniModelId)
  effortChip()?.click()
  await expect.poll(() => effortMenuLabels()).toEqual(fallbackEfforts)
  await keyboard.keyboard('{Escape}')

  const temperatureToast = `Temperature isn't supported by ${modelName(noParamsModelId)}; it won't be sent.`
  activeChat().setModel(noParamsModelId)
  await expect.poll(() => activeChat().model()).toBe(noParamsModelId)
  await I.see(text(temperatureToast).wait())
  await expect.poll(() => activeChat().settings().params).toEqual({})
  await sendLine('Nothing unsupported goes out', 6)
  expectOmitted(bodyAt(5))
  expect(JSON.stringify(bodyAt(5))).not.toContain('"temperature"')

  clearToasts()
  await openAdvanced()
  expect(slider('Temperature')).toBeNull()
  expect(slider('Top P')).toBeNull()
  expect(maxTokens()).toBeNull()
  expect(effortGroup()).toBeNull()
  expect(effortChip()).toBeNull()
  expect(advanced()?.querySelector('input')).toBeNull()
  expect(unsupportedLine()?.textContent).toBe(
    unsupportedCopy(
      noParamsModelId,
      'temperature, top_p, max_tokens, reasoning',
    ),
  )
  expect(advanced()?.textContent?.trim()).toBe(
    unsupportedCopy(
      noParamsModelId,
      'temperature, top_p, max_tokens, reasoning',
    ),
  )
  onScreen(unsupportedLine()!)
  await settle()
  await shoot('none-supported')

  closeDialogs()
  activeChat().setModel(paidTwinModelId)
  await expect.poll(() => activeChat().model()).toBe(paidTwinModelId)
  await openAdvanced()
  setControl(slider('Temperature')!, '0.2')
  await expect
    .poll(() => activeChat().settings().params.temperature)
    .toBe(0.2)
  openChat(otherChatId)
  await expect.poll(() => activeChat().id).toBe(otherChatId)
  expect(activeChat().settings().params).toEqual({})
  openChat(paramsChatId)
  await expect.poll(() => activeChat().settings().params.temperature).toBe(0.2)

  await reloadApp()
  openChat(paramsChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await expect.poll(() => activeChat().settings().params.temperature).toBe(0.2)
  expect((await repo.getChat(paramsChatId))?.settings.params.temperature).toBe(
    0.2,
  )
  openChat(otherChatId)
  await expect.poll(() => activeChat().id).toBe(otherChatId)
  expect(activeChat().settings().params).toEqual({})
  expect((await repo.getChat(otherChatId))?.settings.params).toEqual({})

  openChat(paramsChatId)
  await expect.poll(() => activeChat().id).toBe(paramsChatId)
  mockChatStream({
    status: 400,
    body: {
      error: {
        code: 400,
        message: 'temperature must be between 0 and 2',
      },
    },
  })
  await sendLine('Rejected temperature', 1)
  const card = () =>
    [...document.querySelectorAll<HTMLElement>('[data-slot="ErrorCard"]')].at(
      -1,
    )
  await expect
    .poll(() => card()?.textContent ?? '', { timeout: 4_000 })
    .toContain(`${modelName(paidTwinModelId)} rejected parameter temperature.`)
  expect(card()?.textContent).toContain('Reset parameters and retry')
  mockChatStream(replyScript)
  card()?.querySelector<HTMLButtonElement>('[data-action="reset-params-retry"]')?.click()
  await expect.poll(() => chatBodies().length, { timeout: 4_000 }).toBe(2)
  await expect.poll(() => activeChat().settings().params).toEqual({})
  expect(bodyAt(1)).not.toHaveProperty('temperature')
  expect(bodyAt(1)).not.toHaveProperty('reasoning_effort')
}, 60_000)
