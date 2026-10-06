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
import { commands } from '../app/commands'
import { overrideTimings } from '../app/timings'
import { activeChat } from '../chat'
import { catalogModels } from '../catalog'
import { sessionMode } from '../auth/session'
import {
  registerMarkdownExtension,
  unregisterMarkdownExtension,
} from '../render'
import { resetRuntime } from '../platform/runtime'
import { activeChatId, openChat } from '../routes'
import { lastPickedModel } from '../storage/prefs'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockGeneration,
  mockKey,
  mockRouteDelay,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-thread-story'
const modelLabel = 'OpenAI: GPT-4o-mini'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
  paste: (text: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

let online = true
let onlineDefined = false
let extraUnmount: (() => void) | null = null
let restorePut: (() => void) | null = null
let clipboardText = ''
let clipboardRejects = false
const copied: string[] = []

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot(flowId, name)
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const replyStatus = () =>
  [...document.querySelectorAll('[data-reply-status]')].at(-1)?.textContent ?? ''

const thread = () => document.querySelector<HTMLElement>('[data-slot="Thread"]')

const assistant = () =>
  document.querySelector<HTMLElement>('[data-slot="AssistantMessage"]')

const distanceFromEnd = (scroller: HTMLElement) =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

const chunk = (
  content: string,
  extra: Record<string, unknown> = {},
) => ({
  id: 'gen-thread-1',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: 'openai/gpt-4o-mini',
  choices: [
    {
      index: 0,
      delta: { content },
      finish_reason: null,
    },
  ],
  ...extra,
})

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

const installClipboard = () => {
  clipboardText = ''
  clipboardRejects = false
  copied.length = 0
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        if (clipboardRejects) throw new Error('denied')
        clipboardText = value
        copied.push(value)
      },
    },
  })
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
  installClipboard()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

afterEach(async () => {
  restorePut?.()
  restorePut = null
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  if (onlineDefined) setOnline(true)
  clipboardRejects = false
  await page.viewport(desktop.width, desktop.height)
})

