import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { commands } from '../app/commands'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
import {
  encryptedReasoningScript,
  plainTextScript,
} from './fixtures/sse'
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
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-reasoning-story'
const modelLabel = 'OpenAI: GPT-4o-mini'
const thought = 'Light scatters. Shorter blue wavelengths remain.'
const stoppedThought = 'Still weighing the blue.'
const reasoningDetails = [{ type: 'reasoning.text', text: thought }]
const thinkingLabel = /Thinking… \d+s/
const thoughtLabel = /Thought for \d+s$/
const hiddenLabel = /Thought for \d+s \(hidden by provider\)/

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

type WireBody = {
  messages?: Array<Record<string, unknown>>
  reasoning?: Record<string, unknown>
  reasoning_effort?: unknown
}

const bodies = () => chatBodies() as WireBody[]

let extraUnmount: (() => void) | null = null

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  document
    .querySelector('[data-reasoning]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  await shot('F-10', name)
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

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

const reasoningLabel = () =>
  document.querySelector('[data-reasoning-label]')?.textContent ?? ''

const reasoningToggle = () =>
  document.querySelector<HTMLButtonElement>('[data-reasoning] button')

const mutedColor = () => {
  const probe = document.createElement('span')
  probe.style.color = 'var(--text-muted)'
  document.body.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

const chunk = (
  delta: Record<string, unknown>,
  finishReason: string | null = null,
  extra: Record<string, unknown> = {},
) => ({
  id: 'gen-reason-1',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: 'openai/gpt-4o-mini',
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...extra,
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

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya reads a thought, a hidden one, and a stopped think', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)

  mockChatStream({
    chunks: [
      { data: chunk({ reasoning: thought }) },
      {
        delayMs: 200,
        data: chunk({ reasoning_details: reasoningDetails }),
      },
      { delayMs: 8_000, data: chunk({ content: 'The sky looks blue.' }) },
      {
        data: chunk({ content: '' }, 'stop', {
          usage: {
            prompt_tokens: 10,
            completion_tokens: 8,
            total_tokens: 18,
            cost: 0.000021,
            is_byok: false,
            completion_tokens_details: { reasoning_tokens: 3 },
          },
        }),
      },
    ],
  })

  await sendDraft('Why is the sky blue?')
  await I.see(text(thinkingLabel).wait())
  await I.seeAttribute(button(thinkingLabel), 'aria-expanded', 'false')
  expect(reasoningToggle()?.tagName).toBe('BUTTON')

  const seconds = () => {
    const match = reasoningLabel().match(/Thinking… (\d+)s/)
    return match ? Number(match[1]) : -1
  }
  const seen = seconds()
  await expect.poll(seconds, { timeout: 3_000 }).toBeGreaterThan(seen)
  ;(document.activeElement as HTMLElement | null)?.blur()
  await shoot('thinking')

  await I.click(button(thinkingLabel))
  await I.seeAttribute(button(thinkingLabel), 'aria-expanded', 'true')
  await I.see(text(thought))
  const live = document.querySelector<HTMLElement>('[data-reasoning-text]')
  expect(live?.getAttribute('data-live')).toBe('true')
  expect(getComputedStyle(live!).color).toBe(mutedColor())
  ;(document.activeElement as HTMLElement | null)?.blur()
  await shoot('expanded-live')

  await I.click(button(thinkingLabel))
  await I.seeAttribute(button(thinkingLabel), 'aria-expanded', 'false')
  expect(document.querySelector('[data-reasoning-text]')).toBeNull()

  await expect
    .poll(() => reasoningLabel(), { timeout: 12_000 })
    .toMatch(thoughtLabel)
  const frozen = reasoningLabel()
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  expect(reasoningLabel()).toBe(frozen)
  await I.seeAttribute(button(thoughtLabel), 'aria-expanded', 'false')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await shoot('thought')

  await I.click(button(thoughtLabel))
  await I.see(text(thought))
  expect(
    document.querySelector('[data-reasoning-text]')?.getAttribute('data-live'),
  ).toBe('false')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await shoot('expanded')

  const first = bodies()[0]
  expect(first).not.toHaveProperty('reasoning')
  expect(first).not.toHaveProperty('reasoning_effort')
  expect(JSON.stringify(first)).not.toContain('reasoning_details')

  await expect.poll(() => location.pathname).toMatch(/^\/c\//)
  const chatId = location.pathname.split('/').pop() ?? ''
  await expect.poll(async () => {
    const stored = await repo.listMessages(chatId)
    return stored.some(
      (message) =>
        message.role === 'assistant' &&
        message.status === 'done' &&
        message.reasoning?.text === thought &&
        message.reasoning.endedAt !== null,
    )
  }).toBe(true)

  await reloadApp()
  openChat(chatId)
  await expect.poll(() => reasoningLabel(), { timeout: 8_000 }).toBe(frozen)
  await I.click(button(thoughtLabel))
  await I.see(text(thought))

  mockChatStream(plainTextScript)
  await expect.poll(() => sendButtonLabel()).toBe('Send')
  const captured = bodies().length
  await sendDraft('Say it shorter')
  await expect.poll(() => bodies().length, { timeout: 8_000 }).toBe(captured + 1)
  const echoed = bodies()[captured]!
  expect(echoed).not.toHaveProperty('reasoning')
  expect(echoed).not.toHaveProperty('reasoning_effort')
  expect(echoed.messages?.[1]).toMatchObject({
    role: 'assistant',
    reasoning_details: reasoningDetails,
  })

  activeChat().updateSettings({ params: { reasoningEffort: 'low' } })
  await expect
    .poll(() => activeChat().settings().params.reasoningEffort)
    .toBe('low')
  await expect.poll(() => sendButtonLabel()).toBe('Send')
  mockChatStream(plainTextScript)
  await sendDraft('Try a little harder')
  await expect.poll(() => bodies().length, { timeout: 8_000 }).toBe(captured + 2)
  const effortBody = bodies()[captured + 1]!
  expect(effortBody.reasoning).toEqual({ effort: 'low' })
  expect(effortBody).not.toHaveProperty('reasoning_effort')
  expect(Object.keys(effortBody.reasoning ?? {})).toEqual(['effort'])
  expect(effortBody.messages?.some((message) =>
    Array.isArray(message.reasoning_details),
  )).toBe(true)

  commands.newChat()
  await expect.poll(() => location.pathname).toBe('/')
  mockChatStream(encryptedReasoningScript)
  await sendDraft('Keep this private')
  await I.see(text(hiddenLabel).wait())
  await I.dontSee(text('ciphertext-fixture'))
  await I.dontSee(button(hiddenLabel))
  expect(document.querySelector('[data-reasoning="hidden"] button')).toBeNull()
  expect(document.querySelector('[data-reasoning-text]')).toBeNull()
  expect(document.body.textContent ?? '').not.toContain('ciphertext-fixture')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await shoot('hidden')

  commands.newChat()
  await expect.poll(() => location.pathname).toBe('/')
  mockChatStream({
    hang: true,
    chunks: [{ data: chunk({ reasoning: stoppedThought }) }],
  })
  await sendDraft('Stop midway')
  await expect
    .poll(() => reasoningLabel(), { timeout: 4_000 })
    .toMatch(thinkingLabel)
  await I.see(text(thinkingLabel))
  await I.click(button('Stop'))
  await I.see(text('Stopped while thinking').wait())
  await I.seeAttribute(button('Stopped while thinking'), 'aria-expanded', 'false')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await shoot('stopped-thinking')
  await I.click(button('Stopped while thinking'))
  await I.see(text(stoppedThought))
}, 50_000)

const sendButtonLabel = () =>
  document
    .querySelector<HTMLButtonElement>('[data-slot="Composer"] [data-send]')
    ?.getAttribute('aria-label') ?? ''
