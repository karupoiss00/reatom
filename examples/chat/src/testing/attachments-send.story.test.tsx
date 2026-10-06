import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, role, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { sessionMode } from '../auth/session'
import { catalogById } from '../catalog'
import { activeChat } from '../chat'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import { catalogModels } from './fixtures/models'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockGeneration,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-attachment-send'
const chatId = 'maya'
const modelId = 'openai/gpt-4o-mini'
const modelLabel = 'OpenAI: GPT-4o-mini'
const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const parserLabels = [
  'Text extraction (free)',
  'OCR ($2 / 1,000 pages)',
  'Native (billed as tokens)',
] as const

const megabyte = 1024 * 1024
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

let extraUnmount: (() => void) | null = null
let releaseRead: (() => void) | null = null
const downloads: Array<{ name: string; text: string }> = []
const originalAnchorClick = HTMLAnchorElement.prototype.click
const originalRead = FileReader.prototype.readAsDataURL

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const alignThread = () => {
  const scroller = [...document.querySelectorAll('div')].find((el) => {
    const overflow = getComputedStyle(el).overflowY
    return (overflow === 'auto' || overflow === 'scroll') && el.querySelector(':scope > ol')
  })
  if (!scroller) return
  const top = scroller.getBoundingClientRect().top
  const items = [...scroller.querySelectorAll(':scope > ol > li')]
  const first = items.find((item) => item.getBoundingClientRect().bottom > top + 4)
  if (!first) return
  const box = first.getBoundingClientRect()
  const overlap = top + 16 - box.top
  if (overlap > 0 && overlap < 120) scroller.scrollTop -= overlap
}

const shoot = async (flowId: 'F-20b' | 'F-20c', name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  alignThread()
  await settle()
  await shot(flowId, name)
}

const inView = (element: Element) => {
  const box = element.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(box.top).toBeGreaterThanOrEqual(-1)
  expect(box.left).toBeGreaterThanOrEqual(-1)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1)
}

const frame = async (element: Element) => {
  element.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  inView(element)
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const fileInput = () =>
  document.querySelector<HTMLInputElement>('[data-attachment-input]')

const chipNames = () =>
  [...document.querySelectorAll('[data-attachment-chip]')].map(
    (chip) => chip.querySelector('[data-attachment-name]')?.textContent ?? '',
  )

const dispatchTransfer = (
  type: string,
  target: EventTarget,
  data: DataTransfer,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', {
    value: data,
  })
  target.dispatchEvent(event)
}

const withFile = (file: File) => {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  return transfer
}

const fileOf = (name: string, type: string, bytes: BlobPart = new Uint8Array([1, 2, 3, 4])) =>
  new File([bytes], name, { type })

const paintedPng = async (name: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.fillStyle = '#b5532c'
  ctx.fillRect(0, 0, 64, 64)
  ctx.fillStyle = '#f6f5f2'
  ctx.fillRect(16, 16, 32, 32)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('png'))), 'image/png')
  })
  return new File([blob], name, { type: 'image/png' })
}

const holdNextRead = () => {
  releaseRead?.()
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let held = true
  FileReader.prototype.readAsDataURL = function readAsDataURL(this: FileReader, blob: Blob) {
    const reader = this
    const start = () => originalRead.call(reader, blob)
    if (!held) {
      start()
      return
    }
    held = false
    void gate.then(start)
  }
  releaseRead = () => {
    FileReader.prototype.readAsDataURL = originalRead
    release()
    releaseRead = null
  }
}

const installDownloads = () => {
  downloads.length = 0
  HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
    const name = this.download
    const href = this.href
    if (name && href.startsWith('blob:')) {
      const saved = { name, text: '' }
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

const replyScript = (id: string, content: string) => ({
  chunks: [
    {
      data: {
        id,
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: modelId,
        choices: [{ index: 0, delta: { content }, finish_reason: null }],
      },
    },
    {
      data: {
        id,
        object: 'chat.completion.chunk',
        created: 1710000000,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    },
  ],
})

const armSuccess = (content = 'Noted.') => {
  mockGeneration({ ...generationRecord, id: 'gen-attach-send', model: modelId })
  mockChatStream(replyScript('gen-attach-send', content))
}

const typeDraft = async (value: string) => {
  const composer = field()
  if (!composer) throw new Error('missing composer')
  composer.focus()
  await keyboard.keyboard(value)
  await expect.poll(() => field()?.value ?? '').toContain(value)
}

const dismissNotices = () => {
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    '[data-attachment-notice] button',
  )) {
    control.click()
  }
}

const sendDraft = async () => {
  await expect
    .poll(() => sendButton()?.dataset.mode, { timeout: 12_000 })
    .toBe('send')
  const before = chatBodies().length
  sendButton()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 12_000 }).toBe(before + 1)
  return chatBodies().at(-1)
}

