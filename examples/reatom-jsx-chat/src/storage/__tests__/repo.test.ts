import { expect, test, vi } from 'vitest'

import { sessionMode } from '../../auth/session'
import * as platformEnv from '../../platform/env'
import { now } from '../../platform/env'
import { holdTombstone, isTombstoneHeld } from '../../sync/locks'
import { bootApp, slot, unmountApp } from '../../testing/boot'
import { getConnection } from '../db'
import {
  createChatRecord,
  createDefaultChatSettings,
  dbHealth,
  initStorage,
  mergeChatRecord,
  repo,
  retryOpenStorage,
  writeFailure,
} from '../index'
import { resetRepoBackend, StorageReadError } from '../repo'
import type { AssistantMessage, ChatRecord, PresetRecord } from '../types'

const chatId = 'chat-hello'
const messageId = 'message-hello'

const assistant = (
  patch: Partial<AssistantMessage> &
    Pick<AssistantMessage, 'id' | 'content' | 'rev'>,
): AssistantMessage => ({
  role: 'assistant',
  chatId,
  parentId: null,
  createdAt: 1,
  model: 'openai/gpt-4o-mini',
  status: 'streaming',
  reasoning: null,
  refusal: null,
  finishReason: null,
  error: null,
  usage: null,
  extraUsage: [],
  estimateCost: 0,
  generationId: null,
  provider: null,
  timing: { requestAt: 1, firstTokenAt: null, endAt: null },
  citations: [],
  ownerTab: 'tab-a',
  compareGroup: null,
  ...patch,
})

const preset = (
  id: string,
  deletedAt: number | null,
): PresetRecord => ({
  id,
  name: id,
  systemPrompt: '',
  model: null,
  params: {},
  isDefault: false,
  createdAt: 1,
  deletedAt,
  deletedByTab: deletedAt === null ? null : 'tab-b',
})

const readIndexedRecord = async (
  storeName: string,
  key: IDBValidKey,
): Promise<unknown> => {
  const names = (await indexedDB.databases()).map((entry) => entry.name)
  if (!names.includes('atelier')) return undefined
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('atelier')
    request.onupgradeneeded = () => {
      request.transaction?.abort()
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('missing atelier database'))
  })
  database.onversionchange = () => database.close()
  try {
    if (!database.objectStoreNames.contains(storeName)) return undefined
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

const countIndexed = async (storeName: string): Promise<number | undefined> => {
  const names = (await indexedDB.databases()).map((entry) => entry.name)
  if (!names.includes('atelier')) return undefined
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('atelier')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('missing atelier database'))
  })
  database.onversionchange = () => database.close()
  try {
    if (!database.objectStoreNames.contains(storeName)) return undefined
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

test('Fixture: tab B loaded the prefix "HE", tab A painted "HELLO", then tab B renames. After both tabs reload, the text is "HELLO" and the title is tab B\'s rename.', async () => {
  await initStorage()
  await repo.createChat(
    createChatRecord({ id: chatId, at: 1, title: 'Draft title' }),
  )
  await repo.putMessage(assistant({ id: messageId, content: 'HE', rev: 1 }))
  await repo.putMessage(
    assistant({ id: messageId, content: 'HELLO', rev: 2, ownerTab: 'tab-a' }),
  )
  await repo.putMessage(
    assistant({ id: messageId, content: 'HE', rev: 1, ownerTab: 'tab-b' }),
  )
  const renamed = await repo.putChatFields(
    chatId,
    { title: 'Tab B', titleSource: 'manual' },
    20,
  )

  expect(renamed.title).toBe('Tab B')
  const persisted = await readIndexedRecord('messages', messageId)
  const persistedChat = await readIndexedRecord('chats', chatId)
  expect(persisted).toMatchObject({ content: 'HELLO', rev: 2 })
  expect(persistedChat).toMatchObject({ title: 'Tab B', titleSource: 'manual' })
})

test('Chat metadata (title, pinned, model, settings) is last-write-wins per field.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1, title: 'New chat' }))
  const originalSettings = createDefaultChatSettings()
  await repo.putChatFields(
    chatId,
    {
      title: 'First',
      pinnedAt: 1,
      model: 'openai/gpt-4o-mini',
      settings: originalSettings,
    },
    100,
  )
  await repo.putChatFields(
    chatId,
    { title: 'stale title', model: 'stale/model' },
    50,
  )
  await repo.putChatFields(chatId, { title: 'Second' }, 200)
  await repo.putChatFields(chatId, { pinnedAt: 9 }, 150)
  const nextSettings = { ...originalSettings, webSearch: true }
  const merged = await repo.putChatFields(
    chatId,
    { settings: nextSettings },
    300,
  )

  expect(merged.title).toBe('Second')
  expect(merged.pinnedAt).toBe(9)
  expect(merged.model).toBe('openai/gpt-4o-mini')
  expect(merged.settings.webSearch).toBe(true)
  expect(merged.clock).toMatchObject({
    title: 200,
    pinnedAt: 150,
    model: 100,
    settings: 300,
  })
  expect(await readIndexedRecord('chats', chatId)).toMatchObject({
    title: 'Second',
    pinnedAt: 9,
    model: 'openai/gpt-4o-mini',
  })
})

