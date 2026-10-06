import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { userEvent } from 'storybook/test'
import {
  button,
  createActor,
  role,
  text,
  type UserEvent,
} from 'kahraman'

import { ui } from '../app/ui'
import { getChatModel } from '../chat'
import { activeChatId, openChat } from '../routes'
import { sendKey, sidebarCollapsed } from '../storage/prefs'
import { bootApp, unmountApp } from './boot'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import { mockChatStream, mockGeneration } from './openrouter-mock'
import { shot } from './screenshot'
import { chatBodies } from './openrouter-mock'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-ana-shortcuts'
const glazeId = 'chat-glaze'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const macLike = () =>
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const mod = () => (macLike() ? '⌘' : 'Ctrl+')
const shiftMod = () => (macLike() ? '⌘⇧' : 'Ctrl+Shift+')

type RecordedPress = {
  key: string
  mod: boolean
  shift: boolean
  prevented: boolean
}

const recorded: RecordedPress[] = []

const rememberPress = (event: KeyboardEvent) => {
  recorded.push({
    key: event.key.toLowerCase(),
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    prevented: event.defaultPrevented,
  })
}

const lastPress = (key: string, withMod: boolean, shift = false) =>
  [...recorded]
    .reverse()
    .find((press) => press.key === key && press.mod === withMod && press.shift === shift)

const composer = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const focusComposer = () => {
  const field = composer()
  if (!field) throw new Error('missing composer')
  field.focus()
  return field
}

const shell = () => document.querySelector<HTMLElement>('[data-testid="shell"]')

const shortcutRows = () =>
  [...document.querySelectorAll('[data-shortcut]')].map((row) => ({
    id: row.getAttribute('data-shortcut'),
    chord: row.querySelector('[data-chord]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    label: row.querySelector('[data-label]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  }))

const defaultBindings = () => [
  { id: 'send', chord: 'Enter', label: 'Send' },
  { id: 'newline', chord: 'Shift+Enter', label: 'Insert a newline' },
  { id: 'escape', chord: 'Esc', label: 'Stop generating or close a dialog' },
  { id: 'openSearch', chord: `${mod()}K`, label: 'Search chats' },
  { id: 'newChat', chord: `${shiftMod()}O`, label: 'New chat' },
  { id: 'openPicker', chord: `${shiftMod()}L`, label: 'Choose a model' },
  { id: 'toggleSidebar', chord: `${shiftMod()}S`, label: 'Toggle sidebar' },
  { id: 'editLastUserMessage', chord: '↑', label: 'Edit the last message' },
  { id: 'openShortcuts', chord: `${mod()}/`, label: 'Keyboard shortcuts' },
]

const swappedBindings = () => [
  { id: 'send', chord: `${mod()}Enter`, label: 'Send' },
  { id: 'newline', chord: 'Enter', label: 'Insert a newline' },
  ...defaultBindings().slice(2),
]

const chunk = (content: string) => ({
  id: 'gen-shortcuts-1',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: 'openai/gpt-4o-mini',
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
})

const finishedReply = (content: string) => [
  { data: chunk(content) },
  {
    data: {
      ...chunk(''),
      choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
    },
  },
]

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="Composer"] [data-send]')

const userMessageCount = () => document.querySelectorAll('[data-slot="UserMessage"]').length

const latestReplyStatus = () =>
  [...document.querySelectorAll('[data-reply-status]')].at(-1)?.getAttribute('data-reply-status') ??
  ''

const hungReply = () => {
  if (latestReplyStatus() === 'stopped') return 'stopped'
  if ((document.body.textContent ?? '').includes('Still firing')) return 'live'
  return 'pending'
}

const toastCount = () => document.querySelectorAll('[data-toast-key]').length

const fitsOnScreen = (element: Element) => {
  const rect = element.getBoundingClientRect()
  expect(rect.width).toBeGreaterThan(0)
  expect(rect.height).toBeGreaterThan(0)
  expect(rect.top).toBeGreaterThanOrEqual(-1)
  expect(rect.left).toBeGreaterThanOrEqual(-1)
  expect(rect.bottom).toBeLessThanOrEqual(desktop.height + 1)
  expect(rect.right).toBeLessThanOrEqual(desktop.width + 1)
}

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const dialog = document.querySelector('dialog[open]')
  if (!dialog) throw new Error('missing dialog')
  fitsOnScreen(dialog)
  const title = dialog.querySelector('[data-dialog-title]')
  if (title) fitsOnScreen(title)
  for (const row of dialog.querySelectorAll('[data-shortcut]')) fitsOnScreen(row)
  await settle()
  await shot('F-24', name)
}

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

