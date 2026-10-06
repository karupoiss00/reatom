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
import { ui } from '../app/ui'
import { readStoredKey } from '../auth/keyStore'
import { forgetKey } from '../auth'
import { sessionMode } from '../auth/session'
import { buildPath } from '../chat/tree'
import { library } from '../chat/library'
import { loadPresets, presets } from '../presets/presets'
import { resetRuntime } from '../platform/runtime'
import { homeRoute, openChat } from '../routes'
import { dbHealth, resetRepoBackend, storageInfo } from '../storage'
import { repo } from '../storage/repo'
import type {
  AssistantMessage,
  AttachmentRef,
  ChatSettings,
  PresetRecord,
} from '../storage/types'
import { toast } from '../ui'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import {
  installOpenRouterMock,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { catalogModels } from './fixtures/models'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const anaKey = 'sk-or-v1-ana-export'
const maxImportBytes = 50 * 1024 * 1024
const localSentence = 'Chats live only in this browser. Export to keep a copy.'
const privateSentence = "This browser won't keep chats after you close the tab."
const invalidCopy = "This file isn't a chat export (missing 'chats')."
const tooLargeCopy = 'This file is too large to import.'
const deniedCopy = "The browser didn't allow permanent storage. Export a copy."
const sidebarEmpty = 'Send a message and it will be kept on this device.'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

type SavedFile = { name: string; text: string }

const downloads: SavedFile[] = []
const originalAnchorClick = HTMLAnchorElement.prototype.click
const originalFileText = File.prototype.text
let originalOpen: typeof indexedDB.open | null = null
let extraUnmount: (() => void) | null = null
let clipboardText = ''
let clipboardRejects = false
let estimateThrows = false
let persisted = false
let persistGrants = false
let storagePatched = false

const originalEstimate = navigator.storage.estimate.bind(navigator.storage)
const originalPersist = navigator.storage.persist?.bind(navigator.storage)
const originalPersisted = navigator.storage.persisted?.bind(navigator.storage)

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const chatRow = (title: string) => role('listitem', title).options({ exact: true })

const openRowMenu = async (title: string) => {
  const menu = role('menu', `Actions for ${title}`)
  const trigger = button('⋯').within(chatRow(title))
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

const rowMenuItem = (title: string, label: string) =>
  role('menuitem', label).options({ exact: true }).within(role('menu', `Actions for ${title}`))

const shoot = async (flowId: 'F-22' | 'F-22b', name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot(flowId, name)
}

const installClipboard = () => {
  clipboardText = ''
  clipboardRejects = false
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        if (clipboardRejects) throw new Error('denied')
        clipboardText = value
      },
    },
  })
}

const installDownloads = () => {
  downloads.length = 0
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    const name = this.download
    const href = this.href
    if (name && href.startsWith('blob:')) {
      const saved: SavedFile = { name, text: '' }
      downloads.push(saved)
      void fetch(href)
        .then((response) => response.text())
        .then((body) => {
          saved.text = body
        })
    }
    return originalAnchorClick.call(this)
  }
}

const installFileDelay = () => {
  File.prototype.text = function text(this: File) {
    const read = originalFileText.call(this)
    if (this.name !== 'slow-import.json') return read
    return read.then(
      (body) =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve(body), 700)
        }),
    )
  }
}

const installStorageProbes = () => {
  storagePatched = true
  estimateThrows = false
  persisted = false
  persistGrants = false
  navigator.storage.estimate = async () => {
    if (estimateThrows) throw new Error('estimate failed')
    return originalEstimate()
  }
  navigator.storage.persist = async () => {
    if (persistGrants) persisted = true
    return persistGrants
  }
  navigator.storage.persisted = async () => persisted
}

const usageLabel = (usage: number) => {
  const megabytes = Math.round((usage / (1024 * 1024)) * 10) / 10
  return `${megabytes.toFixed(1)} MB in this browser`
}

