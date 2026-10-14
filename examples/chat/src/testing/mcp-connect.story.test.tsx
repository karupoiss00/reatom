import { button, createActor, role, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import {
  mcpRequiredUrlSentence,
  mcpSchemeSentence,
  mcpTimeoutSentence,
  mcpUnreachableSentence,
  mcpUrlTooLongSentence,
} from '../errors/copy'
import {
  exampleMcpUrl,
  mcpConnectTimeoutMs,
  mcpUrlDraft,
  mcpUrlMaxLength,
} from '../mcp'
import { toast } from '../ui'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import {
  fusionHumanToolNames,
  fusionMcpLocalhostUrl,
  fusionMcpUrl,
  fusionMcpWrongPortUrl,
  fusionToolNames,
  mcpChipLabel,
  mcpPlainReplyScript,
  mcpServerRunningCopy,
  pasteUrlCta,
  reconnectCopy,
} from './fixtures/mcp'
import {
  fusionDocument,
  mcpRequests,
  simulateMcpCorsFail,
  simulateMcpEmptyTools,
  simulateMcpHangConnect,
  simulateMcpQuit,
  simulateMcpWrongPort,
} from './mcp-mock'
import { externalRequests, mockChatStream } from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-mcp-connect'
const miniId = 'openai/gpt-4o-mini'
const miniName = 'OpenAI: GPT-4o-mini'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const pageText = () => document.body.innerText ?? ''

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const settingsDialog = () =>
  document.querySelector<HTMLDialogElement>(
    '[data-slot="AppSettings"] dialog[open], dialog[open]',
  )

const settingsTabLabels = () =>
  [...(settingsDialog()?.querySelectorAll('[role="tab"]') ?? [])].map(
    (tab) => tab.textContent?.trim() ?? '',
  )

const mcpChip = () =>
  document.querySelector<HTMLElement>(
    '[data-mcp-toggle], [data-slot="McpToggle"] [data-mcp-toggle]',
  )

const pasteField = () =>
  [...(settingsDialog()?.querySelectorAll('input, textarea') ?? [])].find(
    (field) => {
      const hint = `${field.getAttribute('placeholder') ?? ''} ${field.getAttribute('aria-label') ?? ''} ${field.getAttribute('name') ?? ''}`
      return /mcp|127\.0\.0\.1/i.test(hint)
    },
  ) ?? null

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const shoot = async (flowId: string, name: string) => {
  toast.clear()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  expect(document.querySelector('[data-toast-key]')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shot(flowId, name)
}

const savedFusionRow = () =>
  document.querySelector('[data-mcp-saved]')

const fieldErrorText = () =>
  settingsDialog()
    ?.querySelector('[data-slot="McpSection"] [data-field-error]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim() ?? ''

const savedMcpSnapshot = () => localStorage.getItem('atelier.mcpServers') ?? ''

const removeButton = () =>
  [...(settingsDialog()?.querySelectorAll('button') ?? [])].find((el) =>
    /^Remove$/i.test(el.textContent?.trim() ?? ''),
  )

const selectedSettingsTab = () =>
  settingsDialog()
    ?.querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent?.trim() ?? ''

const openMcpSettings = async () => {
  await I.click(button('Settings'))
  await expect.poll(() => settingsDialog()?.open ?? false).toBe(true)
  await I.see(role('dialog', 'Settings').wait())
  if (selectedSettingsTab() !== 'MCP') {
    const mcpTab = [...(settingsDialog()?.querySelectorAll('[role="tab"]') ?? [])].find(
      (tab) => tab.textContent?.trim() === 'MCP',
    )
    mcpTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }
  await expect.poll(() => selectedSettingsTab()).toBe('MCP')
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
  resetLocation()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya pastes an MCP URL and turns the chip on (F-29)', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  activeChat().setModel(miniId)
  await expect.poll(() => field()?.placeholder ?? '').toContain(miniName)
  await shoot('F-29', 'header')

  await openMcpSettings()
  expect(settingsTabLabels()).toContain('MCP')
  expect(pasteField(), 'Settings lets Maya paste an MCP URL').toBeTruthy()
  expect(pageText()).toContain(pasteUrlCta)
  expect(pageText()).not.toMatch(/npx|mcp\.json/)
  await shoot('F-29', 'empty')

  const urlField = pasteField() as HTMLInputElement | HTMLTextAreaElement
  urlField.focus()
  mcpUrlDraft.set(fusionMcpLocalhostUrl)
  await expect.poll(() => urlField.value).toBe(fusionMcpLocalhostUrl)
  expect(urlField.value).toContain('localhost:27182')
  await shoot('F-29', 'rewrite')
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect
    .poll(() => mcpRequests().some((entry) => entry.url === fusionMcpUrl))
    .toBe(true)
  expect(mcpRequests().some((entry) => entry.url.includes('localhost'))).toBe(
    false,
  )
  await expect.poll(() => urlField.value).toBe(fusionMcpUrl)
  await expect.poll(() => pageText()).toMatch(/\bread\b/i)
  await shoot('F-29', 'success')

  await I.click(button('Close'))
  await expect.poll(() => mcpChip()).toBeTruthy()
  expect(mcpChip()?.textContent ?? pageText()).toMatch(new RegExp(mcpChipLabel, 'i'))
  expect(mcpChip()?.textContent ?? '').not.toMatch(/^Fusion$/i)
  for (const humanName of fusionHumanToolNames) {
    expect(pageText()).toMatch(new RegExp(`\\b${humanName}\\b`, 'i'))
  }
  expect(pageText()).not.toContain(fusionToolNames.execute)
  await expect.poll(() => mcpChip()?.getAttribute('aria-pressed')).not.toBe('true')
  await shoot('F-29', 'chip')
  mcpChip()?.click()
  await expect.poll(() => mcpChip()?.getAttribute('aria-pressed')).toBe('true')
  await shoot('F-29', 'chip-on')

  simulateMcpEmptyTools()
  await openMcpSettings()
  await expect.poll(() => pasteField()).toBeTruthy()
  await I.click(button(/Reconnect|Connect/i))
  await expect.poll(() => pageText()).toMatch(/no tools|server is running/i)
  expect(mcpChip()?.getAttribute('aria-pressed')).not.toBe('true')
  expect(savedFusionRow()).toBeTruthy()
  expect(removeButton()).toBeTruthy()
  await shoot('F-29', 'empty-tools')
})

test('Maya sees a job error when the MCP server is unreachable (F-32)', async () => {
  simulateMcpCorsFail()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openMcpSettings()
  expect(settingsTabLabels()).toContain('MCP')
  const urlField = pasteField() as HTMLInputElement | HTMLTextAreaElement
  expect(urlField, 'Settings lets Maya paste an MCP URL').toBeTruthy()
  urlField.focus()
  urlField.value = fusionMcpUrl
  urlField.dispatchEvent(new Event('input', { bubbles: true }))
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect
    .poll(() => pageText())
    .toMatch(new RegExp(mcpServerRunningCopy, 'i'))
  expect(pageText()).toContain(reconnectCopy)
  expect(pageText()).toMatch(/browser blocked/i)
  expect(pageText()).not.toMatch(/proxy/i)
  expect(pageText()).not.toMatch(/json-rpc|xmlhttprequest|cors policy/i)
  expect(savedFusionRow()).toBeTruthy()
  expect(removeButton()).toBeTruthy()
  await shoot('F-32', 'cors')

  simulateMcpWrongPort()
  mcpUrlDraft.set(fusionMcpWrongPortUrl)
  urlField.focus()
  await expect.poll(() => urlField.value).toBe(fusionMcpWrongPortUrl)
  await I.click(button(/Connect|Add|Save|Paste|Reconnect/i))
  await expect.poll(() => pageText()).toMatch(/listening on that URL|port is correct/i)
  expect(pageText()).toMatch(new RegExp(mcpServerRunningCopy, 'i'))
  await expect.poll(() => urlField.value).toBe(fusionMcpWrongPortUrl)
  expect(urlField.value).toMatch(/27183/)
  expect(urlField.value).not.toMatch(/:27182\//)
  expect(savedFusionRow()?.textContent).toMatch(/27183/)
  expect(removeButton()).toBeTruthy()
  await shoot('F-32', 'port')

  simulateMcpQuit()
  mcpUrlDraft.set(fusionMcpUrl)
  await expect.poll(() => urlField.value).toBe(fusionMcpUrl)
  await I.click(button(reconnectCopy))
  await expect
    .poll(() => pageText())
    .toMatch(new RegExp(mcpServerRunningCopy, 'i'))
  expect(pageText()).toContain(reconnectCopy)
  expect(activeChat().id).toBeTruthy()
})

test('Maya has no MCP chip until she pastes a server URL (F-35)', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  activeChat().setModel(miniId)
  await expect.poll(() => field()?.placeholder ?? '').toContain(miniName)
  expect(mcpChip()).toBeNull()
  expect(document.querySelector('[data-fusion-cta]')).toBeNull()
  expect(fusionDocument().cubeMm).toBeNull()

  mockChatStream({ chunks: mcpPlainReplyScript })
  await sendDraft('make a 10mm cube in Fusion')
  await expect.poll(() => pageText(), { timeout: 8_000 }).toContain('What would you like to do?')
  await shoot('F-35', 'cta')
  expect(pageText()).not.toMatch(/Connect Fusion/i)
  expect(mcpChip()).toBeNull()
  expect(pageText()).not.toMatch(/npx|mcp\.json/)
  expect(pageText()).not.toMatch(/cube created|created a 10 mm cube/i)
  expect(fusionDocument().cubeMm).toBeNull()
  expect(mcpRequests()).toHaveLength(0)
})

test('Maya sees the MCP timed-out sentence after a hung connect (F-29)', async () => {
  simulateMcpHangConnect()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openMcpSettings()
  expect(settingsTabLabels()).toContain('MCP')
  expect(pasteField(), 'Settings lets Maya paste an MCP URL').toBeTruthy()
  mcpUrlDraft.set(fusionMcpUrl)
  const startedAt = Date.now()
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect
    .poll(() => pageText(), { timeout: mcpConnectTimeoutMs + 4_000 })
    .toContain(mcpTimeoutSentence)
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(mcpConnectTimeoutMs - 500)
  expect(pageText()).toMatch(/timed out/i)
  expect(pageText()).toMatch(new RegExp(mcpServerRunningCopy, 'i'))
  expect(pageText()).not.toMatch(/Fusion checkbox|Fusion timed out/i)
  expect(pageText()).not.toMatch(/connecting…{6,}/i)
  expect(pageText()).not.toMatch(/json-rpc|xmlhttprequest|cors policy/i)
  expect(savedFusionRow()).toBeTruthy()
  expect(removeButton()).toBeTruthy()
  await shoot('F-29', 'hang')
})

test('T-014 empty Connect does not persist the example MCP URL', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openMcpSettings()
  mcpUrlDraft.set('   ')
  await expect.poll(() => (pasteField() as HTMLInputElement).value).toBe('   ')
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect.poll(() => fieldErrorText()).toContain(mcpRequiredUrlSentence)
  expect(pageText()).toMatch(/required|paste an mcp url/i)
  expect(savedMcpSnapshot()).not.toContain(exampleMcpUrl)
  expect(savedFusionRow()).toBeNull()
  expect(mcpRequests()).toHaveLength(0)
})

test('T-015 non-http(s) Connect is refused and never fetched', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openMcpSettings()
  mcpUrlDraft.set('javascript:alert(1)')
  await expect
    .poll(() => (pasteField() as HTMLInputElement).value)
    .toBe('javascript:alert(1)')
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect.poll(() => fieldErrorText()).toContain(mcpSchemeSentence)
  expect(savedMcpSnapshot()).not.toMatch(/javascript:|data:|file:/)
  expect(savedFusionRow()).toBeNull()
  expect(mcpRequests()).toHaveLength(0)
  expect(
    externalRequests().some((entry) =>
      /^(javascript|data|file):/i.test(entry.url),
    ),
  ).toBe(false)
})