const waitForThumb = async () => {
  await expect
    .poll(
      () =>
        document.querySelector<HTMLImageElement>(
          '[data-slot="AttachmentList"] [data-attachment-thumb]',
        ),
      { timeout: 8_000 },
    )
    .toBeTruthy()
  const thumb = document.querySelector<HTMLImageElement>(
    '[data-slot="AttachmentList"] [data-attachment-thumb]',
  )
  if (!thumb) throw new Error('missing thumbnail')
  return thumb
}

const contentParts = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('messages' in body)) return []
  const messages = (body as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return []
  const parts: unknown[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object' || !('content' in message)) continue
    const content = (message as { content?: unknown }).content
    if (Array.isArray(content)) parts.push(...content)
  }
  return parts
}

const parserEngine = (body: unknown) => {
  if (!body || typeof body !== 'object' || !('plugins' in body)) return undefined
  const plugins = (body as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return undefined
  const parser = plugins.find(
    (plugin) =>
      !!plugin &&
      typeof plugin === 'object' &&
      (plugin as { id?: unknown }).id === 'file-parser',
  ) as { pdf?: { engine?: unknown } } | undefined
  const engine = parser?.pdf?.engine
  return typeof engine === 'string' ? engine : undefined
}

const reloadChat = async () => {
  await settle()
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(catalogModels)
  mockKey(limitedKey)
  armSuccess()
  history.replaceState(null, '', `/c/${chatId}`)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  history.replaceState(null, '', `/c/${chatId}`)
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => activeChat().id).toBe(chatId)
}

const chatTitle = 'Studio references'

const openRowMenu = async () => {
  const menu = role('menu', `Actions for ${chatTitle}`)
  const trigger = button('⋯').within(role('listitem', chatTitle).options({ exact: true }))
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

const exportJson = async () => {
  const marker = downloads.length
  await openRowMenu()
  await I.click(
    role('menuitem', 'Export').options({ exact: true }).within(role('menu', `Actions for ${chatTitle}`)),
  )
  await expect.poll(() => downloads.length, { timeout: 8_000 }).toBeGreaterThan(marker)
  await expect
    .poll(() => downloads.at(-1)?.text.length ?? 0, { timeout: 8_000 })
    .toBeGreaterThan(20)
  return downloads.at(-1)?.text ?? ''
}

const openParser = async () => {
  await I.click(button('PDF parser'))
  await expect
    .poll(() =>
      document
        .querySelector('[role="menu"][aria-label="PDF parser"]')
        ?.matches(':popover-open'),
    )
    .toBe(true)
}

const menuLabels = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[role="menu"][aria-label="PDF parser"] [data-menu-label]',
    ),
  ].map((item) => item.dataset.menuLabel ?? '')