const bodyText = () => document.body.textContent ?? ''

const seeText = (value: string) =>
  expect.poll(() => bodyText(), { timeout: 8_000 }).toContain(value)

const dataSection = () =>
  document.querySelector<HTMLElement>('[data-slot="DataSection"]')

const banner = () =>
  document.querySelector<HTMLElement>('[data-slot="StorageBanner"]')

const fileInput = () =>
  document.querySelector<HTMLInputElement>('input[type="file"]')

const assignFile = (file: File) => {
  const input = fileInput()
  if (!input) throw new Error('import input missing')
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const nextDownload = async (marker: number, pattern: RegExp) => {
  let saved: SavedFile | undefined
  await expect
    .poll(() => {
      saved = downloads
        .slice(marker)
        .reverse()
        .find((file) => pattern.test(file.name) && file.text.length > 0)
      return saved?.text ?? ''
    })
    .not.toBe('')
  return saved!
}

const openData = async () => {
  ui.appSettings.set('data')
  await I.see(role('heading', 'Settings').options({ timeout: 8_000 }).wait())
  await expect.poll(() => dataSection()?.textContent ?? '').toContain('Export all chats (JSON)')
}

const remount = async () => {
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  resetRepoBackend()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(catalogModels)
  mockKey(limitedKey)
  installClipboard()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot()
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

const settings: ChatSettings = {
  systemPrompt: 'Be brief',
  params: { temperature: 0.2 },
  privacyOverride: { denyDataCollection: true, zdr: true },
  routing: { mode: 'only', providers: ['anthropic'], allowFallbacks: false },
  webSearch: true,
}

const attachment: AttachmentRef = {
  id: 'file-1',
  kind: 'pdf',
  name: 'notes.pdf',
  mime: 'application/pdf',
  size: 1200,
}

const preset: PresetRecord = {
  id: 'preset-brief',
  name: 'Brief',
  systemPrompt: 'Be brief',
  model: 'openai/gpt-4o-mini',
  params: { temperature: 0.2 },
  isDefault: true,
  createdAt: 1,
  deletedAt: null,
  deletedByTab: null,
}

const reasoning = {
  text: 'secret thoughts sk-or-v1-leak',
  details: ['sk-or-v1-leak'],
  startedAt: 10,
  endedAt: 20,
  hiddenByProvider: false,
  stoppedWhileThinking: false,
}

afterEach(async () => {
  HTMLAnchorElement.prototype.click = originalAnchorClick
  File.prototype.text = originalFileText
  if (originalOpen) indexedDB.open = originalOpen
  originalOpen = null
  if (storagePatched) {
    navigator.storage.estimate = originalEstimate
    if (originalPersist) navigator.storage.persist = originalPersist
    if (originalPersisted) navigator.storage.persisted = originalPersisted
    storagePatched = false
  }
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  ui.appSettings.set(null)
  await page.viewport(desktop.width, desktop.height)
})

test('Ana exports every version, copies markdown, and imports into an empty profile', async () => {
  installClipboard()
  installDownloads()
  installFileDelay()
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await bootApp({ key: anaKey, keyMeta: limitedKey, viewport: desktop })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  await openData()
  expect(dataSection()?.textContent).toContain(localSentence)
  await settle()
  await shoot('F-22', 'idle')

  const emptyMarker = downloads.length
  await I.click(button('Export all chats (JSON)'))
  const emptyFile = await nextDownload(emptyMarker, /^chats-\d{4}-\d{2}-\d{2}\.json$/)
  expect(emptyFile.text).not.toContain('sk-or-')
  expect(JSON.parse(emptyFile.text).chats).toEqual([])
  await seeText('Exported 0 chats.')

  await seedChats([
    {
      id: 'ana-chat',
      title: 'Morning notes',
      model: 'openai/gpt-4o-mini',
      settings,
      messages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Hello from Ana',
          attachments: [attachment],
        },
        { id: 'a1', role: 'assistant', content: 'First reply', parentId: 'u1' },
        {
          id: 'a2',
          role: 'assistant',
          content: 'Visible answer',
          parentId: 'u1',
        },
      ],
    },
    {
      id: 'ana-2',
      title: 'Grocery list',
      messages: [
        { id: 'g1', role: 'user', content: 'Milk' },
        { id: 'g2', role: 'assistant', content: 'Added milk', parentId: 'g1' },
      ],
    },
  ])
  const visible = await repo.getChat('ana-chat')
  const storedReply = (await repo.listMessages('ana-chat')).find(
    (message) => message.id === 'a2',
  ) as AssistantMessage
  await repo.putMessage({
    ...storedReply,
    rev: storedReply.rev + 1,
    reasoning,
    usage: {
      promptTokens: 12,
      completionTokens: 8,
      reasoningTokens: 4,
      cost: 0.0123,
      isByok: false,
      source: 'usage',
    },
  })
  await repo.putAttachment({
    id: attachment.id,
    dataUrl: 'data:application/pdf;base64,QQ==',
  })
  await repo.putPreset(preset)
  await repo.putChatFields(
    'ana-chat',
    { presetId: preset.id, selection: { u1: 'a2' } },
    Date.now(),
  )
  await library.reload()
  await loadPresets()
  ui.appSettings.set(null)
  openChat('ana-chat')
  await seeText('Morning notes')

  ui.appSettings.set('data')
  const fullMarker = downloads.length
  await I.click(button('Export all chats (JSON)'))
  const fullExport = await nextDownload(fullMarker, /^chats-\d{4}-\d{2}-\d{2}\.json$/)
  expect(fullExport.text).toContain('Morning notes')
  ui.appSettings.set(null)

  const jsonMarker = downloads.length
  await openRowMenu('Morning notes')
  await I.click(rowMenuItem('Morning notes', 'Export'))
  const oneChat = await nextDownload(jsonMarker, /\.json$/)
  expect(oneChat.text).not.toContain('sk-or-')
  const oneBundle = JSON.parse(oneChat.text)
  expect(oneBundle.chats).toHaveLength(1)
  expect(oneBundle.chats[0].messages.map((message: { content: string }) => message.content)).toEqual(
    expect.arrayContaining(['Hello from Ana', 'First reply', 'Visible answer']),
  )

  const markdownMarker = downloads.length
  await openRowMenu('Morning notes')
  await I.click(rowMenuItem('Morning notes', 'Export Markdown'))
  const markdownFile = await nextDownload(markdownMarker, /\.md$/)
  expect(markdownFile.text).toContain('Hello from Ana')
  expect(markdownFile.text).toContain('Visible answer')
  expect(markdownFile.text).toContain('OpenAI: GPT-4o-mini')
  expect(markdownFile.text).toContain('notes.pdf')
  expect(markdownFile.text).not.toContain('First reply')
  expect(markdownFile.text).not.toContain('secret thoughts')
  expect(markdownFile.text).not.toContain('sk-or-')

  toast.dismiss('export-chats')
  await openRowMenu('Morning notes')
  await I.click(rowMenuItem('Morning notes', 'Copy as Markdown'))
  await expect.poll(() => clipboardText).toBe(markdownFile.text)
  await seeText('Copied')
  await settle()
  await shoot('F-22', 'copied')

  clipboardRejects = true
  await openRowMenu('Morning notes')
  await I.click(rowMenuItem('Morning notes', 'Copy as Markdown'))
  await seeText("Couldn't copy. Select the text instead.")
  clipboardRejects = false

  forgetKey()
  await expect.poll(() => sessionMode()).toBe('archive')
  await openRowMenu('Morning notes')
  await I.click(rowMenuItem('Morning notes', 'Copy as Markdown'))
  await expect.poll(() => clipboardText).toBe(markdownFile.text)

  await openData()
  assignFile(new File(['{"format":"nope"}'], 'broken.json', { type: 'application/json' }))
  await seeText(invalidCopy)
  expect(library.chats().map((chat) => chat.id).sort()).toEqual(['ana-2', 'ana-chat'])
  const bulkImport = repo.bulkImport.bind(repo)
  repo.bulkImport = () => Promise.reject(new Error('disk'))
  assignFile(new File([fullExport.text], 'throw.json', { type: 'application/json' }))
  await expect
    .poll(() =>
      dataSection()
        ?.querySelector('[data-import-state]')
        ?.getAttribute('data-import-state'),
    )
    .toBe('error')
  expect(dataSection()?.textContent).toContain(invalidCopy)
  await I.see(button('Import JSON'))
  expect(library.chats().map((chat) => chat.id).sort()).toEqual(['ana-2', 'ana-chat'])
  repo.bulkImport = bulkImport
  toast.dismiss('export-chats')
  toast.dismiss('copy-markdown')
  await settle()
  await shoot('F-22', 'import-error')

  const beforeLarge = library.chats().length
  const huge = new File(['{}'], 'huge.json', { type: 'application/json' })
  Object.defineProperty(huge, 'size', { value: maxImportBytes + 1 })
  expect(huge.size).toBeGreaterThan(maxImportBytes)
  assignFile(huge)
  await seeText(tooLargeCopy)
  expect(library.chats()).toHaveLength(beforeLarge)

  const beforeCancel = library.chats().map((chat) => chat.id)
  fileInput()?.dispatchEvent(new Event('change', { bubbles: true }))
  await settle()
  expect(library.chats().map((chat) => chat.id)).toEqual(beforeCancel)

  await repo.deleteAllChatsAndPresets()
  await library.reload()
  await loadPresets()
  expect(library.chats()).toHaveLength(0)
  homeRoute.go()

  const bundleText = fullExport.text
  expect(bundleText).not.toContain('sk-or-')
  expect(bundleText).not.toContain(anaKey)
  const bundle = JSON.parse(bundleText)
  expect(bundle.format).toBe('atelier-chats')
  expect(bundle.version).toBe(1)
  expect(bundle.chats).toHaveLength(2)
  const morning = bundle.chats.find((entry: { chat: { title: string } }) => entry.chat.title === 'Morning notes')
  expect(morning.chat.model).toBe('openai/gpt-4o-mini')
  expect(morning.chat.settings.systemPrompt).toBe('Be brief')
  expect(morning.chat.settings.routing).toEqual(settings.routing)
  expect(morning.chat.settings.privacyOverride).toEqual(settings.privacyOverride)
  expect(morning.messages).toHaveLength(3)
  expect(morning.attachments[0].dataUrl).toBe('data:application/pdf;base64,QQ==')
  expect(morning.messages.find((message: { id: string }) => message.id === 'a2').usage.cost).toBe(0.0123)
  expect(bundle.presets.map((item: { name: string }) => item.name)).toContain('Brief')

  assignFile(new File([bundleText], 'slow-import.json', { type: 'application/json' }))
  await seeText('Importing…')
  toast.dismiss('export-chats')
  toast.dismiss('copy-markdown')
  await settle()
  await shoot('F-22', 'importing')
  await seeText('Imported 2 chats')
  toast.dismiss('import-chats')
  await settle()
  await shoot('F-22', 'import-success')

  const imported = library.chats()
  expect(imported).toHaveLength(2)
  expect(imported.map((chat) => chat.title).sort()).toEqual([
    'Grocery list (imported)',
    'Morning notes (imported)',
  ])
  expect(imported.map((chat) => chat.id)).not.toEqual(expect.arrayContaining(['ana-chat', 'ana-2']))
  const importedMorning = imported.find((chat) => chat.title === 'Morning notes (imported)')!
  const importedMessages = await repo.listMessages(importedMorning.id)
  expect(importedMessages.map((message) => message.content).sort()).toEqual([
    'First reply',
    'Hello from Ana',
    'Visible answer',
  ])
  expect(JSON.stringify(importedMessages)).not.toContain('sk-or-')
  const path = buildPath(importedMessages, importedMorning.selection)
  expect(path.map((node) => node.message.content)).toEqual(['Hello from Ana', 'Visible answer'])
  expect(importedMorning.settings).toMatchObject({
    systemPrompt: 'Be brief',
    routing: settings.routing,
    privacyOverride: settings.privacyOverride,
  })
  expect(importedMorning.model).toBe('openai/gpt-4o-mini')
  expect(importedMorning.createdAt).toBe(visible?.createdAt)
  const importedPreset = presets().find((item) => item.name === 'Brief')
  expect(importedPreset?.id).not.toBe(preset.id)
  expect(importedMorning.presetId).toBe(importedPreset?.id)
  const blobs = await Promise.all(
    importedMessages
      .flatMap((message) => (message.role === 'user' ? message.attachments : []))
      .map((ref) => repo.getAttachment(ref.id)),
  )
  expect(blobs.map((blob) => blob?.dataUrl)).toContain('data:application/pdf;base64,QQ==')

  const suffixed = JSON.parse(bundleText) as {
    chats: Array<{ chat: { title: string } }>
  }
  for (const entry of suffixed.chats) {
    entry.chat.title = `${entry.chat.title} (imported)`
  }
  const stackedMorning = suffixed.chats.find((entry) =>
    entry.chat.title.startsWith('Morning notes'),
  )
  stackedMorning!.chat.title = 'Morning notes (imported) (imported)'
  assignFile(new File([JSON.stringify(suffixed)], 'again.json', { type: 'application/json' }))
  await expect.poll(() => library.chats()).toHaveLength(4)
  expect(library.chats().map((chat) => chat.title).sort()).toEqual([
    'Grocery list (imported)',
    'Grocery list (imported)',
    'Morning notes (imported)',
    'Morning notes (imported)',
  ])
  expect(new Set(library.chats().map((chat) => chat.id)).size).toBe(4)

  await seedChats([
    {
      id: 'secret-title',
      title: 'Notes sk-or-v1-abc',
      messages: [{ id: 's1', role: 'user', content: 'keep sk-or-v1-abc out' }],
    },
  ])
  await library.reload()
  ui.appSettings.set(null)
  openChat('secret-title')
  const secretJsonMarker = downloads.length
  await openRowMenu('Notes sk-or-v1-abc')
  await I.click(rowMenuItem('Notes sk-or-v1-abc', 'Export'))
  const secretJson = await nextDownload(secretJsonMarker, /\.json$/)
  expect(secretJson.name).not.toContain('sk-or-')
  expect(secretJson.text).not.toContain('sk-or-')
  const secretMdMarker = downloads.length
  await openRowMenu('Notes sk-or-v1-abc')
  await I.click(rowMenuItem('Notes sk-or-v1-abc', 'Export Markdown'))
  const secretMd = await nextDownload(secretMdMarker, /\.md$/)
  expect(secretMd.name).not.toContain('sk-or-')
  expect(secretMd.text).not.toContain('sk-or-')
}, 60_000)