afterEach(async () => {
  window.removeEventListener('keydown', rememberPress, true)
  recorded.length = 0
  sendKey.set('enter')
  sidebarCollapsed.set(false)
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Ana drives chats, dialogs, and the send key from the keyboard', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: glazeId,
        title: 'Glaze notes',
        model: 'openai/gpt-4o-mini',
        messages: [
          { id: 'user-clay', role: 'user', content: 'The clay cracked' },
          {
            id: 'asst-clay',
            role: 'assistant',
            content: 'Try a slower dry.',
            parentId: 'user-clay',
          },
        ],
      },
    ],
  })
  mockGeneration({ ...generationRecord, id: 'gen-shortcuts-1', total_cost: 0.000012 })
  window.addEventListener('keydown', rememberPress, true)
  I.init({ canvasElement: document.body, userEvent: keyboard })

  expect(activeChatId()).toBe('new')
  focusComposer()
  const toastsBeforeArrow = toastCount()
  await keyboard.keyboard('{ArrowUp}')
  expect(ui.editing()).toBeNull()
  expect(document.querySelector('[data-slot="UserMessageEditor"]')).toBeNull()
  expect(toastCount()).toBe(toastsBeforeArrow)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(focusComposer().value).toBe('')

  await keyboard.keyboard('{Control>}/{/Control}')
  await I.see(role('dialog', 'Keyboard shortcuts').options({ timeout: 4_000 }).wait())
  expect(shortcutRows()).toEqual(defaultBindings())
  expect(lastPress('/', true)?.prevented).toBe(true)
  await shoot('dialog')

  await keyboard.keyboard('{Escape}')
  await expect.poll(() => ui.shortcuts()).toBe(false)
  expect(document.querySelector('dialog[open]')).toBeNull()

  openChat(glazeId)
  await I.see(text('The clay cracked').wait())
  const field = focusComposer()
  await keyboard.keyboard('note')
  expect(field.value).toBe('note')
  expect(lastPress('n', false)?.prevented).toBe(false)
  expect(lastPress('e', false)?.prevented).toBe(false)

  for (const keys of [
    '{Control>}a{/Control}',
    '{Control>}c{/Control}',
    '{Control>}v{/Control}',
    '{Control>}x{/Control}',
    '{Control>}z{/Control}',
    '{Control>}{Shift>}z{/Shift}{/Control}',
  ]) {
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
    await keyboard.keyboard(keys)
  }
  expect(lastPress('a', true)?.prevented).toBe(false)
  expect(lastPress('c', true)?.prevented).toBe(false)
  expect(lastPress('v', true)?.prevented).toBe(false)
  expect(lastPress('x', true)?.prevented).toBe(false)
  expect(lastPress('z', true, false)?.prevented).toBe(false)
  expect(lastPress('z', true, true)?.prevented).toBe(false)
  expect(field.value).toBe('note')

  const postsBeforeNewline = chatBodies().length
  await keyboard.keyboard('{Shift>}{Enter}{/Shift}')
  expect(field.value).toContain('\n')
  expect(chatBodies()).toHaveLength(postsBeforeNewline)
  expect(lastPress('enter', false, true)?.prevented).toBe(false)

  mockChatStream(finishedReply('Noted.'))
  await keyboard.keyboard('{Enter}')
  await I.see(text('Noted.').options({ timeout: 8_000 }).wait())
  expect(userMessageCount()).toBeGreaterThan(0)
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe('Send')
  await expect.poll(() => focusComposer().value).toBe('')

  await keyboard.keyboard('{ArrowUp}')
  await I.see(role('textbox', 'Edit message').wait())
  const editor = document.querySelector<HTMLTextAreaElement>(
    '[data-slot="UserMessageEditor"] textarea',
  )
  expect(editor?.value).toContain('note')
  expect(ui.editing()).not.toBeNull()
  await keyboard.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('[data-slot="UserMessageEditor"]')).toBeNull()
  expect(ui.editing()).toBeNull()

  mockChatStream({
    hang: true,
    chunks: [{ delayMs: 3_000, data: chunk('Still firing') }],
  })
  focusComposer()
  await keyboard.keyboard('hold')
  expect(lastPress('h', false)?.prevented).toBe(false)
  await keyboard.keyboard('{Enter}')
  await I.see(button('Stop').options({ timeout: 8_000 }).wait())

  focusComposer()
  const draftWhileStreaming = composer()?.value ?? ''
  await keyboard.keyboard('{Control>}k{/Control}')
  expect(composer()?.value ?? '').toBe(draftWhileStreaming)
  expect(draftWhileStreaming.includes('k')).toBe(false)
  expect(lastPress('k', true)?.prevented).toBe(true)
  await I.see(role('dialog', 'Search chats').wait())

  await keyboard.keyboard('{Escape}')
  await expect.poll(() => ui.search()).toBe(false)
  expect(hungReply()).toBe('pending')
  await expect.poll(hungReply, { timeout: 5_000 }).toBe('live')
  expect(latestReplyStatus()).not.toBe('stopped')

  await keyboard.keyboard('{Escape}')
  await expect
    .poll(() => document.querySelector('[data-reply-status="stopped"]')?.textContent ?? '')
    .toContain('Stopped')
  await expect
    .poll(() => sendButton()?.getAttribute('aria-label'), { timeout: 4_000 })
    .toBe('Send')

  focusComposer()
  await keyboard.keyboard('{Control>}{Shift>}l{/Shift}{/Control}')
  expect(lastPress('l', true, true)?.prevented).toBe(true)
  expect(composer()?.value ?? '').not.toMatch(/l/i)
  await I.see(role('dialog', 'Choose a model').wait())
  await keyboard.keyboard('{Escape}')
  await expect.poll(() => ui.picker()).toBeNull()

  focusComposer()
  await keyboard.keyboard('x')
  await keyboard.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
  expect(lastPress('s', true, true)?.prevented).toBe(true)
  expect(getChatModel(glazeId).draft.text()).toBe('x')
  expect(shell()?.dataset.sidebar).toBe('collapsed')
  expect(sidebarCollapsed()).toBe(true)

  focusComposer()
  await keyboard.keyboard('{Control>}{Shift>}o{/Shift}{/Control}')
  expect(lastPress('o', true, true)?.prevented).toBe(true)
  expect(getChatModel(glazeId).draft.text()).toBe('x')
  await expect.poll(() => activeChatId()).toBe('new')
  expect(focusComposer().value).not.toMatch(/o/i)

  const messagesBeforeForeignEnter = userMessageCount()
  const postsBeforeForeignEnter = chatBodies().length
  await keyboard.keyboard('{Control>}k{/Control}')
  await I.see(role('dialog', 'Search chats').wait())
  const search = document.querySelector<HTMLInputElement>('dialog[open] input[type="search"]')
  if (!search) throw new Error('missing search field')
  search.focus()
  await keyboard.keyboard('z')
  expect(search.value).toContain('z')
  expect(lastPress('z', false)?.prevented).toBe(false)
  await keyboard.keyboard('{Enter}')
  expect(userMessageCount()).toBe(messagesBeforeForeignEnter)
  expect(chatBodies()).toHaveLength(postsBeforeForeignEnter)
  expect(activeChatId()).toBe('new')
  await keyboard.keyboard('{ArrowUp}')
  expect(ui.editing()).toBeNull()
  expect(document.querySelector('[data-slot="UserMessageEditor"]')).toBeNull()
  const sidebarBeforeForeignMod = shell()?.dataset.sidebar
  await keyboard.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
  expect(shell()?.dataset.sidebar).not.toBe(sidebarBeforeForeignMod)
  expect(lastPress('s', true, true)?.prevented).toBe(true)
  await keyboard.keyboard('{Escape}')
  await expect.poll(() => document.querySelector('dialog[open]')).toBeNull()

  ui.appSettings.set('account')
  await I.see(role('dialog', 'Settings').wait())
  await I.click(role('tab', 'Keyboard'))
  await I.see(text('Shift+Enter inserts a newline').wait())
  await I.click(role('radio', `${mod()}Enter sends`))
  expect(sendKey()).toBe('mod-enter')
  await keyboard.keyboard('{Escape}')
  await expect.poll(() => ui.appSettings()).toBeNull()

  openChat(glazeId)
  await I.see(text('The clay cracked').wait())
  const swappedField = focusComposer()
  swappedField.setSelectionRange(0, swappedField.value.length)
  await keyboard.keyboard('{Backspace}swap')
  const postsBeforeSwappedEnter = chatBodies().length
  await keyboard.keyboard('{Enter}')
  expect(swappedField.value).toBe('swap\n')
  expect(chatBodies()).toHaveLength(postsBeforeSwappedEnter)
  expect(lastPress('enter', false, false)?.prevented).toBe(false)
  mockChatStream(finishedReply('Swapped.'))
  await keyboard.keyboard('{Control>}{Enter}{/Control}')
  expect(lastPress('enter', true)?.prevented).toBe(true)
  await I.see(text('Swapped.').options({ timeout: 8_000 }).wait())
  expect(swappedField.value).not.toContain('swap')

  await keyboard.keyboard('{Control>}/{/Control}')
  await I.see(role('dialog', 'Keyboard shortcuts').wait())
  expect(shortcutRows()).toEqual(swappedBindings())
  expect(document.querySelector('[data-slot="ShortcutsDialog"]')?.textContent ?? '').not.toContain(
    'Shift+Enter',
  )
  await shoot('swapped')
}, 90_000)