test('Tom composes, streams, stops, and reads a reply', async () => {
  resetLocation()
  installOnline()
  installClipboard()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  mockGeneration({ ...generationRecord, id: 'gen-thread-1', total_cost: 0.000012 })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  await expect
    .poll(() => field()?.placeholder ?? '')
    .toContain(modelLabel)
  await I.see(text('Chats live only in this browser. Export to keep a copy.'))
  await I.see(text('What should we think about?'))
  expect(sendButton()?.disabled).toBe(true)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Send')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shoot('F-05', 'empty')

  setDraft('Hello')
  await settle()
  await shoot('F-05', 'composing')

  const postsBeforeNewline = chatBodies().length
  await keyboard.keyboard('{Shift>}{Enter}{/Shift}next')
  expect(field()?.value).toContain('\n')
  expect(chatBodies()).toHaveLength(postsBeforeNewline)

  const postsBeforeIme = chatBodies().length
  const imeEnter = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    isComposing: true,
  })
  Object.defineProperty(imeEnter, 'keyCode', { get: () => 229 })
  field()?.dispatchEvent(imeEnter)
  expect(chatBodies()).toHaveLength(postsBeforeIme)

  const shortHeight = field()?.offsetHeight ?? 0
  await keyboard.keyboard('{Shift>}{Enter}{/Shift}line'.repeat(6))
  expect(field()?.offsetHeight ?? 0).toBeGreaterThan(shortHeight)
  await keyboard.keyboard('{Shift>}{Enter}{/Shift}line'.repeat(40))
  const cap = Math.floor(
    (window.visualViewport?.height ?? window.innerHeight) * 0.4,
  )
  expect(field()?.offsetHeight ?? 0).toBeGreaterThan(shortHeight)
  expect(field()?.offsetHeight ?? 0).toBeLessThanOrEqual(cap + 8)

  setOnline(false)
  await I.see(text("You're offline. Your draft is safe.").wait())
  expect(sendButton()?.disabled).toBe(true)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Send (offline)')
  await settle()
  await shoot('F-05', 'offline')
  setOnline(true)
  await expect.poll(() => document.body.textContent ?? '').not.toContain(
    "You're offline. Your draft is safe.",
  )

  setDraft('')
  await expect.poll(() => field()?.value ?? 'pending').toBe('')
  const pasteTarget = field()
  pasteTarget?.focus()
  pasteTarget?.select()
  await keyboard.paste('z'.repeat(100_000))
  await expect.poll(() => field()?.value.length ?? 0, { timeout: 2_000 }).toBe(100_000)
  expect(document.querySelector('[data-message-body]')).toBeNull()
  expect(sendButton()?.disabled === false || (sendButton()?.getAttribute('aria-label')?.length ?? 0) > 0).toBe(true)

  setDraft('   ')
  await expect
    .poll(
      () =>
        `${JSON.stringify(field()?.value)}|${JSON.stringify(activeChat().draft.text())}|${sendButton()?.disabled}|${activeChatId()}`,
    )
    .toBe('"   "|"   "|true|new')
  setDraft('Tell me a long story')

  const sentence = `${'The reply keeps growing so Lena can read earlier lines. '.repeat(6)}\n`
  mockChatStream({
    firstTokenDelayMs: 4_500,
    hang: true,
    chunks: [
      {
        delayMs: 20,
        data: chunk('Hello ', { provider: 'Google' }),
      },
      ...Array.from({ length: 6 }, () => ({
        delayMs: 40,
        data: chunk(sentence),
      })),
      { delayMs: 4_000, data: chunk('LATE-MARKER') },
    ],
  })

  const postsBeforeSend = chatBodies().length
  await keyboard.keyboard('{Enter}')
  await expect.poll(() => thread()?.textContent ?? '').toContain('Tell me a long story')
  expect(chatBodies()).toHaveLength(postsBeforeSend + 1)
  await expect.poll(() => location.pathname).toMatch(/^\/c\//)
  await I.see(text(`Waiting for ${modelLabel}…`).wait())
  expect(sendButton()?.getAttribute('aria-label')).toBe('Stop')
  expect(sendButton()?.disabled).toBe(false)
  expect(document.querySelector('[data-state="processing"]')).toBeTruthy()
  expect(document.querySelector('[aria-label="Copy reply"]')).toBeNull()
  expect(assistant()?.textContent ?? '').not.toContain('Hello')
  await settle()
  await shoot('F-05', 'waiting')
  expect(assistant()?.textContent ?? '').not.toContain('Hello')
  expect(document.querySelector('[aria-label="Copy reply"]')).toBeNull()
  await shoot('F-05', 'processing')

  await expect
    .poll(() => assistant()?.textContent ?? '', { timeout: 8_000 })
    .toContain('Hello')
  await settle()
  await shoot('F-05', 'streaming')
  await shoot('F-06', 'streaming')

  const postsDuringStream = chatBodies().length
  field()?.focus()
  await keyboard.keyboard('draft')
  await expect.poll(() => field()?.value ?? '').toContain('draft')
  await keyboard.keyboard('{Enter}')
  expect(field()?.value).toContain('draft')
  expect(chatBodies()).toHaveLength(postsDuringStream)

  const scroller = thread()
  expect(scroller).toBeTruthy()
  await expect.poll(() => distanceFromEnd(scroller!)).toBeLessThanOrEqual(40)
  await expect
    .poll(
      () => (scroller?.scrollHeight ?? 0) > (scroller?.clientHeight ?? 0) + 80,
      { timeout: 8_000 },
    )
    .toBe(true)
  await settle()
  await shoot('F-07', 'following')

  const followed = scroller!.scrollTop
  const parked = Math.max(0, followed - 120)
  scroller!.scrollTop = parked
  await expect.poll(() => scroller?.getAttribute('data-following')).toBe('false')
  await I.see(text('New text below ↓').wait())
  await settle()
  expect(Math.abs(scroller!.scrollTop - parked)).toBeLessThanOrEqual(1)
  expect(distanceFromEnd(scroller!)).toBeGreaterThan(40)
  await shoot('F-07', 'detached')
  const detachedTop = scroller!.scrollTop
  await expect
    .poll(() => assistant()?.textContent ?? '', { timeout: 8_000 })
    .toContain('LATE-MARKER')
  expect(Math.abs(scroller!.scrollTop - detachedTop)).toBeLessThanOrEqual(1)
  await settle()
  await shoot('F-07', 'detached-streaming')
  await I.click(button(/New text below/))
  await expect.poll(() => distanceFromEnd(scroller!)).toBeLessThanOrEqual(40)
  await expect.poll(() => scroller?.getAttribute('data-following')).toBe('true')
  await settle()
  await shoot('F-07', 'reattached')

  const partial = assistant()?.textContent ?? ''
  mockRouteDelay('/generation', 8_000)
  await I.click(button('Stop'))
  await expect
    .poll(() => document.querySelector('[data-reply-status="stopped"]')?.textContent ?? '')
    .toContain('Stopped')
  expect(assistant()?.textContent ?? '').toContain('Hello')
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe('Send')
  expect(partial.length).toBeGreaterThan(10)
  await expect
    .poll(() => document.querySelector('[data-cost="settling"]')?.textContent ?? '')
    .toContain('Checking the final cost')
  document.querySelector('[data-cost="settling"]')?.scrollIntoView({ block: 'center' })
  await settle()
  await shoot('F-06', 'settling')
  document
    .querySelector('[data-reply-status="stopped"]')
    ?.scrollIntoView({ block: 'center' })
  await settle()
  await shoot('F-06', 'stopped')
  await I.click(button('About billing after stop'))
  await I.see(
    text('Stop ends the reply here. Google may still bill for the rest.').wait(),
  )
  document.querySelector('[data-billing-note]')?.scrollIntoView({ block: 'center' })
  await settle()
  await shoot('F-06', 'stopped-provider-note')
  await keyboard.keyboard('{Escape}')

  mockRouteDelay('/generation', 0)
  await expect
    .poll(() => document.querySelector('[data-cost="exact"]')?.textContent ?? '', {
      timeout: 12_000,
    })
    .toContain('0.00¢')
  const exactLine = document.querySelector('[data-cost="exact"]')?.textContent ?? ''
  expect(exactLine).toContain('0.00¢')
  expect(exactLine).not.toContain('$0.000012')
  expect(exactLine).not.toContain('≈')
  expect(exactLine).not.toContain('Checking the final cost')
  document.querySelector('[data-cost="exact"]')?.scrollIntoView({ block: 'center' })
  await settle()
  await shoot('F-06', 'exact')

  const reply = assistant()
  expect(reply?.querySelector('[data-slot="Reasoning"]')).toBeTruthy()
  expect(reply?.querySelector('[data-slot="CostFooter"]')).toBeTruthy()
  expect(reply?.querySelector('[data-slot="VersionSwitcher"]')).toBeTruthy()
  expect(reply?.querySelector('[data-slot="RegenerateMenu"]')).toBeTruthy()
  expect(reply?.querySelector('[data-slot="Sources"]')).toBeTruthy()
  expect(reply?.querySelector('[data-slot="ForkContinue"]')).toBeTruthy()
  expect(document.querySelector('[data-slot="AttachmentList"]')).toBeTruthy()

  await I.click(button('Copy reply'))
  await expect.poll(() => clipboardText).toContain('Hello')
  await I.click(button('Copy message'))
  await expect.poll(() => clipboardText).toBe('Tell me a long story')

  mockChatStream([
    { data: chunk('A finished reply.') },
    {
      data: {
        ...chunk(''),
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
      },
    },
  ])
  setDraft('Finish this')
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 4_000 })
    .toContain('A finished reply.')
  await expect
    .poll(() => sendButton()?.getAttribute('aria-label'))
    .toBe('Send')
  await settle()
  await shoot('F-05', 'done')

  mockChatStream({
    firstTokenDelayMs: 2_000,
    hang: true,
    chunks: [],
  })
  setDraft('Stop early')
  await keyboard.keyboard('{Enter}')
  await I.see(text('Stop early').wait())
  await I.click(button('Stop'))
  await expect.poll(() => replyStatus()).toContain('Stopped before any reply')
  expect(thread()?.textContent).toContain('Stop early')

  overrideTimings({ generationCapMs: 1, flushMs: 40 })
  mockChatStream({
    hang: true,
    chunks: [{ delayMs: 20, data: chunk('Unpriced partial') }],
  })
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe('Send')
  setDraft('Estimate this')
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 4_000 })
    .toContain('Unpriced partial')
  await I.click(button('Stop'))
  await expect
    .poll(() =>
      [...document.querySelectorAll('[data-cost="estimate"]')].at(-1)?.textContent ?? '',
    )
    .toContain('(stopped, estimate)')
  const estimateLine =
    [...document.querySelectorAll('[data-cost="estimate"]')].at(-1)?.textContent ?? ''
  expect(estimateLine).not.toContain('Checking the final cost')
  await settle()
  await shoot('F-06', 'estimate')

  mockChatStream({ networkError: true })
  setDraft('Lose the line')
  await keyboard.keyboard('{Enter}')
  await expect.poll(() => replyStatus()).toContain('Connection lost')
  expect(thread()?.textContent).toContain('Lose the line')

  commands.newChat()
  lastPickedModel.set(null)
  catalogModels.set([])
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe('Choose a model')
  expect(sendButton()?.disabled).toBe(true)
  commands.escape()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shoot('F-05', 'no-model')
}, 90_000)

