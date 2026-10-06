import axe from 'axe-core'
import { button, createActor, role, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { ui } from '../app/ui'
import { catalogById } from '../catalog'
import { activeChat } from '../chat'
import { openChat } from '../routes'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { visionModelId } from './fixtures/models'
import { providerList } from './fixtures/providers'
import { mockChatStreamFor, mockProviders } from './openrouter-mock'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const phone = { width: 390, height: 844 }
const storyKey = 'sk-or-v1-p1-a11y'
const chatId = 'chat-p1-a11y'
const secondId = 'anthropic/claude-sonnet-4'
const north = 'North light.'
const warm = 'Warm stone.'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

type Violation = {
  screen: string
  id: string
  impact: string | null | undefined
  target: string
  html: string
}

const axeSerious = async (screen: string): Promise<Violation[]> => {
  const results = await axe.run(document.body, { resultTypes: ['violations'] })
  return results.violations.flatMap((violation) => {
    if (violation.impact !== 'serious' && violation.impact !== 'critical') return []
    return violation.nodes.map((node) => ({
      screen,
      id: violation.id,
      impact: violation.impact,
      target: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
      html: node.html.slice(0, 220),
    }))
  })
}

const openDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]')

const closeButton = () =>
  openDialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]') ?? null

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="Composer"] [data-send]')

const searchInput = () =>
  openDialog()?.querySelector<HTMLInputElement>('input[type="search"]') ?? null

const scrollerName = (element: HTMLElement) => {
  const slot = element.getAttribute('data-slot')
  if (slot) return slot
  if (element.hasAttribute('data-dialog-body')) return 'dialog-body'
  if (element instanceof HTMLDialogElement) return 'dialog'
  return element.tagName.toLowerCase()
}

const horizontalOverflow = () => {
  const nodes = [
    document.documentElement,
    document.body,
    document.querySelector('main'),
    document.querySelector('[data-slot="Thread"]'),
    openDialog(),
    openDialog()?.querySelector('[data-dialog-body]') ?? null,
  ]
  return nodes.flatMap((node) => {
    if (!(node instanceof HTMLElement)) return []
    if (node.scrollWidth <= node.clientWidth) return []
    return [
      {
        name: scrollerName(node),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      },
    ]
  })
}

const placed = (element: Element | null, label: string) => {
  if (!element) return { label, missing: true, onScreen: false }
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const onScreen =
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.right <= window.innerWidth + 1 &&
    rect.bottom <= window.innerHeight + 1
  return {
    label,
    onScreen,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    right: Math.round(rect.right),
  }
}

const expectOnScreen = (controls: Array<Element | null>, labels: string[]) => {
  const report = controls.map((element, index) => placed(element, labels[index] ?? 'control'))
  expect(report.filter((item) => !item.onScreen)).toEqual([])
}

const atPhone = async (controls: Array<Element | null>, labels: string[]) => {
  await page.viewport(phone.width, phone.height)
  await settle()
  expect(document.documentElement.clientWidth).toBe(phone.width)
  expect(horizontalOverflow()).toEqual([])
  for (const element of controls) {
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  expectOnScreen(controls, labels)
  await page.viewport(desktop.width, desktop.height)
  await settle()
}

const closeLayers = async () => {
  ui.search.set(false)
  ui.appSettings.set(null)
  ui.chatSettings.set(null)
  ui.picker.set(null)
  await expect.poll(() => openDialog()).toBeNull()
}

const setSearchQuery = (value: string) => {
  const input = searchInput()
  if (!input) throw new Error('missing search input')
  input.focus()
  input.value = value
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
  )
}

const contentChunk = (content: string, id: string, model: string) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model,
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
})

const finishChunk = (id: string, model: string) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model,
  choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
})

const fastScript = (content: string, id: string, model: string) => ({
  firstTokenDelayMs: 40,
  chunks: [
    { data: contentChunk(content, id, model) },
    { delayMs: 40, data: finishChunk(id, model) },
  ],
})

const searchField = () =>
  document.querySelector<HTMLInputElement>('[data-slot="ModelPicker"] input')

const compareSwitch = () =>
  document.querySelector<HTMLInputElement>('[data-testid="model-picker-compare-switch"]')

const pickSecondModel = async () => {
  document.querySelector<HTMLButtonElement>('[data-slot="ModelChip"]')?.click()
  await expect.poll(() => searchField()).toBeTruthy()
  const turnOn = compareSwitch()
  if (turnOn?.getAttribute('aria-pressed') !== 'true') turnOn?.click()
  await expect.poll(() => compareSwitch()?.getAttribute('aria-pressed')).toBe('true')
  const choose = async (modelId: string, query: string) => {
    const field = searchField()
    if (!field) throw new Error('missing search')
    field.focus()
    field.value = query
    field.dispatchEvent(new InputEvent('input', { bubbles: true }))
    const option = () =>
      document.querySelector<HTMLElement>(
        `[data-picker-section="all"] [data-model-id="${modelId}"] [role="option"]`,
      )
    await expect.poll(() => option()).toBeTruthy()
    option()?.click()
  }
  await choose(visionModelId, 'gemini-2.5-flash')
  await choose(secondId, 'claude-sonnet-4')
  await I.press('{Escape}')
  await expect.poll(() => document.querySelector('[data-compare-model]')).toBeTruthy()
}