test('Persistence merges by message id. A stored record with rev >= the incoming rev wins.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1 }))
  await repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 3 }))
  await repo.putMessage(assistant({ id: messageId, content: 'HE', rev: 2 }))
  await repo.putMessage(assistant({ id: messageId, content: 'OTHER', rev: 3 }))
  await repo.putMessage(assistant({ id: messageId, content: 'NEXT', rev: 4 }))

  expect(await readIndexedRecord('messages', messageId)).toMatchObject({
    content: 'NEXT',
    rev: 4,
  })
  const listed = await repo.listMessages(chatId)
  expect(listed).toHaveLength(1)
  expect(listed[0]).toMatchObject({ content: 'NEXT', rev: 4 })
})

test('When a flush fails (quota or a blocked database): the write is not retried on every chunk', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1 }))
  await repo.putMessage(assistant({ id: messageId, content: 'HE', rev: 1 }))

  const originalPut = IDBObjectStore.prototype.put
  let messagePuts = 0
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    if (this.name === 'messages') {
      messagePuts += 1
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError',
      )
    }
    return originalPut.apply(this, args)
  }

  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T03:30:00Z'))
  try {
    await expect(
      repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 2 })),
    ).rejects.toEqual({ reason: 'quota', at: now() })
    const failure = writeFailure()
    expect(failure).toEqual({ reason: 'quota', at: now() })
    vi.setSystemTime(new Date('2026-10-05T03:30:05Z'))
    await expect(
      repo.putMessage(assistant({ id: messageId, content: 'HELLO!', rev: 3 })),
    ).rejects.toEqual(failure)
    await expect(
      repo.putMessage(assistant({ id: messageId, content: 'HELLO!!', rev: 4 })),
    ).rejects.toEqual(failure)
    expect(writeFailure()).toEqual(failure)
    expect(messagePuts).toBe(1)
    expect(await repo.listMessages(chatId)).toMatchObject([
      { content: 'HELLO!!', rev: 4 },
    ])
    expect(await readIndexedRecord('messages', messageId)).toMatchObject({
      content: 'HE',
      rev: 1,
    })
  } finally {
    IDBObjectStore.prototype.put = originalPut
    vi.useRealTimers()
  }

  await retryOpenStorage()
  expect(await readIndexedRecord('messages', messageId)).toMatchObject({
    content: 'HELLO!!',
    rev: 4,
  })
  expect(await repo.listMessages(chatId)).toMatchObject([
    { content: 'HELLO!!', rev: 4 },
  ])
})

test('IndexedDB fails to open at boot (Safari private mode and equivalents): Send works in memory.', async () => {
  const originalOpen = indexedDB.open.bind(indexedDB)
  indexedDB.open = (() => {
    throw new DOMException(
      'The user denied permission to access the database.',
      'SecurityError',
    )
  }) as typeof indexedDB.open
  try {
    await initStorage()
    expect(dbHealth()).toEqual({ status: 'memory', reason: 'open-failed' })
    await repo.createChat(
      createChatRecord({ id: chatId, at: 1, title: 'Only this tab' }),
    )
    await repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 1 }))
    await initStorage()
    expect(dbHealth()).toEqual({ status: 'memory', reason: 'open-failed' })
    expect(await repo.getChat(chatId)).toMatchObject({ title: 'Only this tab' })
    expect(await repo.listMessages(chatId)).toMatchObject([{ content: 'HELLO' }])
  } finally {
    indexedDB.open = originalOpen as typeof indexedDB.open
  }
})

