import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import {
  button,
  createActor,
  role,
  text,
  type UserEvent,
} from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { ui } from '../app/ui'
import { providers } from '../catalog/providers'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { unavailable503, unknownModel404 } from './fixtures/errors'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
import { providerList } from './fixtures/providers'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockGeneration,
  mockKey,
  mockModels,
  mockProviders,
  mockRouteDelay,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 1100 }
const storyKey = 'sk-or-v1-routing-story'
const chatId = 'chat-routing'
const integrationsUrl = 'https://openrouter.ai/settings/integrations'
const byokLines = [
  'Add provider keys on OpenRouter. They never touch this app.',
  "This app can't see whether a provider key is installed; the BYOK chip on a reply tells you it was used.",
  'OpenRouter charges 5% of list price after $25k/month.',
] as const
const emptyProviders = 'OpenRouter returned no providers.'
const providersError = "Couldn't load providers."
const onlyChip = 'Routing: Anthropic only'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

type ChatBody = {
  provider?: {
    only?: string[]
    order?: string[]
    allow_fallbacks?: boolean
    data_collection?: string
  }
}

let extraUnmount: (() => void) | null = null

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await settle()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-19b', name)
}

const inView = (element: Element) => {
  const box = element.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(box.top).toBeGreaterThanOrEqual(0)
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1)
}

const routingRoot = () =>
  document.querySelector<HTMLElement>('[data-slot="RoutingSection"]')

const openRouting = async () => {
  ui.appSettings.set(null)
  ui.chatSettings.set('routing')
  await expect
    .poll(() =>
      document
        .querySelector('[data-slot="ChatSettings"] dialog')
        ?.hasAttribute('open'),
    )
    .toBe(true)
}

const closeDialogs = async () => {
  ui.chatSettings.set(null)
  ui.appSettings.set(null)
  await expect.poll(() => document.querySelector('dialog[open]')).toBeNull()
}

const radioNamed = (name: string) => {
  const input = routingRoot()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${name}"]`,
  )
  if (!input) throw new Error(`missing radio ${name}`)
  return input
}

const bodyAt = (index: number) => chatBodies()[index] as ChatBody | undefined

const composer = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const sendLine = async (value: string, posts: number) => {
  await closeDialogs()
  const field = composer()
  if (!field) throw new Error('missing composer')
  field.focus()
  activeChat().draft.text.set(value)
  await expect.poll(() => sendButton()?.disabled).toBe(false)
  sendButton()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 6_000 }).toBe(posts)
  await expect.poll(() => activeChat().streaming(), { timeout: 6_000 }).toBeNull()
}

