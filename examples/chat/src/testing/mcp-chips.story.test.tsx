import { button, createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { connectMcp } from '../mcp'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { citationsScript } from './fixtures/sse'
import {
  allowOnceLabel,
  cubeAsk,
  cubeFollowUpScript,
  cubeToolCallScript,
  fusionMcpUrl,
  mcpChipLabel,
  nileAsk,
} from './fixtures/mcp'
import { fusionDocument } from './mcp-mock'
import { mockChatStream, mockChatStreams } from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-mcp-chips'
const miniId = 'openai/gpt-4o-mini'
const miniName = 'OpenAI: GPT-4o-mini'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const pageText = () => document.body.innerText ?? ''

const webToggle = () =>
  document.querySelector<HTMLButtonElement>('[data-web-search-toggle]')

const mcpChip = () =>
  document.querySelector<HTMLElement>(
    '[data-mcp-toggle], [data-slot="McpToggle"] [data-mcp-toggle]',
  )

const sourcesRoot = () => document.querySelector('[data-slot="Sources"]')

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

afterEach(async () => {
  unmountApp()
  if (location.pathname !== '/') history.replaceState(null, '', '/')
  await page.viewport(desktop.width, desktop.height)
})

test('Maya keeps Fusion cards and web citations on separate asks (F-36)', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  activeChat().setModel(miniId)
  await expect.poll(() => field()?.placeholder ?? '').toContain(miniName)
  await expect.poll(() => webToggle()).toBeTruthy()
  await connectMcp(fusionMcpUrl)
  await expect.poll(() => mcpChip()).toBeTruthy()
  await shoot('F-36', 'empty')
  expect(mcpChip(), 'MCP chip is available beside web search').toBeTruthy()
  expect(mcpChip()?.textContent ?? '').toMatch(new RegExp(mcpChipLabel, 'i'))
  expect(mcpChip()?.textContent ?? '').not.toMatch(/^Fusion$/i)
  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  mcpChip()?.click()
  await expect.poll(() => mcpChip()?.getAttribute('aria-pressed')).toBe('true')
  await shoot('F-36', 'both-on')

  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain(allowOnceLabel)
  expect(pageText()).toMatch(/Fusion/i)
  expect(sourcesRoot()).toBeNull()
  await I.click(button(allowOnceLabel))
  await expect.poll(() => fusionDocument().cubeMm).toBe(10)
  await shoot('F-36', 'fusion-card')

  mockChatStream({ chunks: citationsScript })
  await sendDraft(nileAsk)
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain('See sources')
  expect(sourcesRoot()?.textContent ?? '').toContain('Alpha')
  await shoot('F-36', 'web-citations')

  mcpChip()?.click()
  await expect.poll(() => mcpChip()?.getAttribute('aria-pressed')).toBe('false')
  mockChatStream({ chunks: citationsScript })
  await sendDraft('What is the Nile’s length?')
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain('See sources')
  expect(pageText()).not.toContain(allowOnceLabel)
})
