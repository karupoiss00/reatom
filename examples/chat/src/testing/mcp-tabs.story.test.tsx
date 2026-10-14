import { button, createActor, role, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat, getChatModel } from '../chat'
import { connectMcp } from '../mcp'
import { mcpAlwaysAllow } from '../mcp/busy'
import { openChat } from '../routes'
import { createDefaultChatSettings } from '../storage/records'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import {
  allowOnceLabel,
  callingMcp,
  cubeAsk,
  cubeFollowUpScript,
  cubeToolCallScript,
  fusionMcpUrl,
  fusionToolNames,
  mcpBusyCopy,
  mcpChipLabel,
  pasteUrlCta,
} from './fixtures/mcp'
import {
  mcpExecuteCalls,
  mcpMethods,
  simulateMcpCallDelay,
} from './mcp-mock'
import { mockChatStreams } from './openrouter-mock'
import { shot } from './screenshot'
import { closeAllTabs, openTab } from './tabs/harness'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-mcp-tabs'
const chatA = 'chat-mcp-a'
const chatB = 'chat-mcp-b'
const miniId = 'openai/gpt-4o-mini'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))
const inFlightMs = 800
const cleanups: Array<() => void> = []

const keyboard = userEvent.setup() as unknown as UserEvent

const settingsDialog = () =>
  document.querySelector<HTMLDialogElement>(
    '[data-slot="AppSettings"] dialog[open], dialog[open]',
  )

const settingsTabLabels = () =>
  [...(settingsDialog()?.querySelectorAll('[role="tab"]') ?? [])].map(
    (tab) => tab.textContent?.trim() ?? '',
  )

const selectedSettingsTab = () =>
  settingsDialog()
    ?.querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent?.trim() ?? ''

const mcpPanel = () =>
  settingsDialog()?.querySelector<HTMLElement>('[data-slot="McpSection"]') ??
  null

const pasteField = () => {
  const panel = mcpPanel()
  if (!panel) return null
  return (
    [...panel.querySelectorAll('input, textarea')].find((field) => {
      const hint = `${field.getAttribute('placeholder') ?? ''} ${field.getAttribute('aria-label') ?? ''} ${field.getAttribute('name') ?? ''}`
      return /mcp|127\.0\.0\.1/i.test(hint)
    }) ?? null
  )
}

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shot(flowId, name)
}

const mcpChip = () =>
  document.querySelector<HTMLElement>(
    '[data-mcp-toggle], [data-slot="McpToggle"] [data-mcp-toggle]',
  )

const pageText = () => document.body.innerText ?? ''

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const sendDraft = async (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
}

const mcpEnabledSettings = () => ({
  ...createDefaultChatSettings(),
  mcpEnabled: true,
})

const mcpToolCalls = () =>
  mcpMethods().filter((method) => method === 'tools/call').length

const readAsk = 'what is in the open document'

const readToolCallScript = [
  {
    data: {
      id: 'gen-mcp-read-tabs',
      object: 'chat.completion.chunk',
      created: 1_710_000_000,
      model: miniId,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_mcp_read_tabs',
                type: 'function',
                function: { name: fusionToolNames.read, arguments: '{}' },
              },
            ],
          },
          finish_reason: 'tool_calls' as const,
        },
      ],
    },
  },
]

const readFollowUpScript = [
  {
    data: {
      id: 'gen-mcp-read-tabs-done',
      object: 'chat.completion.chunk',
      created: 1_710_000_000,
      model: miniId,
      choices: [
        {
          index: 0,
          delta: { content: 'The open document is still empty.' },
          finish_reason: 'stop' as const,
        },
      ],
    },
  },
]