const replyScript = {
  chunks: [
    {
      data: {
        id: 'gen-routing',
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: 'anthropic/claude-sonnet-4',
        choices: [
          { index: 0, delta: { content: 'Noted.' }, finish_reason: null },
        ],
      },
    },
    {
      data: {
        id: 'gen-routing',
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: 'anthropic/claude-sonnet-4',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    },
  ],
}

const armMocks = () => {
  mockModels(fixtureModels)
  mockKey(limitedKey)
  mockGeneration(generationRecord)
  mockChatStream(replyScript)
  mockProviders(providerList)
}

const reloadApp = async () => {
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  armMocks()
  mockRouteDelay('/providers', 0)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

const expectByok = () => {
  const root = routingRoot()
  expect(root).toBeTruthy()
  const copy = root?.textContent ?? ''
  for (const line of byokLines) expect(copy).toContain(line)
  expect(copy).not.toContain('BYOK connected')
  const integrations = root?.querySelector<HTMLAnchorElement>(
    `a[href="${integrationsUrl}"]`,
  )
  expect(integrations).toBeTruthy()
  expect(integrations?.textContent ?? '').toContain('openrouter.ai/settings/integrations')
  const fields = [...(root?.querySelectorAll('input, textarea') ?? [])]
  expect(
    fields.every((field) => {
      const type = field.getAttribute('type')
      return type === 'radio' || type === 'checkbox'
    }),
  ).toBe(true)
}

const expectSectionInView = () => {
  const root = routingRoot()
  expect(root).toBeTruthy()
  inView(root!)
  for (const line of byokLines) {
    const node = [...root!.querySelectorAll('p, a, strong, span, h2, h3')].find(
      (element) => element.textContent?.includes(line),
    )
    expect(node).toBeTruthy()
    inView(node!)
  }
}

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Raj routes through Anthropic only, and a routing error loosens back to Auto', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: chatId,
        title: 'Routing',
        model: 'anthropic/claude-sonnet-4',
      },
    ],
  })
  armMocks()
  mockRouteDelay('/providers', 4_000)
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(chatId)
  await expect.poll(() => activeChat().id).toBe(chatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  expect(activeChat().settings().routing).toEqual({
    mode: 'auto',
    allowFallbacks: true,
  })

  await sendLine('Auto note', 1)
  expect(bodyAt(0)?.provider).toEqual({ data_collection: 'deny' })
  expect(bodyAt(0)?.provider).not.toHaveProperty('only')
  expect(bodyAt(0)?.provider).not.toHaveProperty('order')

  await openRouting()
  await I.see(role('radio', 'Auto'))
  expect(radioNamed('auto').checked).toBe(true)
  expect(radioNamed('auto').disabled).toBe(false)
  expect(radioNamed('order').disabled).toBe(true)
  expect(radioNamed('only').disabled).toBe(true)
  await I.seeChecked(role('switch', 'Allow fallbacks'))
  expect(routingRoot()?.textContent ?? '').not.toContain(emptyProviders)
  expect(routingRoot()?.textContent ?? '').not.toContain(providersError)
  expect(routingRoot()?.querySelector('[data-skeleton]')).toBeTruthy()
  expectByok()
  expectSectionInView()
  await shoot('loading')

  await expect
    .poll(() => radioNamed('order').disabled, { timeout: 8_000 })
    .toBe(false)
  await I.see(role('checkbox', 'Anthropic'))
  expect(radioNamed('only').disabled).toBe(false)
  expectByok()
  expectSectionInView()
  await shoot('populated')
  await shoot('auto')

  await I.click(role('radio', 'Prefer order'))
  await I.click(role('checkbox', 'Anthropic'))
  await I.click(role('checkbox', 'OpenAI'))
  expect(activeChat().settings().routing).toEqual({
    mode: 'order',
    providers: ['anthropic', 'openai'],
    allowFallbacks: true,
  })
  expectByok()
  expectSectionInView()
  await shoot('order')
  await sendLine('Order note', 2)
  expect(bodyAt(1)?.provider?.order).toEqual(['anthropic', 'openai'])
  expect(bodyAt(1)?.provider).not.toHaveProperty('only')
  expect(bodyAt(1)?.provider?.allow_fallbacks).toBeUndefined()
  expect(bodyAt(1)?.provider?.data_collection).toBe('deny')

  await openRouting()
  await I.click(role('radio', 'Only these'))
  await I.click(role('checkbox', 'OpenAI'))
  await I.click(role('switch', 'Allow fallbacks'))
  await expect.poll(() => activeChat().settings().routing).toEqual({
    mode: 'only',
    providers: ['anthropic'],
    allowFallbacks: false,
  })
  expectByok()
  expectSectionInView()
  await shoot('only')
  await closeDialogs()
  const chip = document.querySelector<HTMLElement>('[data-routing-chip]')
  expect(chip?.textContent).toContain(onlyChip)
  expect(document.body.textContent ?? '').not.toContain('BYOK connected')
  inView(chip!)
  const chipLabel = chip?.querySelector('[data-label]')
  expect(chipLabel).toBeTruthy()
  expect(chipLabel!.scrollWidth).toBeLessThanOrEqual(chipLabel!.clientWidth + 1)
  await shoot('no-fallback-chip')
  await sendLine('Only note', 3)
  expect(bodyAt(2)?.provider).toEqual({
    only: ['anthropic'],
    allow_fallbacks: false,
    data_collection: 'deny',
  })

  await expect
    .poll(async () => (await repo.getChat(chatId))?.settings.routing, {
      timeout: 3_000,
    })
    .toEqual({
      mode: 'only',
      providers: ['anthropic'],
      allowFallbacks: false,
    })
  await reloadApp()
  openChat(chatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await expect.poll(() => activeChat().settings().routing).toEqual({
    mode: 'only',
    providers: ['anthropic'],
    allowFallbacks: false,
  })
  await expect
    .poll(() => document.querySelector('[data-routing-chip]')?.textContent ?? '')
    .toContain(onlyChip)
  await sendLine('Reloaded note', 1)
  expect(bodyAt(0)?.provider).toEqual({
    only: ['anthropic'],
    allow_fallbacks: false,
    data_collection: 'deny',
  })

  await openRouting()
  mockRouteDelay('/providers', 0)
  mockProviders([])
  await providers.retry()
  await expect
    .poll(() => routingRoot()?.textContent ?? '')
    .toContain(emptyProviders)
  expect(radioNamed('auto').disabled).toBe(false)
  expect(radioNamed('order').disabled).toBe(true)
  expect(radioNamed('only').disabled).toBe(true)
  expectByok()
  expectSectionInView()
  await shoot('empty')

  mockProviders({ status: 503 })
  await providers.retry().catch(() => {})
  await expect
    .poll(() => routingRoot()?.textContent ?? '')
    .toContain(providersError)
  await I.see(button('Retry').within(role('region', 'Routing').wait()))
  expect(routingRoot()?.textContent ?? '').not.toContain(emptyProviders)
  expectByok()
  expectSectionInView()
  await shoot('error')
  mockProviders(providerList)
  await I.click(button('Retry'))
  await I.see(role('checkbox', 'Anthropic').wait())

  await closeDialogs()
  mockChatStream(unavailable503)
  await sendLine('Routed outage', 2)
  const loosen = document.querySelector<HTMLButtonElement>(
    '[data-action="loosen-routing"][data-primary="true"]',
  )
  expect(loosen?.textContent).toContain('Loosen routing')
  expect(bodyAt(1)?.provider).toEqual({
    only: ['anthropic'],
    allow_fallbacks: false,
    data_collection: 'deny',
  })
  loosen?.click()
  await expect.poll(() => activeChat().settings().routing).toEqual({
    mode: 'auto',
    allowFallbacks: true,
  })
  await expect
    .poll(async () => (await repo.getChat(chatId))?.settings.routing)
    .toEqual({
      mode: 'auto',
      allowFallbacks: true,
    })
  expect(document.querySelector('[data-routing-chip]')).toBeNull()

  mockChatStream(replyScript)
  await sendLine('Loosened note', 3)
  expect(bodyAt(2)?.provider).not.toHaveProperty('only')
  expect(bodyAt(2)?.provider).not.toHaveProperty('order')

  await openRouting()
  await I.click(role('radio', 'Only these'))
  await expect.poll(() => activeChat().settings().routing.mode).toBe('only')
  await I.click(role('checkbox', 'Anthropic'))
  await I.click(role('switch', 'Allow fallbacks'))
  await expect.poll(() => activeChat().settings().routing).toEqual({
    mode: 'only',
    providers: ['anthropic'],
    allowFallbacks: false,
  })
  await closeDialogs()
  mockChatStream(unknownModel404)
  await sendLine('Routed missing', 4)
  const loosenAgain = document.querySelector<HTMLButtonElement>(
    '[data-action="loosen-routing"][data-primary="true"]',
  )
  expect(loosenAgain?.textContent).toContain('Loosen routing')
  expect(bodyAt(3)?.provider?.only).toEqual(['anthropic'])
  loosenAgain?.click()
  await expect.poll(() => activeChat().settings().routing).toEqual({
    mode: 'auto',
    allowFallbacks: true,
  })
  await I.dontSee(text('BYOK connected'))
}, 120_000)