const pngFile = async () => {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('missing canvas')
  ctx.fillStyle = '#b5532c'
  ctx.fillRect(0, 0, 8, 8)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('png'))), 'image/png')
  })
  return new File([blob], 'shot.png', { type: 'image/png' })
}

const attachPng = async () => {
  const input = document.querySelector<HTMLInputElement>('[data-attachment-input]')
  if (!input) throw new Error('missing file input')
  const transfer = new DataTransfer()
  transfer.items.add(await pngFile())
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await expect
    .poll(() => document.querySelector('[data-attachment-name]')?.textContent ?? '')
    .toBe('shot.png')
}

const seed = [
  {
    id: chatId,
    title: 'Kiln log',
    model: visionModelId,
    messages: [
      { id: 'p1-user', role: 'user' as const, content: 'How should the kiln firing go?' },
      {
        id: 'p1-assistant',
        role: 'assistant' as const,
        content: 'Hold the kiln at cone six.',
        parentId: 'p1-user',
      },
    ],
  },
]

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Ana uses search, routing, compare, and attachments on a phone', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    seed,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  mockProviders(providerList)
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(chatId)
  await I.see(text('Hold the kiln at cone six.').wait())
  await expect.poll(() => catalogById().has(visionModelId)).toBe(true)
  await expect.poll(() => field()?.getAttribute('aria-label') ?? '').toBe('Message')

  const violations: Violation[] = []

  ui.search.set(true)
  await I.see(role('dialog', 'Search chats').options({ timeout: 4_000 }).wait())
  setSearchQuery('kiln')
  await expect
    .poll(() => openDialog()?.querySelector('[data-search-group] mark')?.textContent ?? '', {
      timeout: 4_000,
    })
    .toMatch(/kiln/i)
  await settle()
  violations.push(...(await axeSerious('search')))
  await atPhone(
    [searchInput(), closeButton()],
    ['search', 'close search'],
  )
  await closeLayers()

  ui.chatSettings.set('routing')
  await I.see(
    text('Allow fallbacks').within(role('dialog', 'Chat settings')).options({ timeout: 4_000 }).wait(),
  )
  await expect
    .poll(() => document.querySelector('[data-providers-state]')?.getAttribute('data-providers-state'))
    .toBe('ready')
  await settle()
  violations.push(...(await axeSerious('routing')))
  await atPhone(
    [
      closeButton(),
      document.querySelector('[data-slot="RoutingSection"] [role="radiogroup"]'),
      document.querySelector('[data-slot="RoutingSection"] input[type="checkbox"]'),
    ],
    ['close routing', 'routing mode', 'allow fallbacks'],
  )
  await closeLayers()

  await expect
    .poll(() => document.querySelector<HTMLButtonElement>('[data-attachment-trigger]')?.getAttribute('aria-disabled'))
    .toBe('false')
  await attachPng()
  await I.see(text('shot.png').wait())
  await settle()
  violations.push(...(await axeSerious('attachments')))
  await atPhone(
    [
      document.querySelector('[data-attachment-trigger]'),
      field(),
      sendButton(),
      document.querySelector('button[aria-label="Remove shot.png"]'),
    ],
    ['attach', 'message', 'send', 'remove attachment'],
  )
  document.querySelector<HTMLButtonElement>('button[aria-label="Remove shot.png"]')?.click()
  await expect.poll(() => document.querySelector('[data-attachment-chip]')).toBeNull()

  await pickSecondModel()
  await I.see(text(/Sends 2 requests/).wait())
  mockChatStreamFor(visionModelId, fastScript(north, 'gen-p1-gemini', visionModelId))
  mockChatStreamFor(secondId, fastScript(warm, 'gen-p1-claude', secondId))
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set('Compare the north light')
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
  await I.see(text(north).options({ timeout: 8_000 }).wait())
  await I.see(text(warm).options({ timeout: 8_000 }).wait())
  await expect.poll(() => document.querySelector('[data-slot="CompareColumns"]')).toBeTruthy()
  await settle()
  violations.push(...(await axeSerious('compare')))
  await page.viewport(phone.width, phone.height)
  await settle()
  await expect
    .poll(() => document.querySelectorAll('[data-slot="CompareColumns"] [role="tab"]').length)
    .toBe(2)
  violations.push(...(await axeSerious('compare')))
  expect(document.documentElement.clientWidth).toBe(phone.width)
  expect(horizontalOverflow()).toEqual([])
  const tabs = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="CompareColumns"] [role="tab"]'),
  ]
  for (const tab of tabs) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  sendButton()?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  expectOnScreen(
    [tabs[0] ?? null, tabs[1] ?? null, sendButton()],
    ['first compare tab', 'second compare tab', 'send'],
  )

  expect(violations).toEqual([])
}, 120_000)