test('At start, each tab purges every tombstone whose deleting tab no longer holds the Web Lock `tombstone:<id>`.', async () => {
  await initStorage({ isTombstoneHeld })
  const heldChat = createChatRecord({ id: 'held-chat', at: 1, title: 'Held' })
  const freeChat = createChatRecord({ id: 'free-chat', at: 1, title: 'Free' })
  heldChat.deletedAt = 10
  heldChat.deletedByTab = 'tab-a'
  freeChat.deletedAt = 10
  freeChat.deletedByTab = 'tab-a'
  await repo.createChat(heldChat)
  await repo.createChat(freeChat)
  await repo.putPreset(preset('held-preset', 10))
  await repo.putPreset(preset('free-preset', 10))
  await repo.putPreset(preset('live-preset', null))
  const heldChatLock = holdTombstone('held-chat', 60_000)
  const heldPresetLock = holdTombstone('held-preset', 60_000)
  try {
    await initStorage({ isTombstoneHeld })
    const chats = await repo.listChats()
    const presets = await repo.listPresets()
    expect(chats.map((chat) => chat.id).sort()).toEqual(['held-chat'])
    expect(presets.map((item) => item.id).sort()).toEqual([
      'held-preset',
      'live-preset',
    ])
    expect(await readIndexedRecord('chats', 'free-chat')).toBeUndefined()
    expect(await readIndexedRecord('chats', 'held-chat')).toMatchObject({
      id: 'held-chat',
    })
  } finally {
    heldChatLock.release()
    heldPresetLock.release()
  }
})

test('Removes chats and presets but keeps the key.', async () => {
  localStorage.setItem('atelier.key', 'sk-or-v1-test-session-key')
  localStorage.setItem('atelier.theme', 'dark')
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1, title: 'Gone' }))
  await repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 1 }))
  await repo.putPreset(preset('preset-1', null))
  expect(await countIndexed('chats')).toBe(1)

  await repo.deleteAllChatsAndPresets()

  const tombstoned = await repo.listChats()
  expect(tombstoned).toMatchObject([
    { id: chatId, deletedAt: expect.any(Number), deletedByTab: expect.any(String) },
  ])
  expect(await repo.listMessages(chatId)).toMatchObject([{ content: 'HELLO' }])
  expect(await countIndexed('chats')).toBe(1)
  expect(await countIndexed('messages')).toBe(1)
  expect(localStorage.getItem('atelier.key')).toBe('sk-or-v1-test-session-key')
  expect(localStorage.getItem('atelier.theme')).toBe('dark')
  expect((await indexedDB.databases()).map((entry) => entry.name)).toContain(
    'atelier',
  )

  await initStorage({ isTombstoneHeld })
  expect(await repo.listChats()).toEqual([])
  expect(await repo.listPresets()).toEqual([])
  expect(await repo.listMessages(chatId)).toEqual([])
  expect(await countIndexed('chats')).toBe(0)
  expect(await countIndexed('presets')).toBe(0)
  expect(await countIndexed('messages')).toBe(0)
  expect(localStorage.getItem('atelier.key')).toBe('sk-or-v1-test-session-key')
})

test('On an IndexedDB versionchange or a blocked connection, the streaming tab keeps painting tokens in memory', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1 }))
  await repo.putMessage(assistant({ id: messageId, content: 'HE', rev: 1 }))

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('atelier')
    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('deleteDatabase failed'))
  })

  expect(dbHealth()).toEqual({ status: 'error', reason: 'blocked' })
  await expect(
    repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 2 })),
  ).rejects.toMatchObject({ reason: 'blocked' })
  await expect(
    repo.putMessage(assistant({ id: messageId, content: 'HELLO!', rev: 3 })),
  ).rejects.toMatchObject({ reason: 'blocked' })
  expect(writeFailure()?.reason).toBe('blocked')
  await expect(repo.listChats()).rejects.toBeInstanceOf(StorageReadError)

  await initStorage()
  expect(await repo.listMessages(chatId)).toMatchObject([
    { content: 'HELLO!', rev: 3 },
  ])
  expect(await readIndexedRecord('messages', messageId)).toMatchObject({
    content: 'HELLO!',
    rev: 3,
  })
})

