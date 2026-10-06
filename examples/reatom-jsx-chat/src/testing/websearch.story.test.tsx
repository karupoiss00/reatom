import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import { formatUsd } from '../money'
import { resetRuntime } from '../platform/runtime'
import { activeChatId, openChat } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
import { citationsScript } from './fixtures/sse'
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
const storyKey = 'sk-or-v1-websearch-story'
const miniId = 'openai/gpt-4o-mini'
const miniName = 'OpenAI: GPT-4o-mini'
const noPriceId = 'google/gemini-2.5-pro'
const webSearchPrice = 0.014
const pricedNotice = `Web search adds about ${formatUsd(webSearchPrice)} per search on ${miniName}, plus extra input tokens.`
const mayAddCost = 'Web search may add cost'
const webSearchLine = `+ web search ${formatUsd(webSearchPrice)}`
const zdrSentence = "Web search isn't available with zero data retention."
const sendWithout = 'Send without web search'
const nile = 'Where does the Nile start?'
const quietFact = 'Tell me a quiet fact.'
const plainReply = 'Moss prefers shade.'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

let online = true
let onlineDefined = false
let extraUnmount: (() => void) | null = null

const installOnline = () => {
  online = true
  onlineDefined = true
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => online,
  })
}

const setOnline = (next: boolean) => {
  online = next
  window.dispatchEvent(new Event(next ? 'online' : 'offline'))
}

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const pageText = () => document.body.textContent ?? ''

const webToggle = () =>
  document.querySelector<HTMLButtonElement>('[data-web-search-toggle]')

const webChip = () => document.querySelector('[data-web-chip]')

const webNotice = () => document.querySelector('[data-web-search-notice]')

const estimateLines = () =>
  [...document.querySelectorAll('[data-estimate-line]')].map(
    (node) => node.textContent ?? '',
  )

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const sourcesRoot = () => document.querySelector('[data-slot="Sources"]')

const fullyVisible = (element: Element | null) => {
  expect(element).toBeTruthy()
  const box = element!.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(box.top).toBeGreaterThanOrEqual(-1)
  expect(box.left).toBeGreaterThanOrEqual(-1)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1)
}

const shoot = async (name: string, element: Element | null) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  element?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  fullyVisible(element)
  await shot('F-21', name)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
}

const asRecord = (body: unknown) =>
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

const expectWebTool = (body: unknown) => {
  const record = asRecord(body)
  expect(record.tools).toEqual([{ type: 'openrouter:web_search' }])
  expect(String(record.model ?? '')).not.toContain(':online')
  expect(record.plugins).toBeUndefined()
  expect(JSON.stringify(record)).not.toContain(':online')
  expect(JSON.stringify(record)).not.toContain('"id":"web"')
}

const expectNoWebTool = (body: unknown) => {
  const record = asRecord(body)
  const encoded = JSON.stringify(record)
  expect(encoded).not.toContain('openrouter:web_search')
  expect(encoded).not.toContain(':online')
  expect(encoded).not.toContain('"id":"web"')
  expect(record.plugins).toBeUndefined()
}

const doneChunk = (content: string, id: string) => ({
  data: {
    id,
    object: 'chat.completion.chunk',
    created: 1710000000,
    model: miniId,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: 'stop' as const,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
      cost: 0.000012,
      is_byok: false,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  },
})

const zdrStatus = {
  status: 400,
  body: {
    error: {
      code: 400,
      message: 'Web search cannot be used with zero data retention',
    },
  },
}

const sidebarButton = (label: string) => {
  const match = [...document.querySelectorAll('[data-slot="Sidebar"] button')].find(
    (el) => el.textContent?.includes(label),
  )
  return match instanceof HTMLButtonElement ? match : null
}

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const sendDraft = async (value: string) => {
  setDraft(value)
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
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
  installOnline()
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
  if (onlineDefined) setOnline(true)
  await page.viewport(desktop.width, desktop.height)
})

