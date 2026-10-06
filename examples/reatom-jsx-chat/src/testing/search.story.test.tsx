import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import { userEvent } from 'storybook/test'
import { button, createActor, role, text, type UserEvent } from 'kahraman'

import { ui } from '../app/ui'
import { sessionMode } from '../auth/session'
import { library } from '../chat/library'
import { commands } from '../app/commands'
import { activeChatId } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { seedChats } from './seed'
import { limitedKey } from './fixtures/keys'
import {
  bigLibraryChats,
  bigLibraryMessages,
  bigLibraryNeedle,
  seedBigLibrary,
} from './fixtures/bigLibrary'
import { openRouterRequests } from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-ana-search'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
  click: (element: Element) => Promise<void>
}

const dialog = () => role('dialog', 'Search chats')

const openDialog = () => {
  const surface = document.querySelector<HTMLDialogElement>('dialog[open]')
  if (!surface) throw new Error('missing dialog')
  return surface
}

const searchInput = () => {
  const input = document.querySelector<HTMLInputElement>('dialog[open] input[type="search"]')
  if (!input) throw new Error('missing search input')
  return input
}

const snippetOf = (messageId: string) =>
  document
    .querySelector(`[data-message-id="${messageId}"]`)
    ?.textContent?.replace(/\s+/g, ' ')
    .trim() ?? ''

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
  await settle()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const surface = document.querySelector('dialog[open]')
  if (!surface) throw new Error('missing dialog')
  fitsOnScreen(surface)
  const title = surface.querySelector('[data-dialog-title]')
  if (title) fitsOnScreen(title)
  for (const node of surface.querySelectorAll(
    '[data-search-copy], [data-search-group], [data-search-option], mark',
  )) {
    fitsOnScreen(node)
  }
  await shot('F-14', name)
}

const setQuery = (value: string) => {
  const input = searchInput()
  input.focus()
  input.value = value
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }),
  )
}

const quietRequestCount = async () => {
  let count = openRouterRequests().length
  await expect
    .poll(
      () => {
        const next = openRouterRequests().length
        const stable = next === count && next > 0
        count = next
        return stable
      },
      { timeout: 4_000 },
    )
    .toBe(true)
  return openRouterRequests().length
}

const openWithShortcut = async (source: 'keys' | 'command' = 'keys') => {
  if (source === 'keys') await keyboard.keyboard('{Control>}k{/Control}')
  else commands.openSearch()
  await I.see(dialog().options({ timeout: 4_000 }).wait())
  await expect.poll(() => document.activeElement === searchInput()).toBe(true)
}

const kilnFillers = Array.from({ length: 24 }, (_, index) => ({
  id: `kiln-f${index}`,
  role: 'user' as const,
  content: `Firing log line ${index} stays below the match so the thread can scroll past the end.`,
  parentId: index === 0 ? 'kiln-old' : `kiln-f${index - 1}`,
}))

const savedChats = [
  {
    id: 'kiln',
    title: 'Kiln log',
    lastActivityAt: Date.parse('2026-10-06T12:00:00.000Z'),
    messages: [
      { id: 'kiln-user', role: 'user' as const, content: 'How should the firing go?' },
      {
        id: 'kiln-old',
        role: 'assistant' as const,
        content: 'Run vitest before the firing.',
        parentId: 'kiln-user',
        createdAt: 1_000,
      },
      {
        id: 'kiln-new',
        role: 'assistant' as const,
        content: 'The kiln cooled overnight.',
        parentId: 'kiln-user',
        createdAt: 2_000,
      },
      ...kilnFillers,
    ],
  },
  {
    id: 'setup',
    title: 'Vitest setup',
    lastActivityAt: Date.parse('2026-10-04T12:00:00.000Z'),
    messages: [{ id: 'setup-user', role: 'user' as const, content: 'Install the runner.' }],
  },
  {
    id: 'jp',
    title: 'Studio notes',
    lastActivityAt: Date.parse('2026-10-03T12:00:00.000Z'),
    messages: [{ id: 'jp-user', role: 'user' as const, content: '日本語のメモ' }],
  },
  {
    id: 'rtl',
    title: 'Greeting',
    lastActivityAt: Date.parse('2026-10-02T12:00:00.000Z'),
    messages: [{ id: 'rtl-user', role: 'user' as const, content: 'שלום' }],
  },
  {
    id: 'gone',
    title: 'Vitest deleted',
    deletedAt: 1,
    lastActivityAt: Date.parse('2026-10-07T12:00:00.000Z'),
    messages: [{ id: 'gone-user', role: 'user' as const, content: 'vitest in the trash' }],
  },
]

const originalScan = repo.scanMessages.bind(repo)

