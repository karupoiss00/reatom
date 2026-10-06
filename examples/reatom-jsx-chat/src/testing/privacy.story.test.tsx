import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { ui } from '../app/ui'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { globalPrivacy } from '../storage/prefs'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
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
const storyKey = 'sk-or-v1-privacy-story'
const promptChatId = 'chat-prompt'
const privacyChatId = 'chat-privacy'
const britishPrompt = 'Answer briefly, in British English'
const versePrompt = 'Answer in verse.'
const abortedPrompt = 'ABORTED prompt'
const keptPrompt = 'ABORTED promptx'
const unsavedPrompt = 'UNSAVED line'
const accountCopy =
  "OpenRouter itself doesn't store prompts unless you opt in on your OpenRouter account."
const webSearchWarning = 'Web search may not work with zero data retention'
const storageFull = 'Browser storage is full. Export and delete old chats.'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

type ChatBody = {
  messages?: Array<{ role?: string; content?: unknown }>
  provider?: { data_collection?: string; zdr?: boolean }
}

let extraUnmount: (() => void) | null = null
let restorePut: (() => void) | null = null
let restoreStorePut: (() => void) | null = null

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot(flowId, name)
}

const headerChips = () =>
  document.querySelector<HTMLElement>('[data-slot="ChatHeaderChips"]')

const openDialog = () =>
  document.querySelector<HTMLDialogElement>('dialog[open]')

const promptField = () =>
  openDialog()?.querySelector<HTMLTextAreaElement>(
    '[data-slot="PromptSection"] textarea',
  ) ??
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="PromptSection"] textarea',
  )

const privacyRoot = () =>
  openDialog()?.querySelector<HTMLElement>('[data-slot="PrivacySection"]') ??
  null

const composer = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const bodyAt = (index: number) => chatBodies()[index] as ChatBody | undefined

const switchNamed = (root: ParentNode, name: string) => {
  const input = [...root.querySelectorAll('input[role="switch"]')].find((el) =>
    el.closest('label')?.textContent?.includes(name),
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`missing switch ${name}`)
  }
  return input
}

const inView = (element: Element) => {
  const box = element.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(box.top).toBeGreaterThanOrEqual(0)
  expect(box.left).toBeGreaterThanOrEqual(0)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1)
}

const closeDialogs = () => {
  ui.chatSettings.set(null)
  ui.appSettings.set(null)
}

const openChatSettings = async (section: 'prompt' | 'privacy') => {
  closeDialogs()
  ui.chatSettings.set(section)
  await expect
    .poll(() =>
      document.querySelector('[data-slot="ChatSettings"] dialog')?.hasAttribute(
        'open',
      ),
    )
    .toBe(true)
}

const openAppPrivacy = async () => {
  closeDialogs()
  ui.appSettings.set('privacy')
  await expect
    .poll(() => privacyRoot()?.textContent ?? '')
    .toContain('Exclude providers that may train on my data')
}

const replacePrompt = async (value: string) => {
  const field = promptField()
  expect(field).toBeInstanceOf(HTMLTextAreaElement)
  field!.focus()
  field!.select()
  if (value.length === 0) await keyboard.keyboard('{Backspace}')
  else await keyboard.keyboard(value)
  await expect
    .poll(async () => (await repo.getChat(promptChatId))?.settings.systemPrompt, {
      timeout: 3_000,
    })
    .toBe(value)
}

const sendLine = async (chatId: string, value: string, posts: number) => {
  closeDialogs()
  await expect.poll(() => document.querySelector('dialog[open]')).toBeNull()
  const field = composer()
  if (!field) throw new Error('missing composer')
  field.focus()
  activeChat().draft.text.set(value)
  await expect.poll(() => sendButton()?.disabled).toBe(false)
  sendButton()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 4_000 }).toBe(posts)
  await expect
    .poll(() => activeChat().streaming(), { timeout: 4_000 })
    .toBeNull()
  expect(activeChat().id).toBe(chatId)
}

const userContents = async (chatId: string) =>
  (await repo.listMessages(chatId))
    .filter((message) => message.role === 'user')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .map((message) => message.content)

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
  mockChatStream(replyScript)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