const bootTwoTabs = async () => {
  await bootApp({
    key: storyKey,
    remember: true,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: chatA,
        title: 'Tab A thread',
        model: miniId,
        settings: mcpEnabledSettings(),
      },
      {
        id: chatB,
        title: 'Tab B thread',
        model: miniId,
        settings: mcpEnabledSettings(),
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await connectMcp(fusionMcpUrl)
  openChat(chatA)
  getChatModel(chatA).updateSettings({ mcpEnabled: true })
  await expect.poll(() => mcpChip()).toBeTruthy()
  expect(mcpChip()?.textContent ?? '').toMatch(new RegExp(mcpChipLabel, 'i'))
  expect(mcpChip()?.textContent ?? '').not.toMatch(/^Fusion$/i)

  const tab = await openTab()
  cleanups.push(() => tab.remove())
  await tab.call({
    type: 'boot',
    key: storyKey,
    remember: true,
    keyMeta: limitedKey,
  })
  expect((await tab.call({ type: 'connect-mcp', url: fusionMcpUrl })).ready).toBe(
    true,
  )
  await tab.call({ type: 'enable-mcp', chatId: chatB })
  await tab.call({ type: 'open', chatId: chatB })
  await expect
    .poll(async () => (await tab.call({ type: 'state' })).mcpChip)
    .toMatch(new RegExp(mcpChipLabel, 'i'))
  expect((await tab.call({ type: 'state' })).mcpChip).not.toMatch(/^Fusion$/i)
  return tab
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  closeAllTabs()
  unmountApp()
  if (location.pathname !== '/') history.replaceState(null, '', '/')
  await page.viewport(desktop.width, desktop.height)
})

const headerSettingsControl = () =>
  document.querySelector<HTMLElement>(
    '[data-slot="ChatHeader"] [data-slot="AppSettingsOpen"]',
  )

const isOnscreen = (element: HTMLElement) => {
  const box = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return (
    box.width > 8 &&
    box.height > 8 &&
    box.right > 0 &&
    box.bottom > 0 &&
    box.left < window.innerWidth &&
    box.top < window.innerHeight &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  )
}

test('Signed-in Settings includes an MCP paste field (F-38)', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  const settingsControl = headerSettingsControl()
  expect(
    settingsControl,
    'signed-in chat header has a Settings control',
  ).toBeTruthy()
  expect(settingsControl?.textContent?.trim()).toBe('Settings')
  expect(isOnscreen(settingsControl!), 'Settings is visible at 1280 width').toBe(
    true,
  )
  await shoot('F-38', 'header')

  await I.click(button('Settings'))
  await expect.poll(() => settingsDialog()?.open ?? false).toBe(true)
  await I.see(role('dialog', 'Settings').wait())
  expect(settingsTabLabels()).toContain('MCP')
  await expect
    .poll(() => selectedSettingsTab())
    .toBe('MCP')

  const panel = mcpPanel()
  expect(panel, 'MCP panel is visible after opening the MCP tab').toBeTruthy()
  await expect.poll(() => pasteField()).toBeTruthy()
  const urlField = pasteField()
  expect(urlField, 'MCP panel has a Streamable HTTP URL paste field').toBeTruthy()
  expect(panel?.contains(urlField)).toBe(true)
  expect(urlField?.getAttribute('name')).toBe('mcp')
  expect(urlField?.getAttribute('placeholder')).toBe(fusionMcpUrl)
  expect(panel?.textContent).toContain(pasteUrlCta)
  expect(panel?.textContent).toMatch(/example/i)
  expect(panel?.textContent).not.toMatch(/Fusion MCP|Fusion checkbox/i)
  expect(panel?.textContent).not.toMatch(/npx|mcp\.json/)
  await shoot('F-38', 'settings')
})