test('Lena keeps a partial reply across reload and a full disk', async () => {
  resetLocation()
  installOnline()
  installClipboard()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect
    .poll(() => field()?.placeholder ?? '', { timeout: 5_000 })
    .toContain(modelLabel)

  mockChatStream({
    hang: true,
    chunks: [
      { delayMs: 30, data: chunk('Saved partial', { id: 'gen-keep' }) },
      { delayMs: 400, data: chunk(' later', { id: 'gen-keep' }) },
    ],
  })
  setDraft('Keep this')
  await keyboard.keyboard('{Enter}')
  await I.see(text('Saved partial').wait())
  await expect.poll(() => location.pathname).toMatch(/^\/c\//)
  const keptId = location.pathname.split('/').pop() ?? ''
  await expect.poll(async () => {
    const stored = await repo.listMessages(keptId)
    return stored.some(
      (message) =>
        message.role === 'assistant' &&
        message.content.includes('Saved partial') &&
        (message.status === 'streaming' || message.status === 'waiting'),
    )
  }).toBe(true)
  const originalPut = repo.putMessage.bind(repo)
  repo.putMessage = async (message) => {
    if (
      message.role === 'assistant' &&
      message.status !== 'streaming' &&
      message.status !== 'waiting' &&
      message.status !== 'interrupted'
    ) {
      return
    }
    return originalPut(message)
  }
  restorePut = () => {
    repo.putMessage = originalPut
  }
  await settle()
  await shoot('F-05b', 'streaming-saved')

  await reloadApp()
  openChat(keptId)
  await expect.poll(() => replyStatus()).toContain('Interrupted')
  await expect.poll(() => thread()?.textContent ?? '').toContain('Saved partial')
  await I.see(button('Retry'))
  expect(document.querySelector('[data-spinner]')).toBeNull()
  await settle()
  await shoot('F-05b', 'interrupted')

  restorePut?.()
  restorePut = null
  const quotaPut = repo.putMessage.bind(repo)
  let quotaWrites = 0
  repo.putMessage = async (message) => {
    if (message.role === 'assistant' && message.content.length > 0) {
      quotaWrites += 1
      throw new DOMException('quota', 'QuotaExceededError')
    }
    return quotaPut(message)
  }
  restorePut = () => {
    repo.putMessage = quotaPut
  }

  mockChatStream({
    hang: true,
    chunks: [
      { delayMs: 20, data: chunk('Unsaved words', { id: 'gen-full' }) },
      { delayMs: 80, data: chunk(' still here', { id: 'gen-full' }) },
    ],
  })
  commands.newChat()
  await expect.poll(() => activeChatId()).toBe('new')
  setDraft('Fill the disk')
  await expect
    .poll(() => {
      const block = activeChat().sendBlock()
      return `${field()?.value ?? ''}|${activeChat().draft.text()}|${sendButton()?.disabled}|${block?.code ?? 'open'}|${sendButton()?.getAttribute('aria-label')}`
    })
    .toBe('Fill the disk|Fill the disk|false|open|Send')
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(
      () => {
        const body = document.body.textContent ?? ''
        return [
          quotaWrites,
          body.includes('Fill the disk'),
          body.includes('Unsaved words'),
          body.includes('Not saved on this device'),
          body.includes('Browser storage is full'),
        ].join('|')
      },
      { timeout: 4_000 },
    )
    .toMatch(/^[12]\|true\|true\|true\|true$/)
  await I.see(text('Not saved on this device').wait())
  await I.see(text('Browser storage is full. Export and delete old chats.'))
  expect(document.querySelectorAll('[data-toast-key="storage-full"]')).toHaveLength(1)
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 4_000 })
    .toContain('still here')
  expect(document.querySelectorAll('[data-toast-key="storage-full"]')).toHaveLength(1)
  expect(quotaWrites).toBeGreaterThan(0)
  expect(quotaWrites).toBeLessThanOrEqual(2)
  await settle()
  await shoot('F-05b', 'not-saved')
  await shoot('F-05b', 'storage-full')
}, 60_000)

