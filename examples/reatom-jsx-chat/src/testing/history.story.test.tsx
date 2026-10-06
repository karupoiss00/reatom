import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, role, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { defaultTimings } from '../app/timings'
import { forgetKey, sessionMode } from '../auth'
import { getChatModel, pendingUndo, stop } from '../chat'
import { libraryRecords } from '../chat/library'
import { localStreams } from '../chat/streams'
import { resetRuntime } from '../platform/runtime'
import { activeChatId, openChat } from '../routes'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels } from './fixtures/models'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockKey,
  mockModels,
  openRouterRequests,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const lenaKey = 'sk-or-v1-lena-history'
const chatA = 'chat-a'
const chatB = 'chat-b'
const shelfId = 'shelf'
const morningDraft = 'Morning draft'
const kilnDraft = 'Kiln draft'
const riverLine = 'The river keeps its own hours and the banks stay dark. '
const kilnLine = 'The kiln held its heat while the glaze settled. '

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
  clear: (element: Element) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

let extraUnmount: (() => void) | null = null

const exactButton = (name: string) => button(name).options({ exact: true })

const chats = () => role('complementary', 'Chats')

const row = (title: string) => role('listitem', new RegExp(title))

const composer = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const thread = () => document.querySelector<HTMLElement>('[data-slot="Thread"]')

const distanceFromEnd = (scroller: HTMLElement) =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

const routePanel = () => document.querySelector<HTMLElement>('[data-slot="RoutePanels"]')

const deletedToast = () =>
  document
    .querySelector('[data-toast-key="chat-deleted"]')
    ?.textContent?.replace(/\s+/g, ' ')
    .trim() ?? ''

const assistantText = (id: string) =>
  [...getChatModel(id).messages().values()]
    .filter((message) => message.role === 'assistant')
    .map((message) => message.content)
    .join('\n')

const chunk = (content: string) => ({
  id: 'gen-history-1',
  object: 'chat.completion.chunk',
  created: 1_710_000_000,
  model: 'openai/gpt-4o-mini',
  choices: [{ index: 0, delta: { content }, finish_reason: null }],
})

const resetLocation = (path = '/') => {
  if (`${location.pathname}${location.search}${location.hash}` !== path) {
    history.replaceState(null, '', path)
  }
}

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  ;(document.activeElement as HTMLElement | null)?.blur()
  await settle()
  await shot('F-28', name)
}

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

const writeDraft = async (value: string) => {
  const field = composer()
  if (!field) throw new Error('missing composer')
  field.focus()
  await keyboard.clear(field)
  if (value) await keyboard.keyboard(value)
  await expect.poll(() => composer()?.value ?? '').toBe(value)
}

const sessionHistoryCap = 50

const locationUrl = () => `${location.pathname}${location.search}${location.hash}`

const openTitledChat = async (id: string, title: string) => {
  const before = history.length
  const previousUrl = locationUrl()
  await I.click(exactButton(title))
  await expect.poll(() => location.pathname).toBe(`/c/${id}`)
  if (before < sessionHistoryCap) {
    await expect.poll(() => history.length).toBe(before + 1)
  } else {
    history.back()
    await expect.poll(() => locationUrl()).toBe(previousUrl)
    history.forward()
    await expect.poll(() => location.pathname).toBe(`/c/${id}`)
  }
  await expect.poll(() => activeChatId()).toBe(id)
}