test('Ana checks storage health, confirms delete, and survives a blocked database', async () => {
  installClipboard()
  installStorageProbes()
  estimateThrows = true
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await bootApp({
    key: anaKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: 'kept',
        title: 'Keep me',
        messages: [{ role: 'user', content: 'Stay' }],
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await openData()
  await I.see(text('Storage size unavailable').wait())
  expect(dataSection()?.textContent).toContain('Make storage persistent')
  expect(dataSection()?.textContent).toContain(localSentence)
  await I.seeDisabled(button('Delete all chats'))

  estimateThrows = false
  storageInfo.retry()
  const estimate = await originalEstimate()
  await I.see(text(usageLabel(estimate.usage ?? 0)).wait())
  expect(dataSection()?.textContent).not.toContain('Persistent')
  await settle()
  await shoot('F-22b', 'healthy')

  persistGrants = false
  await I.click(button('Make storage persistent'))
  await I.see(text(deniedCopy).wait())
  await I.see(button('Make storage persistent'))
  await settle()
  await shoot('F-22b', 'persist-denied')

  persistGrants = true
  await I.click(button('Make storage persistent'))
  await I.see(text('Persistent').wait())
  expect(dataSection()?.textContent).not.toContain(deniedCopy)
  expect(dataSection()?.textContent).not.toContain('Make storage persistent')
  await settle()
  await shoot('F-22b', 'persist-granted')

  persisted = false
  persistGrants = false
  storageInfo.retry()
  await I.see(button('Make storage persistent').wait())

  const confirm = role('textbox', 'Type DELETE to confirm')
  await I.fill(confirm, 'delete')
  await I.seeDisabled(button('Delete all chats'))
  await I.fill(confirm, 'DELETE')
  await I.dontSeeDisabled(button('Delete all chats'))
  document
    .querySelector('[data-slot="DataSection"] [data-danger-zone]')
    ?.scrollIntoView({ block: 'center' })
  await settle()
  await shoot('F-22b', 'confirm-delete-all')
  await I.click(button('Delete all chats'))
  await expect.poll(() => library.chats()).toHaveLength(0)
  expect(presets()).toHaveLength(0)
  expect(readStoredKey()?.key).toBe(anaKey)
  ui.appSettings.set(null)
  await I.see(text(sidebarEmpty).wait())
  await settle()
  await shoot('F-22b', 'deleted')

  await remount()
  await I.see(text(sidebarEmpty).wait())
  expect(readStoredKey()?.key).toBe(anaKey)
  expect(library.chats()).toHaveLength(0)

  forgetKey()
  await remount()
  await expect.poll(() => document.querySelector('[data-slot="Welcome"]')).toBeTruthy()

  await bootApp({
    key: anaKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: 'earlier',
        title: 'Earlier thread',
        messages: [{ role: 'user', content: 'Before private mode' }],
      },
    ],
  })
  installStorageProbes()
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await I.see(text('Earlier thread').wait())
  originalOpen = indexedDB.open.bind(indexedDB)
  indexedDB.open = (() => {
    throw new DOMException(
      'The user denied permission to access the database.',
      'SecurityError',
    )
  }) as typeof indexedDB.open
  await remount()
  expect(dbHealth()).toEqual({ status: 'memory', reason: 'open-failed' })
  await seeText(privateSentence)
  expect(banner()?.textContent).toContain(localSentence)
  expect(bodyText()).not.toContain('Earlier thread')
  expect(bodyText()).not.toContain('No chats yet')
  expect(bodyText()).toContain("Couldn't open saved chats.")
  await openData()
  expect(dataSection()?.textContent).toContain(privateSentence)
  expect(dataSection()?.textContent).not.toContain(localSentence)
  ui.appSettings.set(null)
  await settle()
  await shoot('F-22b', 'private-mode')

  await remount()
  expect(dbHealth()).toEqual({ status: 'memory', reason: 'open-failed' })
  await seeText(privateSentence)
  expect(bodyText()).not.toContain('Earlier thread')
  expect(bodyText()).not.toContain('Before private mode')
  expect(bodyText()).not.toContain('No chats yet')
  expect(bodyText()).toContain("Couldn't open saved chats.")
  indexedDB.open = originalOpen!
  await I.click(button('Retry').within(role('complementary', 'Chats')))
  await I.see(text('Earlier thread').within(role('complementary', 'Chats')).wait())
  expect(bodyText()).not.toContain("Couldn't open saved chats.")
  expect(dbHealth()).toEqual({ status: 'ok' })
}, 60_000)
