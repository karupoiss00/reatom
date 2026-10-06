import { addCallHook, context } from '@reatom/core'
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
import { forgetKey } from '../auth'
import { send } from '../chat/engine'
import { library } from '../chat/library'
import { exportChatJson } from '../data'
import { resetRuntime } from '../platform/runtime'
import { activeChatId } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { catalogModels } from './fixtures/models'
import { limitedKey } from './fixtures/keys'
import {
  installOpenRouterMock,
  mockChatStream,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))
const lenaKey = 'sk-or-v1-lena-sidebar'

const octoberNoon = Date.parse('2026-10-05T12:00:00.000Z')
const novemberNoon = Date.parse('2026-11-20T12:00:00.000Z')
const yesterdayUtc = Date.parse('2026-10-05T03:30:00.000Z')
const septemberUtc = Date.parse('2026-09-15T12:00:00.000Z')

const originalNow = Date.now
const originalResolved = Intl.DateTimeFormat.prototype.resolvedOptions
const originalListChats = repo.listChats
const originalGetAll = IDBObjectStore.prototype.getAll

let clock: number | null = null
let timeZone = 'America/New_York'
let locale = 'en-US'
let releaseLists: (() => void) | null = null
let extraUnmount: (() => void) | null = null
let bootInFlight: Promise<unknown> | null = null

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
  dblClick: (element: Element) => Promise<void>
  clear: (element: Element) => Promise<void>
}

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-13', name)
}

const chats = () => role('complementary', 'Chats')

const exactButton = (name: string) => button(name).options({ exact: true })

const row = (title: string) => role('listitem', new RegExp(title))

const group = (label: string) => role('region', label)

const deletedToast = () =>
  document
    .querySelector('[data-toast-key="chat-deleted"]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim() ?? ''

const titleButton = (title: string) =>
  [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === title,
  )

const openActions = async (title: string) => {
  const menu = role('menu', `Actions for ${title}`)
  const trigger = button('⋯').within(row(title))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await I.click(trigger)
    try {
      await I.see(menu.options({ timeout: 1_000 }).wait())
      return menu
    } catch (error) {
      if (attempt === 3) throw error
      await settle()
    }
  }
  return menu
}

const installClock = () => {
  Date.now = () => clock ?? originalNow()
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(
    this: Intl.DateTimeFormat,
  ) {
    return { ...originalResolved.call(this), timeZone, locale }
  }
  Object.defineProperty(navigator, 'language', {
    configurable: true,
    get: () => locale,
  })
  document.documentElement.lang = locale
}