const reloadAt = async (path: string, options?: { key?: boolean }) => {
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(catalogModels)
  if (options?.key !== false) mockKey(limitedKey)
  history.replaceState(null, '', path)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot()
  await expect.poll(() => sessionMode()).not.toBe('booting')
  history.replaceState(null, '', path)
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Lena uses Back, Forward, and dead links', async () => {
  expect(defaultTimings.undoMs).toBe(8000)
  resetLocation('/')
  await bootApp({
    key: lenaKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: chatA,
        title: 'Morning notes',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Tell me about the river' },
          { role: 'assistant', content: riverLine.repeat(48) },
        ],
      },
      {
        id: chatB,
        title: 'Evening kiln',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'How hot was the kiln?' },
          { role: 'assistant', content: kilnLine.repeat(48) },
        ],
      },
      {
        id: shelfId,
        title: 'River shelf',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Glaze notes for the river shelf' },
          { role: 'assistant', content: 'Cone six, held for ten minutes.' },
        ],
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await I.see(chats().options({ timeout: 10_000 }).wait())
  await expect.poll(() => activeChatId()).toBe('new')
  expect(location.pathname).toBe('/')

  const emptyHistory = history.length
  await I.click(button('New chat').within(chats()))
  await I.click(button('New chat').within(chats()))
  await settle()
  expect(history.length).toBe(emptyHistory)
  expect(location.pathname).toBe('/')
  expect(activeChatId()).toBe('new')

  await openTitledChat(chatA, 'Morning notes')
  await writeDraft(morningDraft)
  const morningScroller = thread()
  expect(morningScroller).toBeTruthy()
  await expect
    .poll(() => (morningScroller!.scrollHeight > morningScroller!.clientHeight + 80
      ? distanceFromEnd(morningScroller!)
      : 999))
    .toBeLessThanOrEqual(40)
  const afterMorning = history.length
  await I.click(exactButton('Morning notes'))
  await settle()
  expect(history.length).toBe(afterMorning)
  expect(location.pathname).toBe(`/c/${chatA}`)

  await openTitledChat(chatB, 'Evening kiln')
  expect(location.pathname).toBe(`/c/${chatB}`)
  await writeDraft(kilnDraft)
  const kilnScroller = thread()
  expect(kilnScroller).toBeTruthy()
  await expect
    .poll(() => (kilnScroller!.scrollHeight > kilnScroller!.clientHeight + 80
      ? distanceFromEnd(kilnScroller!)
      : 999))
    .toBeLessThanOrEqual(40)

  history.back()
  await expect.poll(() => location.pathname).toBe(`/c/${chatA}`)
  await expect.poll(() => activeChatId()).toBe(chatA)
  await expect.poll(() => composer()?.value ?? '').toBe(morningDraft)
  const restoredScroller = thread()
  expect(restoredScroller).toBeTruthy()
  await expect
    .poll(() => distanceFromEnd(restoredScroller!))
    .toBeLessThanOrEqual(40)
  expect(restoredScroller!.scrollHeight).toBeGreaterThan(restoredScroller!.clientHeight + 80)
  expect(document.body.textContent ?? '').toContain('Tell me about the river')
  await shoot('restored')

  history.forward()
  await expect.poll(() => location.pathname).toBe(`/c/${chatB}`)
  await expect.poll(() => activeChatId()).toBe(chatB)
  await expect.poll(() => composer()?.value ?? '').toBe(kilnDraft)

  mockChatStream({
    hang: true,
    chunks: [
      { data: chunk('Still writing ') },
      { delayMs: 2_000, data: chunk('after navigation') },
    ],
  })
  const postsBeforeSend = chatBodies().length
  await writeDraft('Keep going')
  await keyboard.keyboard('{Enter}')
  await expect.poll(() => thread()?.textContent ?? '').toContain('Keep going')
  await expect.poll(() => composer()?.value ?? 'pending').toBe('')
  await expect.poll(() => localStreams().has(chatB)).toBe(true)
  await expect.poll(() => chatBodies().length).toBe(postsBeforeSend + 1)
  const postsDuringStream = chatBodies().length

  history.back()
  await expect.poll(() => location.pathname).toBe(`/c/${chatA}`)
  expect(chatBodies()).toHaveLength(postsDuringStream)
  expect(localStreams().has(chatB)).toBe(true)
  expect(localStreams().get(chatB)?.controller.signal.aborted).toBe(false)
  await expect
    .poll(() => assistantText(chatB), { timeout: 6_000 })
    .toContain('after navigation')
  expect(location.pathname).toBe(`/c/${chatA}`)
  expect(chatBodies()).toHaveLength(postsDuringStream)
  expect(localStreams().get(chatB)?.controller.signal.aborted).toBe(false)

  history.forward()
  await expect.poll(() => location.pathname).toBe(`/c/${chatB}`)
  await expect.poll(() => document.body.textContent ?? '').toContain('after navigation')
  expect(chatBodies()).toHaveLength(postsDuringStream)
  expect(localStreams().get(chatB)?.controller.signal.aborted).toBe(false)
  stop(chatB)

  await I.click(role('menuitem', 'Delete').within(await openActions('River shelf')))
  await I.see(button('Undo').wait())
  const tombstone = libraryRecords().find((chat) => chat.id === shelfId)
  expect(tombstone?.deletedAt).not.toBeNull()
  expect(pendingUndo()?.ids).toContain(shelfId)
  expect(pendingUndo()!.expiresAt - tombstone!.deletedAt!).toBe(8000)

  const postsBeforeDeadLink = chatBodies().length
  const requestsBeforeDeadLink = openRouterRequests().length
  openChat(shelfId)
  await expect.poll(() => location.pathname).toBe(`/c/${shelfId}`)
  await expect
    .poll(() => document.body.textContent ?? '')
    .toContain('Glaze notes for the river shelf')
  expect(deletedToast()).toMatch(/Chat deleted · \d+s/)
  expect(deletedToast()).toContain('Undo')
  const shownSeconds = Number(deletedToast().match(/(\d+)s/)?.[1])
  const expectedSeconds = Math.ceil((pendingUndo()!.expiresAt - Date.now()) / 1000)
  expect(shownSeconds).toBeGreaterThan(0)
  expect(shownSeconds).toBeLessThanOrEqual(8)
  expect(Math.abs(shownSeconds - expectedSeconds)).toBeLessThanOrEqual(1)
  expect(chatBodies()).toHaveLength(postsBeforeDeadLink)
  expect(openRouterRequests()).toHaveLength(requestsBeforeDeadLink)

  await expect
    .poll(() => routePanel()?.textContent ?? '', { timeout: 12_000 })
    .toContain('This chat was deleted.')
  expect(location.pathname).toBe(`/c/${shelfId}`)
  expect(routePanel()?.textContent ?? '').toContain('New chat')
  expect(document.body.textContent ?? '').not.toContain('Glaze notes for the river shelf')
  await shoot('deleted')

  await reloadAt(`/c/${shelfId}`)
  await expect.poll(() => location.pathname).toBe(`/c/${shelfId}`)
  await expect.poll(() => routePanel()?.textContent ?? '').toContain('This chat was deleted.')
  expect(routePanel()?.textContent ?? '').toContain('New chat')
  expect(document.querySelector('[data-toast-key="chat-deleted"]')).toBeNull()

  const postsBeforeUnknown = chatBodies().length
  const requestsBeforeUnknown = openRouterRequests().length
  openChat('missing-chat')
  await expect.poll(() => location.pathname).toBe('/c/missing-chat')
  await expect.poll(() => routePanel()?.textContent ?? '').toContain('No chat with this link.')
  expect(routePanel()?.textContent ?? '').toContain('New chat')
  expect(chatBodies()).toHaveLength(postsBeforeUnknown)
  expect(openRouterRequests()).toHaveLength(requestsBeforeUnknown)
  await shoot('unknown')

  forgetKey()
  await reloadAt(`/c/${chatB}`, { key: false })
  await expect.poll(() => sessionMode()).toBe('archive')
  await expect.poll(() => location.pathname).toBe(`/c/${chatB}`)
  await expect.poll(() => document.body.textContent ?? '').toContain('How hot was the kiln?')
  await I.see(text('Connect to continue').wait())
  expect(document.querySelector('[data-slot="ConnectBar"]')).toBeInstanceOf(HTMLElement)
  expect(composer()).toBeNull()
  expect(chatBodies()).toHaveLength(0)
  await shoot('read-only')
}, 60_000)