afterEach(async () => {
  repo.scanMessages = originalScan
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test(
  'Ana searches every saved chat from the keyboard and the sidebar',
  async () => {
    await bootApp({ key: storyKey, keyMeta: limitedKey, viewport: desktop })
    I.init({ canvasElement: document.body, userEvent: keyboard })

    const newChat = button('New chat').within(role('complementary', 'Chats'))
    await I.click(newChat)
    const returnFocus = document.activeElement
    expect(returnFocus).toBeInstanceOf(HTMLElement)
    await openWithShortcut()
    await I.see(text('No chats yet').within(dialog()).options({ timeout: 3_000 }))
    expect(document.querySelector('dialog[open]')?.textContent ?? '').not.toContain(
      'Type to search your chats.',
    )
    await shoot('no-chats')

    const beforeEmptySearch = await quietRequestCount()
    setQuery('vitest')
    await I.see(
      text('No chats match "vitest"').within(dialog()).options({ timeout: 3_000 }).wait(),
    )
    expect(openRouterRequests().length).toBe(beforeEmptySearch)
    await shoot('no-results')

    await keyboard.keyboard('{Escape}')
    await expect.poll(() => ui.search()).toBe(false)
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(document.activeElement).toBe(returnFocus)

    await seedChats(savedChats)
    await library.reload()

    await keyboard.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
    await expect
      .poll(() => document.querySelector('[data-testid="shell"]')?.getAttribute('data-sidebar'))
      .toBe('collapsed')
    const sidebarField = document.querySelector<HTMLElement>(
      '[data-testid="sidebar-inline"] input, [data-testid="sidebar-inline"] [data-search-field]',
    )
    if (sidebarField && !sidebarField.closest('[inert]')) await keyboard.click(sidebarField)
    else await I.click(button('Search chats'))
    await I.see(dialog().options({ timeout: 4_000 }).wait())
    await expect.poll(() => document.activeElement === searchInput()).toBe(true)
    await keyboard.keyboard('{Escape}')
    await expect.poll(() => ui.search()).toBe(false)

    await keyboard.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
    await expect
      .poll(() => document.querySelector('[data-testid="shell"]')?.getAttribute('data-sidebar'))
      .toBe('expanded')

    await openWithShortcut()
    await I.see(text('Kiln log').within(dialog()))
    await I.see(text('Vitest setup').within(dialog()))
    await I.see(text('Studio notes').within(dialog()))
    await I.see(text('Greeting').within(dialog()))
    expect(openDialog().textContent ?? '').not.toContain('Vitest deleted')
    await shoot('recent')

    const beforeSearch = await quietRequestCount()
    searchInput().focus()
    await keyboard.keyboard('vitest')
    await expect
      .poll(() => snippetOf('kiln-old'), { timeout: 3_000 })
      .toBe('Run vitest before the firing.')
    await I.see(text('vitest').within(dialog()))
    await I.see(text('Vitest setup').within(dialog()))
    const surface = openDialog()
    const messageHit = surface.querySelector('[data-hit-kind="message"]')
    const titleHit = surface.querySelector('[data-hit-kind="title"]')
    expect(messageHit?.getAttribute('data-message-id')).toBe('kiln-old')
    expect(messageHit?.querySelector('mark')?.textContent?.toLowerCase()).toBe('vitest')
    expect(titleHit?.querySelector('mark')?.textContent?.toLowerCase()).toBe('vitest')
    expect(surface.textContent ?? '').not.toContain('vitest in the trash')
    expect(surface.querySelectorAll('[data-search-group]').length).toBe(2)
    expect(openRouterRequests().length).toBe(beforeSearch)

    await shoot('results')
    searchInput().focus()
    await keyboard.keyboard('{ArrowDown}{Enter}')

    await expect
      .poll(() => {
        const row = document.querySelector<HTMLElement>('[data-message-id="kiln-old"]')
        const scroller = document.querySelector<HTMLElement>('[data-slot="Thread"]')
        if (!row || !scroller) return false
        if (row.getAttribute('data-highlight') !== 'match') return false
        const rowBox = row.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        return (
          rowBox.height > 0 &&
          rowBox.top >= box.top - 2 &&
          rowBox.bottom <= box.bottom + 2 &&
          distance > 80
        )
      }, { timeout: 4_000 })
      .toBe(true)
    expect(activeChatId()).toBe('kiln')
    expect(document.querySelector('[data-message-id="kiln-new"]')).toBeNull()
    expect(ui.search()).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(
      document.querySelector('[data-message-id="kiln-old"]')?.getAttribute('data-highlight'),
    ).toBe('match')
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(
      document.querySelector('[data-message-id="kiln-old"]')?.getAttribute('data-highlight'),
    ).toBeNull()

    const chatCount = library.chats().length
    const setupMessages = await repo.listMessages('setup')
    const setupUser = setupMessages.find((message) => message.id === 'setup-user')
    if (!setupUser) throw new Error('missing setup message')
    await repo.putMessage({
      ...setupUser,
      id: 'setup-late',
      parentId: setupUser.id,
      content: 'glaze-needle after the index',
      createdAt: setupUser.createdAt + 1,
      rev: 1,
    })
    const kilnMessages = await repo.listMessages('kiln')
    const kilnOld = kilnMessages.find((message) => message.id === 'kiln-old')
    if (!kilnOld) throw new Error('missing kiln version')
    await repo.putMessage({
      ...kilnOld,
      id: 'kiln-late',
      content: 'version-needle from a later sibling',
      createdAt: kilnOld.createdAt + 1,
      rev: 1,
    })
    expect(library.chats().length).toBe(chatCount)
    await openWithShortcut()
    setQuery('glaze-needle')
    await expect
      .poll(() => snippetOf('setup-late'), { timeout: 3_000 })
      .toBe('glaze-needle after the index')
    setQuery('version-needle')
    await expect
      .poll(() => snippetOf('kiln-late'), { timeout: 3_000 })
      .toBe('version-needle from a later sibling')
    await keyboard.keyboard('{Escape}')
    await expect.poll(() => ui.search()).toBe(false)

    await openWithShortcut()
    setQuery('日本語')
    await I.see(text('Studio notes').within(dialog()).options({ timeout: 3_000 }).wait())
    expect(openDialog().textContent ?? '').toContain('日本語')

    setQuery('שלום')
    await I.see(text('Greeting').within(dialog()).options({ timeout: 3_000 }).wait())
    expect(openDialog().textContent ?? '').toContain('שלום')

    setQuery('\u0301\u0308')
    await I.see(
      text('No chats match "\u0301\u0308"').within(dialog()).options({ timeout: 3_000 }).wait(),
    )
    expect(openDialog().querySelector('[data-search-group]')).toBeNull()
    expect(openDialog().textContent ?? '').not.toContain("Couldn't search saved chats.")

    await keyboard.keyboard('{Escape}')
    await expect.poll(() => ui.search()).toBe(false)

    await bootApp({ viewport: desktop, seed: savedChats })
    I.init({ canvasElement: document.body, userEvent: keyboard })
    await expect.poll(() => sessionMode()).toBe('archive')
    await I.see(text('Connect to continue'))
    await I.see(text('Read-only'))
    await openWithShortcut('command')
    setQuery('vitest')
    await expect
      .poll(() => snippetOf('kiln-old'), { timeout: 3_000 })
      .toBe('Run vitest before the firing.')
    expect(ui.search()).toBe(true)
    await keyboard.keyboard('{Escape}')

    await bootApp({
      key: storyKey,
      keyMeta: limitedKey,
      viewport: desktop,
      seed: savedChats,
    })
    I.init({ canvasElement: document.body, userEvent: keyboard })
    repo.scanMessages = async () => {
      throw new DOMException('The database connection is closing.', 'InvalidStateError')
    }
    try {
      await openWithShortcut('command')
      setQuery('vitest')
      await I.see(
        text("Couldn't search saved chats.").within(dialog()).options({ timeout: 3_000 }).wait(),
      )
      expect(ui.search()).toBe(true)
      expect(document.querySelector('dialog[open]')).not.toBeNull()
      await shoot('error')
    } finally {
      repo.scanMessages = originalScan
    }

    await bootApp({ key: storyKey, keyMeta: limitedKey, viewport: desktop })
    I.init({ canvasElement: document.body, userEvent: keyboard })
    const seeded = await seedBigLibrary()
    expect(seeded).toEqual({ chats: bigLibraryChats, messages: bigLibraryMessages })
    await library.reload()
    await openWithShortcut('command')
    await expect
      .poll(() => document.querySelector('[data-search-root]')?.getAttribute('data-indexed'), {
        timeout: 8_000,
      })
      .toBe(String(bigLibraryMessages))
    const beforeLarge = openRouterRequests().length
    const started = performance.now()
    setQuery(bigLibraryNeedle)
    await expect
      .poll(() => (openDialog().textContent ?? '').includes(bigLibraryNeedle), {
        timeout: 1_000,
      })
      .toBe(true)
    expect(performance.now() - started).toBeLessThan(300)
    expect(openRouterRequests().length).toBe(beforeLarge)
    expect(document.querySelector('vite-error-overlay')).toBeNull()
  },
  60_000,
)