test('T-016 a 20k URL is rejected so the saved card cannot blow layout', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openMcpSettings()
  const huge = `http://127.0.0.1:27182/mcp?q=${'x'.repeat(20_000)}`
  mcpUrlDraft.set(huge)
  await expect.poll(() => (pasteField() as HTMLInputElement).value).toBe(huge)
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect.poll(() => fieldErrorText()).toContain(mcpUrlTooLongSentence)
  expect(savedFusionRow()).toBeNull()
  expect(savedMcpSnapshot().length).toBeLessThan(mcpUrlMaxLength * 2)
  expect(mcpRequests()).toHaveLength(0)
})

test('T-017 example.invalid:9 is generic unreachable, not CORS', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openMcpSettings()
  mcpUrlDraft.set('http://example.invalid:9')
  await expect
    .poll(() => (pasteField() as HTMLInputElement).value)
    .toBe('http://example.invalid:9')
  await I.click(button(/Connect|Add|Save|Paste/i))
  await expect.poll(() => pageText()).toContain(mcpUnreachableSentence)
  expect(pageText()).not.toMatch(/browser blocked/i)
  expect(pageText()).toMatch(new RegExp(mcpServerRunningCopy, 'i'))
  expect(fieldErrorText()).not.toContain(mcpUnreachableSentence)
})