test('Drafts are stored by chat and tab, and attachments round-trip through IndexedDB.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1 }))
  await repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 1 }))
  await repo.putDraft({
    chatId,
    tabId: 'tab-a',
    text: 'mine',
    attachments: [],
    updatedAt: 3,
  })
  await repo.putDraft({
    chatId,
    tabId: 'tab-b',
    text: 'newer',
    attachments: [],
    updatedAt: 5,
  })
  await repo.putAttachment({ id: 'blob-1', dataUrl: 'data:text/plain,hi' })

  expect(await repo.getDraft(chatId, 'tab-a')).toMatchObject({ text: 'mine' })
  expect(await repo.latestDraft(chatId)).toMatchObject({
    tabId: 'tab-b',
    text: 'newer',
  })
  expect(await readIndexedRecord('drafts', [chatId, 'tab-b'])).toMatchObject({
    text: 'newer',
  })
  expect(await readIndexedRecord('attachments', 'blob-1')).toMatchObject({
    dataUrl: 'data:text/plain,hi',
  })
  let visited = 0
  await repo.scanMessages(() => {
    visited += 1
    return true
  })
  expect(visited).toBe(1)
})

test('A failed read throws StorageReadError instead of an empty library.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1, title: 'Kept' }))
  const originalGetAll = IDBObjectStore.prototype.getAll
  IDBObjectStore.prototype.getAll = function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['getAll']>
  ) {
    if (this.name === 'chats') {
      throw new DOMException('The operation failed.', 'UnknownError')
    }
    return originalGetAll.apply(this, args)
  }
  try {
    await expect(repo.listChats()).rejects.toBeInstanceOf(StorageReadError)
    expect(dbHealth()).toEqual({ status: 'error', reason: 'read-failed' })
  } finally {
    IDBObjectStore.prototype.getAll = originalGetAll
  }
})

test('putChatFields merges settings per sub-field so a system prompt and web search from two tabs both survive.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1 }))
  const base = createDefaultChatSettings()
  await repo.putChatFields(
    chatId,
    { settings: { ...base, systemPrompt: 'Be brief' } },
    100,
  )
  const merged = await repo.putChatFields(
    chatId,
    { settings: { ...base, webSearch: true } },
    200,
  )
  expect(merged.settings.systemPrompt).toBe('Be brief')
  expect(merged.settings.webSearch).toBe(true)
  const cleared = await repo.putChatFields(
    chatId,
    { settings: { ...merged.settings, systemPrompt: '' } },
    300,
  )
  expect(cleared.settings.systemPrompt).toBe('')
  expect(cleared.settings.webSearch).toBe(true)
})

test('Equal chat clocks tie-break by tabId, read live from the platform env.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1, title: 'New chat' }))
  const stamped = await repo.putChatFields(chatId, { title: 'From this tab' }, 50)
  expect((stamped.clock as Record<string, unknown>)['title@by']).toBe(
    platformEnv.tabId,
  )
  const local: ChatRecord = {
    ...stamped,
    title: 'From A',
    clock: { ...stamped.clock, title: 50 },
  }
  ;(local.clock as Record<string, unknown>)['title@by'] = 'tab-a'
  const incoming: ChatRecord = {
    ...local,
    title: 'From B',
    clock: { ...local.clock, title: 50 },
  }
  ;(incoming.clock as Record<string, unknown>)['title@by'] = 'tab-b'
  expect(mergeChatRecord(local, incoming).title).toBe('From A')
  ;(incoming.clock as Record<string, unknown>)['title@by'] = 'tab-0'
  expect(mergeChatRecord(local, incoming).title).toBe('From B')
  const bareLocal: ChatRecord = {
    ...stamped,
    title: 'Local',
    clock: { title: 40 },
  }
  const bareIncoming: ChatRecord = {
    ...stamped,
    title: 'Incoming',
    clock: { title: 40 },
  }
  expect(mergeChatRecord(bareLocal, bareIncoming).title).toBe('Incoming')
})