const replyScript = {
  chunks: [
    {
      data: {
        id: 'gen-privacy',
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: 'openai/gpt-4o-mini',
        choices: [
          { index: 0, delta: { content: 'Noted.' }, finish_reason: null },
        ],
      },
    },
    {
      data: {
        id: 'gen-privacy',
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: 'openai/gpt-4o-mini',
        choices: [
          { index: 0, delta: { content: '' }, finish_reason: 'stop' },
        ],
      },
    },
  ],
}

afterEach(async () => {
  restorePut?.()
  restorePut = null
  restoreStorePut?.()
  restoreStorePut = null
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Tom sets a system prompt, and a failed write stays unsaved', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: promptChatId,
        title: 'Brief answers',
        model: 'openai/gpt-4o-mini',
      },
    ],
  })
  mockChatStream(replyScript)
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(promptChatId)
  await expect.poll(() => activeChat().id).toBe(promptChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')

  await openChatSettings('prompt')
  expect(promptField()).toBeInstanceOf(HTMLTextAreaElement)
  expect(promptField()!.value).toBe('')
  expect(promptField()!.getAttribute('aria-label')).toBe('System prompt')
  expect(headerChips()?.textContent?.trim() ?? '').toBe('')
  inView(promptField()!)
  await settle()
  await shoot('F-15', 'empty')

  await sendLine(promptChatId, 'First note', 1)
  expect(bodyAt(0)?.messages?.[0]).toEqual({
    role: 'user',
    content: 'First note',
  })
  expect(bodyAt(0)?.messages?.some((message) => message.role === 'system')).toBe(
    false,
  )

  await openChatSettings('prompt')
  await replacePrompt(britishPrompt)
  expect(headerChips()?.textContent).toContain('System prompt')
  expect(headerChips()?.textContent ?? '').not.toContain('Not saved')
  closeDialogs()
  await expect
    .poll(() => document.querySelector('[data-slot="ChatSettings"] dialog')?.hasAttribute('open'))
    .toBe(false)
  inView(headerChips()!.querySelector('button, span')!)
  await settle()
  await shoot('F-15', 'set')

  await sendLine(promptChatId, 'Second note', 2)
  expect(bodyAt(1)?.messages?.[0]).toEqual({
    role: 'system',
    content: britishPrompt,
  })
  expect(bodyAt(1)?.messages).toEqual(
    expect.arrayContaining([
      { role: 'user', content: 'First note' },
      { role: 'user', content: 'Second note' },
    ]),
  )
  expect(await userContents(promptChatId)).toEqual(['First note', 'Second note'])

  await openChatSettings('prompt')
  await replacePrompt(versePrompt)
  await sendLine(promptChatId, 'Third note', 3)
  expect(bodyAt(2)?.messages?.[0]).toEqual({
    role: 'system',
    content: versePrompt,
  })
  expect(await userContents(promptChatId)).toEqual([
    'First note',
    'Second note',
    'Third note',
  ])

  await openChatSettings('prompt')
  await replacePrompt('')
  await sendLine(promptChatId, 'Fourth note', 4)
  expect(bodyAt(3)?.messages?.some((message) => message.role === 'system')).toBe(
    false,
  )
  expect(headerChips()?.textContent?.trim() ?? '').toBe('')

  await openChatSettings('prompt')
  await replacePrompt('   ')
  await sendLine(promptChatId, 'Fifth note', 5)
  expect(bodyAt(4)?.messages?.some((message) => message.role === 'system')).toBe(
    false,
  )

  await openChatSettings('prompt')
  await replacePrompt(britishPrompt)

  const originalPut = repo.putChatFields.bind(repo)
  let abortedPuts = 0
  const abortedSave: { release: (() => Promise<void>) | null } = {
    release: null,
  }
  repo.putChatFields = (id, fields, at, options) => {
    const prompt = fields.settings?.systemPrompt
    if (typeof prompt === 'string' && prompt.startsWith(abortedPrompt)) {
      abortedPuts += 1
      if (prompt === abortedPrompt && !abortedSave.release) {
        return new Promise((resolve, reject) => {
          abortedSave.release = () =>
            originalPut(id, fields, at, options).then(resolve, reject)
        })
      }
      return new Promise(() => {})
    }
    return originalPut(id, fields, at, options)
  }
  restorePut = () => {
    repo.putChatFields = originalPut
  }
  const abortField = promptField()
  expect(abortField).toBeInstanceOf(HTMLTextAreaElement)
  abortField!.focus()
  abortField!.select()
  await keyboard.keyboard(abortedPrompt)
  await expect.poll(() => abortedPuts, { timeout: 3_000 }).toBeGreaterThan(0)
  await keyboard.keyboard('x')
  await expect.poll(() => abortedPuts, { timeout: 3_000 }).toBeGreaterThanOrEqual(2)
  await sendLine(promptChatId, 'Aborted note', 6)
  expect(bodyAt(5)?.messages?.[0]).toEqual({
    role: 'system',
    content: britishPrompt,
  })
  expect(JSON.stringify(bodyAt(5)?.messages)).not.toContain(abortedPrompt)
  await abortedSave.release?.()
  await expect
    .poll(
      async () => {
        const first =
          (await repo.getChat(promptChatId))?.settings.systemPrompt ?? ''
        await new Promise((resolve) => setTimeout(resolve, 100))
        const second =
          (await repo.getChat(promptChatId))?.settings.systemPrompt ?? ''
        return first === second ? first : ''
      },
      { timeout: 3_000 },
    )
    .not.toBe('')
  await reloadApp()
  openChat(promptChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await sendLine(promptChatId, 'Reloaded note', 1)
  expect(bodyAt(0)?.messages?.[0]).toEqual({
    role: 'system',
    content: britishPrompt,
  })
  expect(JSON.stringify(bodyAt(0)?.messages)).not.toContain(abortedPrompt)
  restorePut()
  restorePut = null

  const originalStorePut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey,
  ) {
    const record = value as { settings?: { systemPrompt?: string } }
    if (
      this.name === 'chats' &&
      record?.settings?.systemPrompt?.includes('UNSAVED')
    ) {
      throw new DOMException(
        'The quota has been exceeded.',
        'QuotaExceededError',
      )
    }
    return originalStorePut.call(this, value, key)
  }
  restoreStorePut = () => {
    IDBObjectStore.prototype.put = originalStorePut
  }
  await openChatSettings('prompt')
  const field = promptField()
  expect(field).toBeInstanceOf(HTMLTextAreaElement)
  field!.focus()
  field!.select()
  await keyboard.keyboard(unsavedPrompt)
  await expect
    .poll(() => headerChips()?.textContent ?? '', { timeout: 3_000 })
    .toContain('Not saved')
  expect(headerChips()?.textContent ?? '').not.toContain('System prompt')
  expect(promptField()?.value).toBe(unsavedPrompt)
  expect((await repo.getChat(promptChatId))?.settings.systemPrompt).toBe(
    britishPrompt,
  )
  expect(document.querySelector('[data-slot="PromptSection"]')?.textContent ?? '').not.toMatch(
    /\bSaved\b/,
  )
  expect(headerChips()?.textContent ?? '').not.toMatch(/\bSaved\b/)
  expect(
    [...document.querySelectorAll('[data-toast-key]')]
      .map((node) => node.textContent ?? '')
      .join('\n'),
  ).not.toMatch(/\bSaved\b/)
  await I.see(text(storageFull))
  expect(document.querySelectorAll('[data-toast-key="storage-full"]')).toHaveLength(
    1,
  )

  await sendLine(promptChatId, 'Sixth note', 2)
  expect(bodyAt(1)?.messages?.[0]).toEqual({
    role: 'system',
    content: britishPrompt,
  })
  expect(JSON.stringify(bodyAt(1)?.messages)).not.toContain(unsavedPrompt)

  await reloadApp()
  openChat(promptChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await openChatSettings('prompt')
  await expect.poll(() => promptField()?.value).toBe(britishPrompt)
  expect(headerChips()?.textContent).toContain('System prompt')
  expect(headerChips()?.textContent ?? '').not.toContain('Not saved')
  const exported = JSON.stringify({
    chat: await repo.getChat(promptChatId),
  })
  expect(exported).toContain(britishPrompt)
  expect(exported).not.toContain(unsavedPrompt)

  const originalKeptPut = repo.putChatFields.bind(repo)
  const keptSave: {
    releaseA: (() => Promise<void>) | null
    releaseB: (() => Promise<void>) | null
  } = { releaseA: null, releaseB: null }
  repo.putChatFields = (id, fields, at, options) => {
    const prompt = fields.settings?.systemPrompt
    if (prompt === abortedPrompt && !keptSave.releaseA) {
      return new Promise((resolve, reject) => {
        keptSave.releaseA = () =>
          originalKeptPut(id, fields, at, options).then(resolve, reject)
      })
    }
    if (prompt === keptPrompt && !keptSave.releaseB) {
      return new Promise((resolve, reject) => {
        keptSave.releaseB = () =>
          originalKeptPut(id, fields, at, options).then(resolve, reject)
      })
    }
    return originalKeptPut(id, fields, at, options)
  }
  restorePut = () => {
    repo.putChatFields = originalKeptPut
  }
  const keptField = promptField()
  expect(keptField).toBeInstanceOf(HTMLTextAreaElement)
  keptField!.focus()
  keptField!.select()
  await keyboard.keyboard(abortedPrompt)
  await expect
    .poll(() => keptSave.releaseA, { timeout: 3_000 })
    .toBeTypeOf('function')
  await keyboard.keyboard('x')
  await expect
    .poll(() => keptSave.releaseB, { timeout: 3_000 })
    .toBeTypeOf('function')
  await keptSave.releaseA?.()
  await expect
    .poll(
      async () => (await repo.getChat(promptChatId))?.settings.systemPrompt,
      { timeout: 3_000 },
    )
    .toBe(britishPrompt)
  await keptSave.releaseB?.()
  await expect
    .poll(
      async () => {
        const first =
          (await repo.getChat(promptChatId))?.settings.systemPrompt ?? ''
        await new Promise((resolve) => setTimeout(resolve, 50))
        const second =
          (await repo.getChat(promptChatId))?.settings.systemPrompt ?? ''
        return first === second ? first : ''
      },
      { timeout: 3_000 },
    )
    .not.toBe('')
  await reloadApp()
  openChat(promptChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await sendLine(promptChatId, 'Kept note', 1)
  expect(bodyAt(0)?.messages?.[0]).toEqual({
    role: 'system',
    content: keptPrompt,
  })
  restorePut()
  restorePut = null
}, 60_000)

test('Ana keeps deny by default and loosens privacy per chat', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: privacyChatId,
        title: 'Private notes',
        model: 'openai/gpt-4o-mini',
      },
    ],
  })
  mockChatStream(replyScript)
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(privacyChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')

  await openAppPrivacy()
  const globalRoot = privacyRoot()
  expect(globalRoot).toBeTruthy()
  expect(globalRoot!.textContent).toContain(accountCopy)
  expect(switchNamed(globalRoot!, 'Exclude providers').checked).toBe(true)
  expect(switchNamed(globalRoot!, 'Zero data retention').checked).toBe(false)
  expect(globalRoot!.textContent).not.toContain('Using global privacy')

  await openChatSettings('privacy')
  const chatRoot = privacyRoot()
  expect(chatRoot).toBeTruthy()
  expect(chatRoot!.textContent).toContain('Using global privacy')
  expect(chatRoot!.textContent).not.toContain('Custom for this chat')
  expect(chatRoot!.textContent).toContain(accountCopy)
  expect(switchNamed(chatRoot!, 'Exclude providers').checked).toBe(true)
  expect(switchNamed(chatRoot!, 'Zero data retention').checked).toBe(false)
  expect(chatRoot!.textContent).not.toContain(webSearchWarning)
  inView(switchNamed(chatRoot!, 'Exclude providers'))
  inView(switchNamed(chatRoot!, 'Zero data retention'))
  await settle()
  await shoot('F-19', 'default')

  await sendLine(privacyChatId, 'Hello', 1)
  expect(bodyAt(0)?.provider).toEqual({ data_collection: 'deny' })
  expect(bodyAt(0)?.provider).not.toHaveProperty('zdr')

  await openAppPrivacy()
  switchNamed(privacyRoot()!, 'Exclude providers').click()
  await expect.poll(() => globalPrivacy().denyDataCollection).toBe(false)
  await sendLine(privacyChatId, 'Global loose', 2)
  expect(bodyAt(1)?.provider?.data_collection).toBeUndefined()
  expect(bodyAt(1)?.provider?.zdr).toBeUndefined()
  await openChatSettings('privacy')
  expect(privacyRoot()?.textContent).toContain('Using global privacy')

  await openAppPrivacy()
  switchNamed(privacyRoot()!, 'Exclude providers').click()
  await expect.poll(() => globalPrivacy().denyDataCollection).toBe(true)
  switchNamed(privacyRoot()!, 'Zero data retention').click()
  await expect.poll(() => globalPrivacy().zdr).toBe(true)
  activeChat().updateSettings({ webSearch: true })
  await expect
    .poll(async () => (await repo.getChat(privacyChatId))?.settings.webSearch)
    .toBe(true)
  await openChatSettings('privacy')
  await expect.poll(() => privacyRoot()?.textContent ?? '').toContain(webSearchWarning)
  expect(privacyRoot()?.textContent).toContain('Using global privacy')
  expect(switchNamed(privacyRoot()!, 'Zero data retention').checked).toBe(true)
  expect(switchNamed(privacyRoot()!, 'Exclude providers').checked).toBe(true)
  expect(
    document.querySelector('[data-slot="ChatSettings"] dialog')?.hasAttribute('open'),
  ).toBe(true)
  inView(privacyRoot()!.querySelector('[data-tone="warning"]')!)
  await shoot('F-19', 'zdr')

  await sendLine(privacyChatId, 'With retention', 3)
  expect(bodyAt(2)?.provider).toEqual({ data_collection: 'deny', zdr: true })

  await openChatSettings('privacy')
  switchNamed(privacyRoot()!, 'Exclude providers').click()
  await expect.poll(() => activeChat().settings().privacyOverride).toEqual({
    denyDataCollection: false,
    zdr: true,
  })
  expect(privacyRoot()?.textContent).toContain('Custom for this chat')
  await sendLine(privacyChatId, 'Custom zdr', 4)
  expect(bodyAt(3)?.provider).toEqual({ zdr: true })
  expect(bodyAt(3)?.provider).not.toHaveProperty('data_collection')

  await openChatSettings('privacy')
  switchNamed(privacyRoot()!, 'Zero data retention').click()
  await expect.poll(() => activeChat().settings().privacyOverride).toEqual({
    denyDataCollection: false,
    zdr: false,
  })
  expect(privacyRoot()?.textContent).toContain('Custom for this chat')
  expect(privacyRoot()?.textContent).not.toContain(webSearchWarning)
  expect(switchNamed(privacyRoot()!, 'Exclude providers').checked).toBe(false)
  expect(switchNamed(privacyRoot()!, 'Zero data retention').checked).toBe(false)
  inView(switchNamed(privacyRoot()!, 'Exclude providers'))
  await settle()
  await shoot('F-19', 'loosened')

  await sendLine(privacyChatId, 'Loosened', 5)
  expect(bodyAt(4)?.provider?.data_collection).toBeUndefined()
  expect(bodyAt(4)?.provider?.zdr).toBeUndefined()

  await reloadApp()
  openChat(privacyChatId)
  await expect.poll(() => activeChat().loadState()).toBe('ready')
  await expect.poll(() => globalPrivacy()).toEqual({
    denyDataCollection: true,
    zdr: true,
  })
  await expect.poll(() => activeChat().settings().privacyOverride).toEqual({
    denyDataCollection: false,
    zdr: false,
  })
  await openChatSettings('privacy')
  expect(privacyRoot()?.textContent).toContain('Custom for this chat')
  expect(switchNamed(privacyRoot()!, 'Exclude providers').checked).toBe(false)
  expect(switchNamed(privacyRoot()!, 'Zero data retention').checked).toBe(false)

  const useGlobal = [...privacyRoot()!.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Use global privacy'),
  )
  expect(useGlobal).toBeTruthy()
  useGlobal!.click()
  await expect.poll(() => activeChat().settings().privacyOverride).toBeNull()
  expect(privacyRoot()?.textContent).toContain('Using global privacy')
  expect(switchNamed(privacyRoot()!, 'Exclude providers').checked).toBe(true)
  expect(switchNamed(privacyRoot()!, 'Zero data retention').checked).toBe(true)

  await sendLine(privacyChatId, 'Restored', 1)
  expect(bodyAt(0)?.provider).toEqual({ data_collection: 'deny', zdr: true })
}, 60_000)