const remount = async () => {
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(catalogModels)
  mockKey(limitedKey)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot()
  await expect.poll(() => document.querySelector('[data-slot="Sidebar"]')).toBeTruthy()
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

afterEach(async () => {
  releaseLists?.()
  releaseLists = null
  await bootInFlight?.catch(() => {})
  bootInFlight = null
  repo.listChats = originalListChats
  IDBObjectStore.prototype.getAll = originalGetAll
  Date.now = originalNow
  Intl.DateTimeFormat.prototype.resolvedOptions = originalResolved
  document.documentElement.lang = 'en'
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Lena groups, renames, pins, and deletes chats from the sidebar', async () => {
  installClock()
  const exported: string[] = []
  addCallHook(exportChatJson, (_result, params) => {
    exported.push(String(params[0]))
  })

  const listGate = new Promise<void>((resolve) => {
    releaseLists = resolve
  })
  repo.listChats = () => listGate.then(() => originalListChats())

  I.init({ canvasElement: document.body, userEvent: keyboard })
  bootInFlight = bootApp({
    key: lenaKey,
    keyMeta: limitedKey,
    viewport: desktop,
  })

  await I.see(chats().options({ timeout: 10_000 }).wait())
  await I.see(role('status', 'Loading chats').within(chats()))
  expect(document.querySelectorAll('[data-slot="Sidebar"] [data-skeleton]').length).toBeGreaterThan(3)
  expect(document.body.textContent ?? '').not.toContain('No chats yet')
  await settle()
  await shoot('loading')

  releaseLists?.()
  releaseLists = null
  await bootInFlight
  bootInFlight = null
  repo.listChats = originalListChats

  await I.see(text('No chats yet').within(chats()))
  expect(document.querySelector('[data-slot="Sidebar"] [data-skeleton]')).toBeNull()
  const beforeNew = library.chats().length
  await I.click(button('New chat').within(chats()))
  await I.click(button('New chat').within(chats()))
  expect(library.chats()).toHaveLength(beforeNew)
  expect(activeChatId()).toBe('new')
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shoot('empty')

  clock = octoberNoon
  timeZone = 'America/New_York'
  locale = 'en-US'
  document.documentElement.lang = locale
  await seedChats([
    {
      id: 'kiln',
      title: 'Kiln notes',
      pinnedAt: 1_000,
      lastActivityAt: Date.parse('2026-10-05T15:00:00.000Z'),
      createdAt: Date.parse('2026-10-01T12:00:00.000Z'),
    },
    {
      id: 'morning',
      title: 'Morning glaze',
      lastActivityAt: Date.parse('2026-10-05T14:00:00.000Z'),
      createdAt: Date.parse('2026-10-05T14:00:00.000Z'),
    },
    {
      id: 'night',
      title: 'Night firing',
      lastActivityAt: yesterdayUtc,
      createdAt: yesterdayUtc,
    },
    {
      id: 'shelf',
      title: 'Shelf layout',
      lastActivityAt: Date.parse('2026-10-01T16:00:00.000Z'),
      createdAt: Date.parse('2026-10-01T16:00:00.000Z'),
      messages: [
        { id: 'shelf-u', role: 'user', content: 'Remember this glaze' },
        {
          id: 'shelf-a1',
          role: 'assistant',
          content: 'Version one',
          parentId: 'shelf-u',
          rev: 1,
        },
        {
          id: 'shelf-a2',
          role: 'assistant',
          content: 'Version two',
          parentId: 'shelf-u',
          rev: 2,
        },
      ],
    },
    {
      id: 'clay',
      title: 'Clay order',
      lastActivityAt: Date.parse('2026-09-20T16:00:00.000Z'),
      createdAt: Date.parse('2026-09-20T16:00:00.000Z'),
      messages: [{ id: 'clay-u', role: 'user', content: 'Order the clay' }],
    },
    {
      id: 'september',
      title: 'September kiln',
      lastActivityAt: septemberUtc,
      createdAt: septemberUtc,
    },
  ])
  await library.reload()

  await I.see(text('Kiln notes').within(group('Pinned')))
  await I.see(text('Morning glaze').within(group('Today')))
  await I.see(text('Night firing').within(group('Yesterday')))
  await I.see(text('Shelf layout').within(group('Previous 7 days')))
  await I.see(text('Clay order').within(group('Previous 30 days')))
  await I.see(text('September kiln').within(group('Previous 30 days')))
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shoot('list')

  timeZone = 'Asia/Tokyo'
  await library.reload()
  await I.see(text('Night firing').within(group('Today')))
  await I.dontSee(group('Yesterday'))

  timeZone = 'America/New_York'
  await library.reload()
  await I.see(text('Night firing').within(group('Yesterday')))

  clock = novemberNoon
  locale = 'ru-RU'
  document.documentElement.lang = 'ru-RU'
  await library.reload()
  await I.see(text('September kiln').within(group('September 2026')))
  expect(document.body.textContent ?? '').not.toMatch(/сентябр/i)

  clock = octoberNoon
  locale = 'en-US'
  document.documentElement.lang = 'en'
  await library.reload()

  await I.click(exactButton('Morning glaze'))
  await I.seeAttribute(exactButton('Morning glaze'), 'aria-current', 'page')
  await I.dontSeeAttribute(exactButton('Night firing'), 'aria-current')
  await settle()
  await shoot('active')

  const toggle = document.querySelector('[data-sidebar-toggle]')
  expect(toggle).toBeTruthy()
  const toggleRect = toggle!.getBoundingClientRect()
  const overlapping = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="Sidebar"] button, [data-slot="Sidebar"] a, [data-slot="Sidebar"] input',
    ),
  ].filter((element) => {
    const rect = element.getBoundingClientRect()
    return (
      rect.width > 0 &&
      rect.right > toggleRect.left &&
      rect.left < toggleRect.right &&
      rect.bottom > toggleRect.top &&
      rect.top < toggleRect.bottom
    )
  })
  expect(overlapping).toEqual([])

  const menuButton = button('⋯').within(row('Morning glaze'))
  await I.see(menuButton)
  const menuElement = document.querySelector<HTMLElement>(
    '[aria-label="Morning glaze"] button[aria-label="⋯"]',
  )
  if (menuElement === null) throw new Error('Morning glaze actions are missing')
  const menuStyle = getComputedStyle(menuElement)
  expect(Number(menuStyle.opacity)).toBe(1)
  expect(menuStyle.visibility).not.toBe('hidden')
  expect(menuElement.getBoundingClientRect().width).toBeGreaterThan(0)

  await keyboard.dblClick(titleButton('Morning glaze')!)
  await I.see(role('textbox', 'Chat title'))
  await keyboard.keyboard('Temporary')
  await keyboard.keyboard('{Escape}')
  await I.see(exactButton('Morning glaze'))
  await I.dontSee(role('textbox', 'Chat title'))

  const renameMenu = await openActions('Morning glaze')
  await I.see(role('menuitem', 'Rename').within(renameMenu))
  await I.see(role('menuitem', 'Pin').within(renameMenu))
  await I.see(role('menuitem', 'Delete').within(renameMenu))
  await I.see(role('menuitem', 'Export').within(renameMenu))
  await I.click(role('menuitem', 'Rename'))
  const titleField = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Chat title"]')
  await I.see(role('textbox', 'Chat title').wait())
  await keyboard.clear(titleField()!)
  await keyboard.keyboard('{Enter}')
  await I.see(exactButton('Morning glaze'))

  await I.click(role('menuitem', 'Rename').within(await openActions('Morning glaze')))
  await I.see(role('textbox', 'Chat title').wait())
  await keyboard.clear(titleField()!)
  await keyboard.keyboard('Dawn glaze')
  await settle()
  await shoot('renaming')
  await keyboard.keyboard('{Enter}')
  await expect.poll(async () => (await repo.getChat('morning'))?.title).toBe('Dawn glaze')
  await I.see(exactButton('Dawn glaze').wait())

  await I.click(role('menuitem', 'Pin').within(await openActions('Night firing')))
  await I.see(text('Night firing').within(group('Pinned')).wait())
  await expect
    .poll(async () => (await repo.getChat('night'))?.pinnedAt ?? null)
    .not.toBeNull()
  await settle()
  await shoot('pinned')
  await remount()
  await I.see(text('Night firing').within(group('Pinned')).wait())
  await I.see(text('Kiln notes').within(group('Pinned')))
  await I.see(exactButton('Dawn glaze'))
  const nightTitle = titleButton('Night firing')
  const kilnTitle = titleButton('Kiln notes')
  expect(nightTitle).toBeTruthy()
  expect(kilnTitle).toBeTruthy()
  expect(
    nightTitle!.compareDocumentPosition(kilnTitle!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()

  const countBeforeEmpty = library.chats().length
  await I.click(button('New chat').within(chats()))
  await I.click(button('New chat').within(chats()))
  expect(library.chats()).toHaveLength(countBeforeEmpty)
  expect(activeChatId()).toBe('new')

  mockChatStream({
    hang: true,
    chunks: [
      {
        data: {
          id: 'gen-partial',
          object: 'chat.completion.chunk',
          created: 1_710_000_000,
          model: 'openai/gpt-4o-mini',
          choices: [
            {
              index: 0,
              delta: { content: 'Partial' },
              finish_reason: null,
            },
          ],
        },
      },
    ],
  })
  const pendingSend = send('new', { text: 'Keep this partial', attachments: [] })
  await I.see(exactButton('Keep this partial').wait())
  await I.see(text('Partial').wait())
  await I.see(role('img', 'Generating').within(row('Keep this partial')))
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shoot('generating')

  await I.click(role('menuitem', 'Delete').within(await openActions('Keep this partial')))
  expect(activeChatId()).toBe('new')
  await pendingSend
  await I.see(button('Undo').wait())
  expect(deletedToast()).toContain('Chat deleted · Undo')
  expect(document.querySelectorAll('[data-toast-key="chat-deleted"]')).toHaveLength(1)
  expect(library.chats().some((chat) => chat.title === 'Keep this partial')).toBe(false)
  await expect.poll(async () => {
    const stored = (await repo.listChats()).find((chat) => chat.title === 'Keep this partial')
    const assistant = stored
      ? (await repo.listMessages(stored.id)).find((message) => message.role === 'assistant')
      : undefined
    return Boolean(
      stored?.deletedAt != null &&
        assistant?.content === 'Partial' &&
        assistant.status === 'stopped',
    )
  }).toBe(true)
  await settle()
  await shoot('deleting')
  await I.click(button('Undo'))
  await I.see(exactButton('Keep this partial').wait())
  await I.click(exactButton('Keep this partial'))
  await I.see(text('Partial').wait())

  await I.click(role('menuitem', 'Delete').within(await openActions('Shelf layout')))
  await I.see(button('Undo'))
  expect(deletedToast()).toContain('Chat deleted · Undo')
  await new Promise((resolve) => setTimeout(resolve, 6_500))
  await I.click(role('menuitem', 'Delete').within(await openActions('Clay order')))
  await I.click(role('menuitem', 'Delete').within(await openActions('September kiln')))
  expect(deletedToast()).toContain('3 chats deleted · Undo')
  expect(document.querySelectorAll('[data-toast-key="chat-deleted"]')).toHaveLength(1)
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  expect(deletedToast()).toContain('3 chats deleted · Undo')
  await I.click(button('Undo'))
  await I.see(exactButton('Shelf layout').wait())
  await I.see(exactButton('Clay order'))
  await I.see(exactButton('September kiln'))
  await expect
    .poll(async () => {
      const restored = await Promise.all(
        (['shelf', 'clay', 'september'] as const).map((id) => repo.getChat(id)),
      )
      return restored.every((chat) => chat != null && chat.deletedAt == null)
    })
    .toBe(true)
  await settle()
  expect(
    (await repo.listMessages('shelf')).map((message) => message.content).sort(),
  ).toEqual(['Remember this glaze', 'Version one', 'Version two'].sort())

  await I.click(role('menuitem', 'Delete').within(await openActions('Shelf layout')))
  await expect
    .poll(async () => (await repo.getChat('shelf'))?.deletedAt ?? null)
    .not.toBeNull()
  await remount()
  await I.dontSee(text('Shelf layout'))
  await I.dontSee(text(/chats? deleted/))
  await I.dontSee(button('Undo'))
  expect(await repo.getChat('shelf')).toBeUndefined()
  expect(await repo.listMessages('shelf')).toEqual([])

  await I.click(role('menuitem', 'Delete').within(await openActions('Clay order')))
  expect(deletedToast()).toContain('Chat deleted · Undo')
  await expect.poll(async () => repo.getChat('clay'), { timeout: 12_000 }).toBeUndefined()
  expect(await repo.listMessages('clay')).toEqual([])
  await I.dontSee(exactButton('Clay order'))

  await I.click(role('menuitem', 'Export').within(await openActions('Kiln notes')))
  expect(exported).toEqual(['kiln'])

  forgetKey()
  await I.see(text('Read-only').within(chats()).wait())
  await I.see(text('Connect to continue'))
  await I.see(exactButton('Kiln notes'))
  await I.see(button('⋯').within(row('Kiln notes')))
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shoot('archive')

  IDBObjectStore.prototype.getAll = function getAll(
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['getAll']>
  ) {
    if (this.name === 'chats') {
      throw new DOMException('The operation failed.', 'UnknownError')
    }
    return originalGetAll.apply(this, args)
  }
  await library.reload().catch(() => {})
  await I.see(text("Couldn't open saved chats.").within(chats()).wait())
  await I.see(button('Retry').within(chats()))
  await I.dontSee(text('No chats yet'))
  IDBObjectStore.prototype.getAll = originalGetAll
  await I.click(button('Retry').within(chats()))
  await I.see(exactButton('Kiln notes').wait())
  await I.dontSee(text("Couldn't open saved chats."))
}, 90_000)
