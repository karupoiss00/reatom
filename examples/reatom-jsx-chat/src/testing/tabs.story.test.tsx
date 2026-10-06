import { button, createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { timings } from '../app/timings'
import { getChatModel } from '../chat/chatModel'
import { send } from '../chat/engine'
import {
  deleteChats,
  deletedElsewhere,
  libraryRecords,
  patchChat,
  pendingUndo,
  renameChat,
  undoDelete,
} from '../chat/library'
import { tabId } from '../platform/env'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import type { ChatRecord, MessageRecord } from '../storage/types'
import { reloadFromStorage } from '../sync/fallback'
import { createSyncChannel } from '../sync/bus'
import { isTombstoneHeld } from '../sync/locks'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { chatBodies, mockChatStream } from './openrouter-mock'
import { shot } from './screenshot'
import { closeAllTabs, openTab } from './tabs/harness'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const mayaKey = 'sk-or-v1-maya-tabs'
const mayaId = 'chat-maya'
const otherId = 'chat-other'
const scratchId = 'msg-scratch'
const helloId = 'msg-hello'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))
const withinSecond = { timeout: 1000, interval: 25 }

const originalNow = Date.now
const cleanups: Array<() => void> = []

const keyboard = userEvent.setup() as unknown as UserEvent

const chunk = (content: string, delayMs = 0) => ({
  delayMs,
  data: {
    id: 'gen-tabs',
    object: 'chat.completion.chunk',
    created: 1_710_000_000,
    model: 'openai/gpt-4o-mini',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  },
})

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-27', name)
}

const bodyText = () => document.body.textContent ?? ''

const inView = (element: Element) => {
  const rect = element.getBoundingClientRect()
  expect(rect.width).toBeGreaterThan(0)
  expect(rect.height).toBeGreaterThan(0)
  expect(rect.top).toBeGreaterThanOrEqual(-1)
  expect(rect.left).toBeGreaterThanOrEqual(-1)
  expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1)
  const style = getComputedStyle(element)
  expect(style.visibility).not.toBe('hidden')
  expect(style.display).not.toBe('none')
}

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-send]')

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  Date.now = originalNow
  closeAllTabs()
  unmountApp()
  return page.viewport(desktop.width, desktop.height)
})