test('Allow in tab A does not Allow in tab B on the same saved MCP server (F-38)', async () => {
  const tab = await bootTwoTabs()

  mockChatStreams([readToolCallScript, readFollowUpScript])
  await sendDraft(readAsk)
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain(allowOnceLabel)
  expect(pageText()).toMatch(/\bAlways\b/)
  await I.click(button('Always'))
  await expect.poll(() => mcpAlwaysAllow().has(fusionToolNames.read)).toBe(true)
  await expect.poll(() => mcpToolCalls()).toBeGreaterThan(0)

  await tab.call({
    type: 'mock-streams',
    scripts: [readToolCallScript, readFollowUpScript],
  })
  await tab.call({ type: 'send', chatId: chatB, text: readAsk })
  await expect
    .poll(async () => (await tab.call({ type: 'state' })).mcpToolCard, {
      timeout: 8_000,
    })
    .toContain(allowOnceLabel)
  const tabState = await tab.call({ type: 'state' })
  expect(
    tabState.mcpAlways,
    'Always in A is not Always in B',
  ).not.toContain(fusionToolNames.read)
  expect(tabState.mcpToolCalls, 'tab B did not auto-run the remembered read').toBe(
    0,
  )
  expect(tabState.mcpToolCard).not.toMatch(/open document is still empty/i)
  expect(mcpChip()?.textContent ?? '').not.toMatch(/^Fusion$/i)
  expect(tabState.mcpChip).not.toMatch(/^Fusion$/i)
  await shoot('F-38', 'allow-isolated')
})

test('A second in-flight MCP call is busy and does not run both silently (F-38)', async () => {
  const tab = await bootTwoTabs()

  mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
  await sendDraft(cubeAsk)
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain(allowOnceLabel)

  await tab.call({
    type: 'mock-streams',
    scripts: [cubeToolCallScript, cubeFollowUpScript],
  })
  await tab.call({ type: 'send', chatId: chatB, text: cubeAsk })
  await expect
    .poll(async () => (await tab.call({ type: 'state' })).mcpToolCard, {
      timeout: 8_000,
    })
    .toContain(allowOnceLabel)

  simulateMcpCallDelay(inFlightMs)
  await tab.call({ type: 'mcp-delay', delayMs: inFlightMs })
  expect(mcpExecuteCalls()).toHaveLength(0)
  expect((await tab.call({ type: 'state' })).mcpExecutes).toBe(0)

  await I.click(button(allowOnceLabel))
  await expect.poll(() => pageText()).toContain(callingMcp)
  expect(pageText()).not.toMatch(/Calling Fusion/i)

  await tab.call({ type: 'click', text: allowOnceLabel })

  await expect
    .poll(async () => {
      if (mcpExecuteCalls().length > 0) return ''
      return (await tab.call({ type: 'state' })).mcpToolCard ?? ''
    }, { timeout: 2_000 })
    .toContain(mcpBusyCopy)
  expect(mcpExecuteCalls(), 'A is still in-flight while B shows busy').toHaveLength(
    0,
  )
  const busy = await tab.call({ type: 'state' })
  expect(busy.mcpBusy, 'tab B is busy while A is in flight').toBe(true)
  expect(busy.mcpAllowDisabled).toBe(true)
  expect(busy.mcpToolCard).toContain(allowOnceLabel)
  expect(busy.mcpToolCard).toContain(mcpBusyCopy)
  expect(busy.mcpToolCard).not.toMatch(/Fusion busy/i)
  expect(busy.mcpExecutes).toBe(0)
  expect(busy.mcpToolCalls).toBe(0)
  await shoot('F-38', 'busy')

  await expect.poll(() => mcpExecuteCalls().length, { timeout: 8_000 }).toBe(1)
  await settle()
  const after = await tab.call({ type: 'state' })
  expect(
    mcpExecuteCalls().length + after.mcpExecutes,
    'the second in-flight call did not run both silently',
  ).toBe(1)
  expect(after.mcpBusy, 'tab B is not leftover-busy after A finishes').toBe(
    false,
  )
  expect(after.mcpAllowDisabled).toBe(false)
  expect(after.mcpExecutes).toBe(0)
  expect(after.mcpToolCalls).toBe(0)
  expect(after.mcpToolCard).toContain(allowOnceLabel)
  expect(after.mcpToolCard).not.toMatch(/busy/i)
  expect(after.mcpToolCard).not.toMatch(/Fusion busy/i)
  expect(after.mcpToolCard).not.toMatch(/Created a 10 mm cube/i)
  expect(mcpChip()?.textContent ?? '').not.toMatch(/^Fusion$/i)
})
