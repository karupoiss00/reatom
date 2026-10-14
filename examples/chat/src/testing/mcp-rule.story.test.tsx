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
  exportAsk,
  exportToolCallScript,
  fusionMcpUrl,
  fusionQuitFollowUpScript,
  widthAsk,
  widthToolCallScript,
} from './fixtures/mcp'
import {
  fusionDocument,
  mcpExecuteCalls,
  simulateMcpCallDelay,
  simulateMcpQuitMidTool,
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
const storyKey = 'sk-or-v1-mcp-rule'
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
    '[data-mcp-toggle], [data-slot="McpToggle"] [data-mcp-toggle]',
  )

const toolCard = () =>
  document.querySelector<HTMLElement>(
    '[data-mcp-tool-card], [data-fusion-tool-card], [data-tool-card]',
  )

const alwaysButtons = () =>
  [...document.querySelectorAll('button')].filter(
    (el) => el.textContent?.trim() === 'Always',
  )

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shot(flowId, name)
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

test('Maya allows a Fusion execute and sees the cube (F-30)', async () => {
  await bootMaya()

  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  simulateMcpCallDelay(80)
  await sendDraft(cubeAsk)
  await shoot('F-30', 'card')
  expect(pageText()).toContain(allowOnceLabel)
  expect(toolCard()).toBeTruthy()
  expect(pageText()).toMatch(/Fusion/i)
  expect(pageText()).toMatch(/\bexecute\b/i)
  expect(pageText()).not.toMatch(/anonymous function|"function"/i)
  const intent = toolCard()?.querySelector('[data-mcp-tool-intent]')?.textContent ?? ''
  expect(intent).toMatch(/10\s*mm cube/i)
  expect(intent).not.toMatch(/with the arguments below/i)
  expect(fusionDocument().cubeMm).toBeNull()

  await I.click(button(allowOnceLabel))
  await expect.poll(() => pageText()).toContain(callingMcp)
  expect(pageText()).not.toMatch(/Calling Fusion/i)
  await expect.poll(() => fusionDocument().cubeMm).toBe(10)
  await expect.poll(() => pageText()).toMatch(/10 mm cube/i)
  await expect
    .poll(() => toolCard()?.querySelector('[data-mcp-tool-result]')?.textContent ?? '')
    .toMatch(/Created a 10 mm cube/i)
  expect(toolCard()?.querySelector('[data-mcp-tool-result]')?.textContent ?? '').not.toBe(
    'Completed',
  )
  await shoot('F-30', 'success')
})

test('Maya does not see Always on update or export writes (F-31)', async () => {
  await bootMaya()

  mockChatStreams([widthToolCallScript, exportToolCallScript])
  await sendDraft(widthAsk)
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain(allowOnceLabel)
  expect(alwaysButtons()).toHaveLength(0)
  expect(toolCard()?.querySelector('[data-mcp-tool-intent]')?.textContent ?? '').toMatch(
    /Width/i,
  )

  await sendDraft(exportAsk)
  await expect.poll(() => pageText(), { timeout: 8_000 }).toMatch(/STEP|export/i)
  expect(alwaysButtons()).toHaveLength(0)
})

test('Maya denies a Fusion execute and Always stays hidden (F-31)', async () => {
  await bootMaya()

  mockChatStreams([cubeToolCallScript, cubeDeniedFollowUpScript])
  await sendDraft(cubeAsk)
  await shoot('F-31', 'waiting')
  expect(pageText()).toContain(allowOnceLabel)
  expect(pageText()).toContain(denyLabel)
  expect(alwaysButtons()).toHaveLength(0)
  expect(pageText()).not.toMatch(/Always allow/i)

  await I.click(button(denyLabel))
  await expect.poll(() => pageText()).toMatch(/did not run/i)
  expect(fusionDocument().cubeMm).toBeNull()
  expect(mcpExecuteCalls()).toHaveLength(0)
  expect(alwaysButtons()).toHaveLength(0)
  await shoot('F-31', 'denied')
})

test('Maya recovers when Fusion quits mid-execute (F-37)', async () => {
  await bootMaya()

  mockChatStreams([cubeToolCallScript, fusionQuitFollowUpScript])
  simulateMcpQuitMidTool()
  await sendDraft(cubeAsk)
  await shoot('F-37', 'calling')
  expect(pageText()).toContain(allowOnceLabel)
  await I.click(button(allowOnceLabel))
  await expect
    .poll(() => pageText(), { timeout: 8_000 })
    .toMatch(/Reconnect|stopped|checkbox/i)
  expect(pageText()).not.toMatch(/you denied|Denied this/i)
  expect(pageText()).not.toMatch(/cube created/i)
  expect(fusionDocument().cubeMm).toBeNull()
})

test('Maya’s pending Allow survives a refresh without auto-running (F-39)', async () => {
  await bootMaya()

  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  await sendDraft(cubeAsk)
  await shoot('F-39', 'waiting')
  expect(pageText()).toContain(allowOnceLabel)
  expect(fusionDocument().cubeMm).toBeNull()
  expect(mcpExecuteCalls()).toHaveLength(0)

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
  expect(mcpExecuteCalls()).toHaveLength(0)
  expect(fusionDocument().cubeMm).toBeNull()
  expect(pageText()).not.toMatch(/cube created/i)
  await shoot('F-39', 'after-refresh')
})