const pickFiles = (files: File[]) => {
  const input = fileInput()
  if (!input) throw new Error('missing file input')
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const waitForChip = async (name: string) => {
  await expect.poll(() => chipNames(), { timeout: 15_000 }).toContain(name)
  const chip = [...document.querySelectorAll('[data-attachment-chip]')].find((item) =>
    item.textContent?.includes(name),
  )
  if (!chip) throw new Error(`missing chip ${name}`)
  return chip
}

const isContextReset = (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  'message' in error &&
  String((error as { message?: unknown }).message).includes('context reset')

const swallowContextResetRejection = (event: PromiseRejectionEvent) => {
  if (!isContextReset(event.reason)) return
  event.preventDefault()
}

const swallowContextResetError = (event: ErrorEvent) => {
  if (!isContextReset(event.error)) return
  event.preventDefault()
}

const watchContextReset = () => {
  window.addEventListener('unhandledrejection', swallowContextResetRejection)
  window.addEventListener('error', swallowContextResetError)
}

const ignoreContextReset = () => {
  window.removeEventListener('unhandledrejection', swallowContextResetRejection)
  window.removeEventListener('error', swallowContextResetError)
}

afterEach(() => {
  releaseRead?.()
  FileReader.prototype.readAsDataURL = originalRead
  HTMLAnchorElement.prototype.click = originalAnchorClick
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  ignoreContextReset()
})

test('Maya attaches images and Ana attaches PDFs', async () => {
  watchContextReset()
  resetLocation()
  installDownloads()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [{ id: chatId, title: chatTitle, model: modelId }],
  })
  armSuccess()
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(chatId)
  await expect.poll(() => activeChat().id).toBe(chatId)
  await expect.poll(() => catalogById().get(modelId)?.name).toBe(modelLabel)
  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)
  expect(fileInput()?.getAttribute('aria-label')).toBe('Attach files')

  const studio = await paintedPng('studio.png')
  holdNextRead()
  dispatchTransfer('dragenter', document, withFile(studio))
  await expect
    .poll(() => document.querySelector('[data-drop-overlay]')?.textContent ?? '')
    .toContain('Drop to attach')
  const overlay = document.querySelector('[data-drop-overlay]')
  await frame(overlay!)
  await shoot('F-20b', 'drag-overlay')

  dispatchTransfer('drop', document, withFile(studio))
  await expect.poll(() => document.body.textContent ?? '').toContain('Encoding studio.png')
  const encoding = [...document.querySelectorAll('[data-encoding]')].find((item) =>
    item.textContent?.includes('studio.png'),
  )
  expect(encoding).toBeTruthy()
  await frame(encoding!)
  await shoot('F-20b', 'encoding')
  releaseRead?.()

  const imageChip = await waitForChip('studio.png')
  const thumb = imageChip.querySelector('img')
  expect(thumb?.getAttribute('src') ?? thumb?.src ?? '').toMatch(/^data:image\//)
  expect(imageChip.querySelector('[data-attachment-name]')?.textContent).toBe('studio.png')
  expect(imageChip.querySelector('[data-attachment-size]')?.textContent ?? '').toMatch(/\d/)
  expect(imageChip.querySelector('button[aria-label="Remove studio.png"]')).toBeTruthy()
  await frame(imageChip)
  await shoot('F-20b', 'chips')

  pickFiles([
    fileOf('frame.jpg', 'image/jpeg'),
    fileOf('mark.webp', 'image/webp'),
    fileOf('loop.gif', 'image/gif'),
  ])
  await waitForChip('frame.jpg')
  await waitForChip('mark.webp')
  await waitForChip('loop.gif')
  expect(document.body.textContent ?? '').not.toContain('only PNG, JPEG, WebP, GIF, or PDF')

  const heic = fileOf('photo.heic', 'image/heic')
  pickFiles([heic])
  await I.see(text('photo.heic: only PNG, JPEG, WebP, GIF, or PDF').wait())
  const unsupported = [...document.querySelectorAll('[data-attachment-notice]')].find((item) =>
    item.textContent?.includes('photo.heic'),
  )
  expect(unsupported).toBeTruthy()
  expect(chipNames()).not.toContain('photo.heic')
  expect(activeChat().draft.attachments().some((ref) => ref.name === 'photo.heic')).toBe(false)
  await frame(unsupported!)
  await shoot('F-20b', 'unsupported')

  const plate = fileOf('plate.png', 'image/png', new Uint8Array(25 * megabyte))
  pickFiles([plate])
  await I.see(text('plate.png is 25 MB (limit 10 MB)').wait())
  const tooLarge = [...document.querySelectorAll('[data-attachment-notice]')].find((item) =>
    item.textContent?.includes('plate.png'),
  )
  expect(tooLarge).toBeTruthy()
  expect(chipNames()).not.toContain('plate.png')
  await frame(tooLarge!)
  await shoot('F-20b', 'too-large')
  dismissNotices()

  const heavy = new Uint8Array(7 * megabyte)
  pickFiles([
    fileOf('batch-a.png', 'image/png', heavy),
    fileOf('batch-b.png', 'image/png', heavy),
  ])
  await waitForChip('batch-a.png')
  await waitForChip('batch-b.png')
  const beforePaste = chipNames()
  dispatchTransfer(
    'paste',
    field()!,
    withFile(fileOf('batch-c.png', 'image/png', heavy)),
  )
  await I.see(text('Attachments too large').wait())
  expect(chipNames()).toEqual(beforePaste)
  expect(activeChat().draft.attachments().some((ref) => ref.name === 'batch-c.png')).toBe(false)
  dismissNotices()

  for (const name of ['batch-a.png', 'batch-b.png']) {
    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`)
      ?.click()
  }
  await expect.poll(() => chipNames()).not.toContain('batch-a.png')

  const beforeCancel = chipNames()
  const input = fileInput()
  expect(input).toBeTruthy()
  input!.value = ''
  input!.dispatchEvent(new Event('change', { bubbles: true }))
  expect(chipNames()).toEqual(beforeCancel)

  await typeDraft('Look at this')
  const imageBody = await sendDraft()
  const imageParts = contentParts(imageBody).filter(
    (part) =>
      !!part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'image_url',
  )
  expect(imageParts.length).toBeGreaterThanOrEqual(4)
  for (const part of imageParts) {
    const url = (part as { image_url?: { url?: unknown } }).image_url?.url
    expect(url).toEqual(expect.stringMatching(/^data:image\//))
  }
  expect(JSON.stringify(imageBody)).not.toContain('photo.heic')
  expect(JSON.stringify(imageBody)).not.toContain('plate.png')
  expect(JSON.stringify(imageBody)).not.toContain('batch-c.png')

  await I.see(text('Noted.').options({ timeout: 8_000 }).wait())
  const sentThumb = await waitForThumb()
  await frame(sentThumb)
  await shoot('F-20b', 'sent')

  const thumbWidth = sentThumb.getBoundingClientRect().width
  const thumbSrc = sentThumb.src
  sentThumb.closest('button')?.click()
  await expect
    .poll(
      () =>
        document
          .querySelector<HTMLImageElement>('dialog[open] [data-attachment-zoom]')
          ?.getBoundingClientRect().width ?? 0,
    )
    .toBeGreaterThan(thumbWidth)
  const zoom = document.querySelector<HTMLImageElement>(
    'dialog[open] [data-attachment-zoom]',
  )
  expect(zoom?.src).toBe(thumbSrc)
  expect(zoom?.src).toMatch(/^data:image\//)
  await frame(zoom!)
  await shoot('F-20b', 'enlarged')
  document.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close"]')?.click()

  await reloadChat()
  const reloaded = await waitForThumb()
  expect(reloaded.alt).toBe('studio.png')
  expect(reloaded.src).toMatch(/^data:image\//)
  const imageExport = await exportJson()
  expect(imageExport).toContain('studio.png')
  expect(imageExport).toContain('data:image/')

  await I.click(button('Edit'))
  await I.see(text('studio.png').wait())
  const editor = document.querySelector<HTMLTextAreaElement>(
    '[data-slot="UserMessageEditor"] textarea',
  )
  expect(editor).toBeTruthy()
  editor!.focus()
  await keyboard.keyboard(' please')
  await I.click(button('Save & send'))
  await I.see(text('Look at this please').wait())
  await expect
    .poll(() => sendButton()?.dataset.mode, { timeout: 12_000 })
    .toBe('send')
  await expect
    .poll(() =>
      [...activeChat().messages().values()].some(
        (message) =>
          message.role === 'user' &&
          message.content.includes('please') &&
          message.attachments.some((ref) => ref.name === 'studio.png'),
      ),
    )
    .toBe(true)
  await I.see(text('Noted.').options({ timeout: 8_000 }).wait())

  await I.click(button('Edit'))
  document.querySelector<HTMLButtonElement>('button[aria-label="Remove studio.png"]')?.click()
  await expect
    .poll(() => document.querySelector('[data-slot="UserMessageEditor"]')?.textContent ?? '')
    .not.toContain('studio.png')
  await I.click(button('Save & send'))
  await expect
    .poll(() => sendButton()?.dataset.mode, { timeout: 12_000 })
    .toBe('send')
  await expect
    .poll(() => {
      const visible = activeChat()
        .path()
        .filter((node) => node.message.role === 'user')
        .at(-1)?.message
      return visible?.role === 'user'
        ? visible.attachments.some((ref) => ref.name === 'studio.png')
        : true
    })
    .toBe(false)

  const spec = fileOf('spec.pdf', 'application/pdf', new Uint8Array(25 * megabyte))
  pickFiles([spec])
  await I.see(text('spec.pdf is 25 MB (limit 10 MB)').wait())
  expect(activeChat().draft.attachments().some((ref) => ref.name === 'spec.pdf')).toBe(false)
  dismissNotices()

  pickFiles([
    fileOf('pile-a.pdf', 'application/pdf', heavy),
    fileOf('pile-b.pdf', 'application/pdf', heavy),
  ])
  await waitForChip('pile-a.pdf')
  await waitForChip('pile-b.pdf')
  const pdfNames = chipNames()
  dispatchTransfer('paste', field()!, withFile(fileOf('pile-c.pdf', 'application/pdf', heavy)))
  await I.see(text('Attachments too large').wait())
  expect(chipNames()).toEqual(pdfNames)
  dismissNotices()
  for (const name of ['pile-a.pdf', 'pile-b.pdf']) {
    document.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name}"]`)?.click()
  }
  await expect.poll(() => chipNames()).not.toContain('pile-a.pdf')

  pickFiles([fileOf('notes.pdf', 'application/pdf', new Uint8Array([37, 80, 68, 70]))])
  await waitForChip('notes.pdf')
  await openParser()
  expect(menuLabels()).toEqual([...parserLabels])
  const checked = document.querySelector(
    '[role="menu"][aria-label="PDF parser"] [aria-checked="true"]',
  )
  expect(checked?.textContent).toContain('Text extraction (free)')
  const menu = document.querySelector('[role="menu"][aria-label="PDF parser"]')
  expect(menu).toBeTruthy()
  await frame(menu!)
  await shoot('F-20c', 'parser-menu')
  document.querySelector<HTMLButtonElement>('[data-menu-label="Text extraction (free)"]')?.click()

  await typeDraft('Read the notes')
  const textBody = await sendDraft()
  const textFile = contentParts(textBody).find(
    (part) => !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'file',
  ) as { file?: { filename?: unknown; file_data?: unknown } } | undefined
  expect(textFile?.file?.filename).toBe('notes.pdf')
  expect(textFile?.file?.file_data).toEqual(
    expect.stringMatching(/^data:application\/pdf;base64,/),
  )
  const textEngine = parserEngine(textBody)
  expect(textEngine).toEqual(expect.any(String))
  await I.see(text('notes.pdf').wait())
  const sentPdf = [...document.querySelectorAll('[data-sent-pdf]')].find((item) =>
    item.textContent?.includes('notes.pdf'),
  )
  expect(sentPdf).toBeTruthy()
  await frame(sentPdf!)
  await shoot('F-20c', 'sent')

  pickFiles([fileOf('ocr.pdf', 'application/pdf', new Uint8Array([37, 80, 68, 70, 45]))])
  await waitForChip('ocr.pdf')
  await openParser()
  document.querySelector<HTMLButtonElement>('[data-menu-label="OCR ($2 / 1,000 pages)"]')?.click()
  await expect.poll(() => document.body.textContent ?? '').toContain('+ PDF parsing')
  expect(document.body.textContent ?? '').toMatch(/\+ PDF parsing \$2/)
  const visibleEstimate = () =>
    [...document.querySelectorAll('[data-estimate-line]')].find((item) => {
      const box = item.getBoundingClientRect()
      return (
        (item.textContent ?? '').includes('+ PDF parsing') && box.width > 0 && box.height > 0
      )
    })
  await expect.poll(() => visibleEstimate() ?? null, { timeout: 4_000 }).toBeTruthy()
  visibleEstimate()?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  await settle()
  const priced = visibleEstimate()
  expect(priced).toBeTruthy()
  inView(priced!)
  await shoot('F-20c', 'ocr-priced')
  const ocrBody = await sendDraft()
  const ocrEngine = parserEngine(ocrBody)
  expect(ocrEngine).toEqual(expect.any(String))

  pickFiles([fileOf('native.pdf', 'application/pdf', new Uint8Array([37, 80, 68, 70, 50]))])
  await waitForChip('native.pdf')
  await openParser()
  document
    .querySelector<HTMLButtonElement>('[data-menu-label="Native (billed as tokens)"]')
    ?.click()
  mockChatStream({
    status: 400,
    body: { error: { message: 'The file could not be read', code: 400 } },
  })
  const nativeBody = await sendDraft()
  const nativeEngine = parserEngine(nativeBody)
  expect(new Set([textEngine, ocrEngine, nativeEngine]).size).toBe(3)
  for (const engine of [textEngine, ocrEngine, nativeEngine]) {
    expect(engine?.length).toBeGreaterThan(0)
  }
  await expect
    .poll(() => document.querySelector('[data-slot="ErrorCard"]')?.textContent ?? '')
    .toContain('native.pdf')

  await reloadChat()
  await I.see(text('notes.pdf').wait())
  const stored = await repo.listMessages(chatId)
  expect(
    stored.some(
      (message) =>
        message.role === 'user' && message.attachments.some((ref) => ref.name === 'notes.pdf'),
    ),
  ).toBe(true)
  const pdfExport = await exportJson()
  expect(pdfExport).toContain('notes.pdf')
  expect(pdfExport).toContain('data:application/pdf')
}, 180_000)