test('Maya watches a reply stream across two tabs', async () => {
  await bootApp({
    key: mayaKey,
    remember: true,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: mayaId,
        title: 'Morning notes',
        model: 'openai/gpt-4o-mini',
        messages: [
          { id: helloId, role: 'user', content: 'Hello from Maya' },
          {
            id: scratchId,
            role: 'assistant',
            content: 'Scratch note',
          },
        ],
      },
      { id: otherId, title: 'Other thread', model: 'openai/gpt-4o-mini' },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(mayaId)
  await expect.poll(() => bodyText()).toContain('Scratch note')
  getChatModel(mayaId).draft.text.set('unsent in this tab')

  const tab = await openTab()
  cleanups.push(() => tab.remove())
  await tab.call({
    type: 'boot',
    key: mayaKey,
    remember: true,
    keyMeta: limitedKey,
  })
  expect((await tab.call({ type: 'state' })).sessionMode).toBe('connected')
  await tab.call({ type: 'open', chatId: mayaId })
  await expect
    .poll(() => tab.call({ type: 'read', selector: '[data-slot="ChatScreen"]' }))
    .toContain('Scratch note')

  const deleter = createSyncChannel({ tabId: () => 'tab-deleter' })
  cleanups.push(() => deleter.close())
  await repo.deleteMessage(scratchId)
  deleter.publish({
    type: 'message-deleted',
    chatId: mayaId,
    messageId: scratchId,
  })
  await expect.poll(() => bodyText(), withinSecond).not.toContain('Scratch note')
  await expect
    .poll(
      () => tab.call({ type: 'read', selector: '[data-slot="ChatScreen"]' }),
      withinSecond,
    )
    .not.toContain('Scratch note')
  expect(bodyText()).toContain('Hello from Maya')

  await tab.call({
    type: 'mock-streams',
    scripts: [
      {
        hang: true,
        chunks: [
          chunk('Hello ', 40),
          chunk('from the other tab. ', 280),
          chunk('Still writing.', 900),
        ],
      },
      {
        chunks: [chunk('Sent after stop.')],
      },
    ],
  })
  await tab.call({ type: 'send', chatId: mayaId, text: 'Tell me about Lisbon' })

  await expect.poll(() => bodyText(), { timeout: 2500 }).toContain('from the other tab')
  const generating = document.querySelector('[aria-label="Generating"]')
  expect(generating).toBeTruthy()
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe(
    'This chat is still generating in another tab.',
  )
  expect(sendButton()?.disabled).toBe(true)
  expect(bodyText()).toContain('Stop it in the tab that is generating.')
  expect(getChatModel(mayaId).draft.text()).toBe('unsent in this tab')
  const blockedPosts = chatBodies().length
  send(mayaId, { text: 'Do not send', attachments: [] })
  await settle()
  expect(chatBodies()).toHaveLength(blockedPosts)
  expect((await tab.call({ type: 'state' })).chatRequests).toBe(1)
  inView(generating!)
  inView(document.querySelector('[data-slot="RemoteBanners"]')!)
  await settle()
  await shoot('second-tab-live')
  await shoot('blocked')

  await tab.call({ type: 'open', chatId: otherId })
  await expect
    .poll(() => tab.call({ type: 'state' }))
    .toMatchObject({ path: expect.stringContaining(otherId) })
  openChat(otherId)
  await expect.poll(() => document.querySelector('[aria-label="Generating"]')).toBeTruthy()
  openChat(mayaId)
  await expect.poll(() => bodyText(), { timeout: 2500 }).toContain('Still writing.')

  const requestsBeforeStop = (await tab.call({ type: 'state' })).chatRequests
  await tab.call({ type: 'stop', chatId: mayaId })
  await expect.poll(() => sendButton()?.disabled, withinSecond).toBe(false)
  expect(bodyText()).not.toContain('Stop it in the tab that is generating.')
  await settle()
  await shoot('released')

  await tab.call({ type: 'send', chatId: mayaId, text: 'Continue in the same tab' })
  await expect
    .poll(async () => (await tab.call({ type: 'state' })).chatRequests, {
      timeout: 2000,
    })
    .toBe(requestsBeforeStop + 1)

  const hello = getChatModel(mayaId).messages().get(helloId) as MessageRecord
  await repo.putMessage({
    ...hello,
    content: 'Reloaded from storage',
    rev: hello.rev + 5,
  })
  await repo.putChatFields(mayaId, { title: 'Reloaded title' }, Date.now())
  reloadFromStorage()
  await expect
    .poll(() => document.querySelector('[data-slot="ChatHeader"]')?.textContent)
    .toContain('Reloaded title')
  await expect.poll(() => bodyText()).toContain('Reloaded from storage')
  expect(libraryRecords().some((chat) => chat.title === 'Reloaded title')).toBe(true)

  await tab.call({ type: 'open', chatId: mayaId })
  await tab.call({ type: 'rename', chatId: mayaId, title: 'Lisbon notes' })
  await expect
    .poll(() => document.querySelector('[data-slot="ChatHeader"]')?.textContent, withinSecond)
    .toContain('Lisbon notes')
  expect(bodyText()).toContain('Lisbon notes')

  const frozen = Date.now() + 60_000
  Date.now = () => frozen
  await patchChat(mayaId, { title: 'Parent title', titleSource: 'manual' })
  Date.now = originalNow
  expect(document.querySelector('[data-slot="ChatHeader"]')?.textContent).toContain(
    'Parent title',
  )
  const otherTabId = (await tab.call({ type: 'state' })).tabId
  const record = libraryRecords().find((chat) => chat.id === mayaId) as ChatRecord
  const tieClock = {
    ...record.clock,
    title: record.clock.title,
    'title@by': otherTabId,
  } as ChatRecord['clock']
  const tie = createSyncChannel({ tabId: () => 'tab-tie' })
  cleanups.push(() => tie.close())
  tie.publish({
    type: 'chat',
    chat: { ...record, title: 'Incoming title', clock: tieClock },
  })
  const lowerTitle = tabId < otherTabId ? 'Parent title' : 'Incoming title'
  await expect
    .poll(() => document.querySelector('[data-slot="ChatHeader"]')?.textContent)
    .toContain(lowerTitle)

  mockChatStream({
    hang: true,
    chunks: [chunk('Partial kept', 40)],
  })
  send(mayaId, { text: 'Keep writing', attachments: [] })
  await expect.poll(() => bodyText(), { timeout: 2500 }).toContain('Partial kept')
  expect(timings.undoMs).toBe(8000)
  await tab.call({ type: 'delete', chatIds: [mayaId] })
  await expect.poll(() => bodyText(), withinSecond).toContain(
    'This chat was deleted in another tab.',
  )
  expect(bodyText()).toContain('Partial kept')
  const notice = deletedElsewhere()
  expect(notice?.chatId).toBe(mayaId)
  const tombstone = libraryRecords().find((chat) => chat.id === mayaId)
  expect(tombstone?.deletedAt).not.toBeNull()
  expect(notice!.expiresAt - tombstone!.deletedAt!).toBe(8000)
  await expect.poll(() => isTombstoneHeld(mayaId), withinSecond).toBe(true)
  await settle()
  expect((await repo.getChat(mayaId))?.deletedAt).not.toBeNull()
  const deletedBanner = [...document.querySelectorAll('[data-banner-title]')].find(
    (element) => element.textContent?.includes('deleted in another tab'),
  )
  expect(deletedBanner).toBeTruthy()
  inView(deletedBanner!)
  await shoot('deleted-elsewhere')

  await I.click(button('Undo'))
  await expect.poll(() => bodyText()).not.toContain('deleted in another tab')
  await expect.poll(() => libraryRecords().find((chat) => chat.id === mayaId)?.deletedAt).toBeNull()
  expect((await repo.getChat(mayaId))?.deletedAt).toBeNull()

  openChat(otherId)
  const originalPut = repo.putChatFields.bind(repo)
  repo.putChatFields = () => Promise.reject({ reason: 'blocked', at: Date.now() })
  cleanups.push(() => {
    repo.putChatFields = originalPut
  })
  renameChat(otherId, 'Will not stick')
  await expect.poll(() => bodyText()).toContain(
    "Couldn't save this change: saved chats are unavailable",
  )
  expect(libraryRecords().find((chat) => chat.id === otherId)?.title).toBe('Other thread')
  const conflict = document.querySelector('[data-slot="ConflictBadge"]')
  expect(conflict).toBeTruthy()
  inView(conflict!)
  await settle()
  await shoot('conflict')

  tab.remove()
  repo.putChatFields = originalPut
  deleteChats([mayaId])
  const firstUndo = pendingUndo()
  const firstDeletedAt = libraryRecords().find((chat) => chat.id === mayaId)?.deletedAt
  expect(firstUndo?.ids).toEqual([mayaId])
  expect(firstDeletedAt).toEqual(expect.any(Number))
  const firstDeadline = firstUndo!.expiresAt
  expect(firstDeadline - firstDeletedAt!).toBe(timings.undoMs)

  await new Promise((resolve) => setTimeout(resolve, 3_000))
  deleteChats([otherId])
  const sharedUndo = pendingUndo()
  const secondDeletedAt = libraryRecords().find((chat) => chat.id === otherId)?.deletedAt
  expect(secondDeletedAt).toEqual(expect.any(Number))
  const sharedDeadline = sharedUndo?.expiresAt
  expect(sharedUndo?.ids).toEqual([mayaId, otherId])
  expect(sharedDeadline).toBeGreaterThan(firstDeadline)
  expect(sharedDeadline! - secondDeletedAt!).toBe(timings.undoMs)

  const pastFirstDeadline = firstDeadline + 1_000 - Date.now()
  expect(pastFirstDeadline).toBeGreaterThan(0)
  expect(Date.now() + pastFirstDeadline).toBeLessThan(sharedDeadline!)
  await new Promise((resolve) => setTimeout(resolve, pastFirstDeadline))

  expect(pendingUndo()).toEqual({ ids: [mayaId, otherId], expiresAt: sharedDeadline })
  expect((await repo.getChat(mayaId))?.deletedAt).toEqual(expect.any(Number))
  expect((await repo.getChat(otherId))?.deletedAt).toEqual(expect.any(Number))

  undoDelete()
  expect(libraryRecords().find((chat) => chat.id === mayaId)?.deletedAt).toBeNull()
  expect(libraryRecords().find((chat) => chat.id === otherId)?.deletedAt).toBeNull()
  await expect
    .poll(async () => {
      const restored = await Promise.all([repo.getChat(mayaId), repo.getChat(otherId)])
      return restored.every((chat) => chat != null && chat.deletedAt == null)
    })
    .toBe(true)
})

test('a session-only key leaves the second tab in the archive, and a blocked database keeps the stream on screen', async () => {
  await bootApp({
    key: mayaKey,
    remember: false,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: mayaId,
        title: 'Morning notes',
        model: 'openai/gpt-4o-mini',
        messages: [{ id: helloId, role: 'user', content: 'Hello from Maya' }],
      },
    ],
  })
  openChat(mayaId)
  const tab = await openTab()
  cleanups.push(() => tab.remove())
  await tab.call({ type: 'boot', keyMeta: limitedKey })
  expect((await tab.call({ type: 'state' })).sessionMode).toBe('archive')
  await tab.call({ type: 'open', chatId: mayaId })
  await expect
    .poll(() => tab.call({ type: 'read', selector: '[data-slot="Sidebar"]' }))
    .toContain('Read-only')
  await expect
    .poll(() => tab.call({ type: 'read', selector: '[data-slot="ChatScreen"]' }))
    .toContain('Hello from Maya')
  expect(
    await tab.call({ type: 'read', selector: '[data-slot="ConnectBar"]' }),
  ).toContain('Connect to continue')

  mockChatStream({
    hang: true,
    chunks: [chunk('Visible ', 20), chunk('tokens', 1600)],
  })
  send(mayaId, { text: 'Share this line', attachments: [] })
  await expect.poll(() => bodyText(), { timeout: 2500 }).toContain('Visible')
  await expect
    .poll(() => tab.call({ type: 'read', selector: '[data-slot="ChatScreen"]' }), {
      timeout: 2500,
    })
    .toContain('Visible')

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('atelier')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('deleteDatabase failed'))
  })

  await expect.poll(() => bodyText(), { timeout: 3000 }).toContain('Visible tokens')
  await expect.poll(() => bodyText(), { timeout: 3000 }).toContain('Not saved on this device')
  expect(document.querySelector('[data-slot="Thread"] [data-spinner]')).toBeNull()
  await expect
    .poll(() => tab.call({ type: 'read', selector: '[data-slot="Sidebar"]' }))
    .toContain("Couldn't open saved chats.")
  expect(
    await tab.call({ type: 'read', selector: '[data-slot="Sidebar"]' }),
  ).toContain('Retry')
})
