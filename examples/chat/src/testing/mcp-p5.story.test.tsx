import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import { connectMcp } from '../mcp'
import { resetRuntime } from '../platform/runtime'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
import {
  allowOnceLabel,
  callingMcp,
  cubeAsk,
  cubeDeniedFollowUpScript,
  cubeFollowUpScript,
  cubeToolCallScript,
  denyLabel,
  fusionMcpUrl,
  longToolCallScript,
} from './fixtures/mcp'
import {
  fusionDocument,
  mcpExecuteCalls,
  simulateMcpCallDelay,
} from './mcp-mock'
import {
  installOpenRouterMock,
  mockChatStreams,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-mcp-p5'
const miniId = 'openai/gpt-4o-mini'
const miniName = 'OpenAI: GPT-4o-mini'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const pageText = () => document.body.innerText ?? ''

let extraUnmount: (() => void) | null = null

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const mcpChip = () =>
  document.querySelector<HTMLElement>(
    '[data-mcp-toggle], [data-fusion-toggle], [data-fusion-chip]',
  )

const webToggle = () =>
  document.querySelector<HTMLButtonElement>('[data-web-search-toggle]')

const toolCard = () =>
  document.querySelector<HTMLElement>(
    '[data-mcp-tool-card], [data-fusion-tool-card], [data-tool-card]',
  )

const alwaysButtons = () =>
  [...document.querySelectorAll('button')].filter(
    (el) => el.textContent?.trim() === 'Always',
  )

const allowButtons = () =>
  [...document.querySelectorAll('button')].filter(
    (el) => el.textContent?.trim() === allowOnceLabel,
  )

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shot('phase5', name)
}

const sendDraft = async (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
}

const bootMaya = async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  activeChat().setModel(miniId)
  await expect
    .poll(() => field()?.placeholder ?? '', { timeout: 8_000 })
    .toContain(miniName)
  await connectMcp(fusionMcpUrl)
  await expect.poll(() => mcpChip()).toBeTruthy()
  mcpChip()?.click()
  await expect.poll(() => mcpChip()?.getAttribute('aria-pressed')).toBe('true')
}

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  resetLocation()
  await page.viewport(desktop.width, desktop.height)
})

test('P5 double Allow runs the write once (F-30)', async () => {
  await bootMaya()
  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  simulateMcpCallDelay(80)
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText()).toContain(allowOnceLabel)
  expect(alwaysButtons()).toHaveLength(0)
  const first = allowButtons()[0]
  first?.click()
  first?.click()
  await settle()
  await shoot('double-allow')
  expect(pageText()).not.toMatch(/busy/i)
  expect(mcpExecuteCalls()).toHaveLength(1)
  expect(fusionDocument().cubeMm).toBe(10)
})

test('P5 Deny then Allow does not run (F-31)', async () => {
  await bootMaya()
  mockChatStreams([cubeToolCallScript, cubeDeniedFollowUpScript])
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText()).toContain(denyLabel)
  await I.click(button(denyLabel))
  await expect.poll(() => pageText()).toMatch(/did not run/i)
  const leftoverAllow = allowButtons()[0]
  leftoverAllow?.click()
  await shoot('deny-then-allow')
  expect(fusionDocument().cubeMm).toBeNull()
  expect(mcpExecuteCalls()).toHaveLength(0)
  expect(pageText()).not.toMatch(/cube created/i)
})

test('P5 Always is absent on execute even with both chips on (F-31 F-36)', async () => {
  await bootMaya()
  await expect.poll(() => webToggle()).toBeTruthy()
  webToggle()?.click()
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText()).toContain(allowOnceLabel)
  await shoot('always-hunt-both-chips')
  expect(alwaysButtons()).toHaveLength(0)
  expect(pageText()).not.toMatch(/Always allow/i)
  expect(mcpExecuteCalls()).toHaveLength(0)
})

test('P5 chip off mid-card does not auto-run (F-36)', async () => {
  await bootMaya()
  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText()).toContain(allowOnceLabel)
  mcpChip()?.click()
  await expect.poll(() => mcpChip()?.getAttribute('aria-pressed')).toBe('false')
  await shoot('chip-off-mid-card')
  expect(toolCard()).toBeTruthy()
  expect(pageText()).toContain(allowOnceLabel)
  expect(fusionDocument().cubeMm).toBeNull()
  expect(mcpExecuteCalls()).toHaveLength(0)
})

test('P5 refresh mid-Allow does not auto-run (F-39)', async () => {
  await bootMaya()
  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  simulateMcpCallDelay(1_200)
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText()).toContain(allowOnceLabel)
  await I.click(button(allowOnceLabel))
  await expect.poll(() => pageText()).toContain(callingMcp)
  await shoot('refresh-mid-allow-calling')

  unmountApp()
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(fixtureModels)
  mockKey(limitedKey)
  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })

  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain(allowOnceLabel)
  await shoot('refresh-mid-allow-after')
  expect(mcpExecuteCalls()).toHaveLength(0)
  expect(fusionDocument().cubeMm).toBeNull()
  expect(pageText()).not.toMatch(/cube created/i)
  await new Promise((resolve) => setTimeout(resolve, 1_400))
  await shoot('refresh-mid-allow-late')
  expect(mcpExecuteCalls()).toHaveLength(0)
  expect(fusionDocument().cubeMm).toBeNull()
})

test('P5 very long args stay on a waiting card (F-30)', async () => {
  await bootMaya()
  mockChatStreams([longToolCallScript, cubeFollowUpScript])
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText()).toContain(allowOnceLabel)
  await shoot('long-args')
  const intent =
    toolCard()?.querySelector('[data-mcp-tool-intent]')?.textContent ?? ''
  expect(intent.length).toBeLessThan(400)
  expect(intent).not.toContain('x'.repeat(80))
  expect(alwaysButtons()).toHaveLength(0)
  expect(mcpExecuteCalls()).toHaveLength(0)
})