test('Lena scrolls a saved thread and Maya reads a large rendered reply', async () => {
  resetLocation()
  installOnline()
  installClipboard()
  const arabic = 'مرحبا، هذا جواب طويل يمكن قراءته من اليمين.'
  const ending = 'END-OF-LONG-REPLY'
  const unit = 'The rendered answer stays in the page. '
  const longReply =
    unit.repeat(Math.ceil(50_000 / unit.length)).slice(0, 50_000 - ending.length) +
    ending
  const markdown = [
    '# Rendered',
    '',
    'A [note](https://openrouter.ai/docs) and a table.',
    '',
    '| Name | Role |',
    '| --- | --- |',
    '| Maya | Reader |',
    '',
    '```ts',
    'const answer = 1',
    '```',
    '',
  ].join('\n')
  const history = Array.from({ length: 12 }, (_, index) => [
    {
      role: 'user' as const,
      content: `Earlier question ${index} stays in the page for find-in-page.`,
    },
    {
      role: 'assistant' as const,
      content: `Earlier answer ${index} is not virtualized. ${'line '.repeat(40)}`,
      status: 'done' as const,
    },
  ]).flat()

  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: 'chat-long',
        title: 'Long thread',
        model: 'openai/gpt-4o-mini',
        messages: history,
      },
      {
        id: 'chat-render',
        title: 'Rendered',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Show the markdown' },
          { role: 'assistant', content: markdown, status: 'done' },
        ],
      },
      {
        id: 'chat-huge',
        title: 'Huge',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'A very long answer' },
          { role: 'assistant', content: longReply, status: 'done' },
        ],
      },
      {
        id: 'chat-rtl',
        title: 'Arabic',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'اتجاه النص' },
          { role: 'assistant', content: arabic, status: 'done' },
        ],
      },
      {
        id: 'chat-fault',
        title: 'Fault',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Break the renderer' },
          { role: 'assistant', content: 'This paragraph should fall back.', status: 'done' },
        ],
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  openChat('chat-long')
  await I.see(text('Earlier question 0 stays in the page for find-in-page.').wait())
  await expect
    .poll(() => thread()?.textContent ?? '')
    .toContain('Earlier answer 11 is not virtualized.')
  const scroller = thread()
  expect(scroller).toBeTruthy()
  expect(scroller?.querySelectorAll('[data-message-id]')).toHaveLength(24)
  await expect.poll(() => distanceFromEnd(scroller!)).toBeLessThanOrEqual(40)

  scroller!.scrollTop = Math.max(0, scroller!.scrollTop - 160)
  await expect.poll(() => scroller?.getAttribute('data-following')).toBe('false')
  await I.see(button(/Jump to latest/).wait())
  const parked = scroller!.scrollTop
  openChat('chat-long')
  expect(Math.abs(scroller!.scrollTop - parked)).toBeLessThanOrEqual(1)

  setDraft('Back to the end')
  mockChatStream([
    { data: chunk('Reattached after send.') },
    {
      data: {
        ...chunk(''),
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
      },
    },
  ])
  await keyboard.keyboard('{Enter}')
  await I.see(text('Back to the end').wait())
  await expect.poll(() => scroller?.getAttribute('data-following')).toBe('true')
  await expect.poll(() => distanceFromEnd(scroller!)).toBeLessThanOrEqual(48)

  openChat('chat-render')
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 5_000 })
    .toContain('Rendered')
  await expect.poll(() => document.querySelector('table th')?.textContent ?? '').toBe('Name')
  await settle()
  await shoot('F-08', 'final')

  const codeCopy = document.querySelector<HTMLButtonElement>('[data-copy-code]')
  expect(codeCopy).toBeTruthy()
  codeCopy?.click()
  await expect.poll(() => codeCopy?.textContent ?? '').toBe('Copied')
  expect(clipboardText).toBe('const answer = 1')
  await settle()
  await shoot('F-08', 'code-copied')

  clipboardRejects = true
  const replyCopy = [...document.querySelectorAll('button')].find(
    (element) => element.getAttribute('aria-label') === 'Copy reply',
  )
  replyCopy?.click()
  await I.see(text("Couldn't copy. Select the text instead.").wait())
  await settle()
  await shoot('F-08', 'copy-failed')
  clipboardRejects = false

  openChat('chat-rtl')
  await I.see(text(arabic).wait())
  const rtl = document.querySelector(
    '[data-slot="AssistantMessage"] [data-message-body]',
  )
  expect(rtl).toBeTruthy()
  await expect.poll(() => getComputedStyle(rtl!).direction).toBe('rtl')

  const fault = {
    renderer: {
      paragraph(token: { text: string }) {
        if (token.text.includes('fall back')) throw new Error('render fault')
        return false as const
      },
    },
  }
  registerMarkdownExtension(fault)
  try {
    openChat('chat-fault')
    await expect
      .poll(() => document.querySelector('[data-show-raw]')?.textContent ?? '', {
        timeout: 4_000,
      })
      .toBe('Show raw text')
    await settle()
    await shoot('F-08', 'render-fallback')
  } finally {
    unregisterMarkdownExtension(fault)
  }

  openChat('chat-huge')
  expect(longReply.length).toBe(50_000)
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 2_000 })
    .toContain(ending)
  await expect.poll(() => distanceFromEnd(thread()!)).toBeLessThanOrEqual(40)

  mockChatStream({
    hang: true,
    chunks: [
      { delayMs: 40, data: chunk('```ts\nconst live = ') },
      { delayMs: 80, data: chunk('1\n') },
    ],
  })
  commands.newChat()
  await expect.poll(() => thread()?.getAttribute('data-empty')).toBe('true')
  setDraft('Stream markdown')
  await expect
    .poll(
      () =>
        `${sendButton()?.disabled}|${sendButton()?.getAttribute('aria-label')}|${activeChat().draft.text()}`,
    )
    .toBe('false|Send|Stream markdown')
  field()?.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }),
  )
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 4_000 })
    .toContain('const live')
  const streamingRoot = document.querySelector('[data-message-body]')
  await expect
    .poll(() => thread()?.textContent ?? '', { timeout: 4_000 })
    .toContain('const live = 1')
  expect(document.querySelector('[data-message-body]')).toBe(streamingRoot)
  expect(document.querySelector('[data-code-block]')).toBeTruthy()
  await settle()
  await shoot('F-08', 'streaming')
}, 60_000)