test('Ana turns on web search, reads citations, and recovers from ZDR', async () => {
  resetLocation()
  installOnline()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  activeChat().setModel(miniId)
  await expect.poll(() => field()?.placeholder ?? '').toContain(miniName)

  expect(webToggle()?.getAttribute('aria-pressed')).toBe('false')
  expect(webChip()).toBeNull()
  expect(webNotice()).toBeNull()
  expect(estimateLines().join('\n')).not.toContain('web search')
  expect(pageText()).not.toContain(mayAddCost)
  await shoot('off', webToggle())

  await I.click(button('Web search'))
  await expect.poll(() => webNotice()?.textContent ?? '').toContain(pricedNotice)
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(estimateLines()).toContain(webSearchLine)
  await shoot('notice', webNotice())

  activeChat().setModel(noPriceId)
  await expect.poll(() => webNotice()).toBeNull()
  expect(estimateLines()).not.toContain(mayAddCost)
  expect(estimateLines()).not.toContain(webSearchLine)
  expect(
    document.querySelector('[data-cost-notes], [data-web-search-notice]')
      ?.textContent ?? '',
  ).not.toContain(mayAddCost)
  expect(
    document.querySelector('[data-slot="WebSearchToggle"] [role="tooltip"]')
      ?.textContent ?? '',
  ).toContain(mayAddCost)

  activeChat().setModel(miniId)
  await expect.poll(() => webNotice()?.textContent ?? '').toContain(pricedNotice)
  expect(pageText()).not.toContain(mayAddCost)

  await I.click(button('Dismiss'))
  await expect.poll(() => webNotice()).toBeNull()
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(estimateLines()).toContain(webSearchLine)
  await shoot('on', webToggle())

  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('false')
  expect(webChip()).toBeNull()
  expect(webNotice()).toBeNull()
  expect(estimateLines().join('\n')).not.toContain('web search')
  expect(pageText()).not.toContain(mayAddCost)

  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webNotice()).toBeNull()
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(estimateLines()).toContain(webSearchLine)

  const postsBeforeSearch = chatBodies().length
  mockChatStream({
    chunks: [{ comment: true, delayMs: 5000 }, ...citationsScript],
  })
  await sendDraft(nile)
  await expect
    .poll(() => pageText(), { timeout: 4000 })
    .toContain('Searching the web…')
  await shoot('searching', document.querySelector('[data-web-search-status]'))
  await expect.poll(() => pageText(), { timeout: 8000 }).toContain('See sources')
  await expect.poll(() => sourcesRoot()?.textContent ?? '').toContain('Alpha')
  expect(pageText()).not.toContain('Missing url')
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const marks = [...(sourcesRoot()?.querySelectorAll('sup') ?? [])].map((node) =>
    node.textContent?.trim(),
  )
  expect(marks).toEqual(['1'])
  expect(sourcesRoot()?.textContent).toContain('Sources')
  expect(sourcesRoot()?.textContent).toContain('example.com')
  expect(sourcesRoot()?.textContent).toContain('Alpha')
  const sourceLink = sourcesRoot()?.querySelector('a')
  expect(sourceLink?.getAttribute('href')).toBe('https://example.com/a')
  expect(sourceLink?.getAttribute('target')).toBe('_blank')
  expect(sourceLink?.getAttribute('rel')).toContain('noopener')
  await expect
    .poll(() => chatBodies().length, { timeout: 8000 })
    .toBe(postsBeforeSearch + 1)
  expectWebTool(chatBodies().at(-1))
  expect(estimateLines()).toContain(webSearchLine)
  await shoot('sources', sourcesRoot()?.querySelector('[data-sources]') ?? null)

  const searchedChatId = activeChatId()
  expect(searchedChatId).not.toBe('new')
  await expect
    .poll(async () => (await repo.getChat(searchedChatId))?.settings.webSearch)
    .toBe(true)

  sidebarButton('New chat')?.click()
  await expect.poll(() => activeChatId()).toBe('new')
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('false')
  expect(webChip()).toBeNull()
  expect(webNotice()).toBeNull()
  expect(estimateLines().join('\n')).not.toContain('web search')

  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webNotice()).toBeNull()
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(estimateLines()).toContain(webSearchLine)

  const postsBeforeQuiet = chatBodies().length
  mockChatStream({ chunks: [doneChunk(plainReply, 'gen-quiet')] })
  await sendDraft(quietFact)
  await expect
    .poll(() => pageText(), { timeout: 8000 })
    .toContain(plainReply)
  expect(document.querySelector('[data-sources]')).toBeNull()
  expect(document.querySelector('[data-web-search-status]')).toBeNull()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await expect
    .poll(() => chatBodies().length, { timeout: 8000 })
    .toBe(postsBeforeQuiet + 1)
  expectWebTool(chatBodies().at(-1))
  expect(estimateLines()).toContain(webSearchLine)
  const plainNode = [...document.querySelectorAll('[data-message-content]')].find(
    (node) => node.textContent?.includes(plainReply),
  )
  await shoot('no-sources', plainNode ?? null)

  const quietChatId = activeChatId()
  sidebarButton(nile)?.click()
  await expect.poll(() => activeChatId()).toBe(searchedChatId)
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(estimateLines()).toContain(webSearchLine)
  expect(pageText()).toContain('example.com')

  await reloadApp()
  openChat(searchedChatId)
  await expect.poll(() => activeChatId()).toBe(searchedChatId)
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webNotice()).toBeNull()
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(estimateLines()).toContain(webSearchLine)

  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('false')
  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  await settle()
  expect(webNotice()).toBeNull()
  expect(pageText()).not.toContain(pricedNotice)
  expect(pageText()).not.toContain('Web search adds about')
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')

  sidebarButton('New chat')?.click()
  await expect.poll(() => activeChatId()).toBe('new')
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('false')
  expect(webChip()).toBeNull()

  sidebarButton(nile)?.click()
  await expect.poll(() => activeChatId()).toBe(searchedChatId)
  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('false')
  expect(webChip()).toBeNull()
  expect(estimateLines().join('\n')).not.toContain('web search')
  const postsBeforeOff = chatBodies().length
  mockChatStream({ chunks: [doneChunk('Search stayed off.', 'gen-off')] })
  await sendDraft('Skip the web this time.')
  await expect
    .poll(() => chatBodies().length, { timeout: 8000 })
    .toBe(postsBeforeOff + 1)
  expectNoWebTool(chatBodies().at(-1))

  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webNotice()).toBeNull()
  mockChatStream(zdrStatus)
  const postsBeforeZdr = chatBodies().length
  await sendDraft('Search under zero data retention.')
  await expect.poll(() => pageText(), { timeout: 8000 }).toContain(zdrSentence)
  await I.see(button(sendWithout))
  expectWebTool(chatBodies().at(-1))
  expect(chatBodies()).toHaveLength(postsBeforeZdr + 1)

  mockChatStream({ chunks: [doneChunk('Sent without search.', 'gen-zdr-retry')] })
  await I.click(button(sendWithout))
  await expect
    .poll(() => chatBodies().length, { timeout: 8000 })
    .toBe(postsBeforeZdr + 2)
  expectNoWebTool(chatBodies().at(-1))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('false')
  expect(webChip()).toBeNull()
  await expect
    .poll(async () => (await repo.getChat(searchedChatId))?.settings.webSearch)
    .toBe(false)

  sidebarButton('New chat')?.click()
  await expect.poll(() => activeChatId()).toBe('new')
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('false')
  setDraft('Offline note')
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  setOnline(false)
  await I.see(text("You're offline. Your draft is safe.").wait())
  await I.click(button('Web search'))
  await expect.poll(() => webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(webChip()).toBeNull()
  expect(webToggle()?.getAttribute('aria-pressed')).toBe('true')
  expect(sendButton()?.disabled).toBe(true)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Send (offline)')
  expect(chatBodies()).toHaveLength(postsBeforeZdr + 2)
  expect(quietChatId).not.toBe(searchedChatId)
}, 60_000)