test('bulkImport clock-merges chats instead of overwriting a newer field.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1, title: 'New chat' }))
  await repo.putChatFields(chatId, { title: 'Kept' }, 200)
  await repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 4 }))
  const stored = await repo.getChat(chatId)
  await repo.bulkImport({
    chats: [{ ...stored!, title: 'Stale import', clock: { title: 50 } }],
    messages: [assistant({ id: messageId, content: 'HE', rev: 1 })],
    presets: [],
    attachments: [],
  })
  expect(await repo.getChat(chatId)).toMatchObject({ title: 'Kept' })
  expect(await readIndexedRecord('messages', messageId)).toMatchObject({
    content: 'HELLO',
    rev: 4,
  })
})

test('A DataCloneError is not a storage-quota failure.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1 }))
  const message = assistant({ id: messageId, content: 'HELLO', rev: 1 })
  Object.assign(message, { bad: () => undefined })
  await expect(repo.putMessage(message)).rejects.toMatchObject({
    name: 'DataCloneError',
  })
  expect(writeFailure()).toBeNull()
  expect(await repo.listMessages(chatId)).toEqual([])
})

test('putMessage rejects when the chat does not exist.', async () => {
  await initStorage()
  await expect(
    repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 1 })),
  ).rejects.toThrow('Chat chat-hello is not stored')
  expect(writeFailure()).toBeNull()
})

test('resetRepoBackend drops the cached repo and closes IndexedDB connections.', async () => {
  await initStorage()
  await repo.createChat(createChatRecord({ id: chatId, at: 1, title: 'Cached' }))
  expect(getConnection()).not.toBeNull()
  resetRepoBackend()
  expect(getConnection()).toBeNull()
  expect(await repo.getChat(chatId)).toBeUndefined()
  await initStorage()
  expect(await repo.getChat(chatId)).toMatchObject({ title: 'Cached' })
})

test('IndexedDB recovery imports the in-memory fallback instead of dropping it.', async () => {
  const originalOpen = indexedDB.open.bind(indexedDB)
  indexedDB.open = (() => {
    throw new DOMException(
      'The user denied permission to access the database.',
      'SecurityError',
    )
  }) as typeof indexedDB.open
  try {
    await initStorage()
    await repo.createChat(
      createChatRecord({ id: chatId, at: 1, title: 'Only this tab' }),
    )
    await repo.putMessage(assistant({ id: messageId, content: 'HELLO', rev: 1 }))
  } finally {
    indexedDB.open = originalOpen as typeof indexedDB.open
  }
  await initStorage()
  expect(dbHealth()).toEqual({ status: 'ok' })
  expect(await repo.getChat(chatId)).toMatchObject({ title: 'Only this tab' })
  expect(await readIndexedRecord('chats', chatId)).toMatchObject({
    title: 'Only this tab',
  })
  expect(await readIndexedRecord('messages', messageId)).toMatchObject({
    content: 'HELLO',
  })
})

test('bootApp calls boot and waits until sessionMode is not booting; slots are found via data-slot', async () => {
  try {
    await bootApp()
    expect(sessionMode()).not.toBe('booting')
    expect(slot('Shell')).toBeInstanceOf(HTMLElement)
    expect(slot('Welcome')).toBeInstanceOf(HTMLElement)
    expect(slot('ChatScreen')).toBeNull()

    await bootApp({
      key: 'sk-or-v1-test-session-key',
      remember: false,
      seed: [
        {
          id: 'seeded-chat',
          title: 'Seeded',
          messages: [{ role: 'user', content: 'Hi from seed' }],
        },
      ],
    })
    expect(sessionMode()).toBe('connected')
    expect(slot('ChatScreen')).toBeInstanceOf(HTMLElement)
    expect(slot('Welcome')).toBeNull()
    expect(await repo.getChat('seeded-chat')).toMatchObject({ title: 'Seeded' })
    expect(await repo.listMessages('seeded-chat')).toMatchObject([
      { role: 'user', content: 'Hi from seed' },
    ])
  } finally {
    unmountApp()
  }
})
