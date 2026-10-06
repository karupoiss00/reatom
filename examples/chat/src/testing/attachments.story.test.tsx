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

import { catalogById } from '../catalog'
import { activeChat } from '../chat'
import { tabId } from '../platform/env'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import type { AttachmentBlob } from '../storage/types'
import { bootApp, unmountApp } from './boot'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import { chatBodies, mockChatStream, mockGeneration } from './openrouter-mock'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-attachment-guard'
const chatId = 'lena'
const textModel = 'OpenAI: o3-mini'
const visionSuggestions = [
  'Google: Gemini 2.5 Flash',
  'Anthropic: Claude Sonnet 4',
  'Google: Gemini 2.5 Pro',
]

const keyboard = userEvent.setup() as unknown as UserEvent

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-20', name)
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const paperclip = () =>
  document.querySelector<HTMLButtonElement>('[data-attachment-trigger]')

const reasonOf = (trigger: HTMLButtonElement) => {
  const id = trigger.getAttribute('aria-describedby')
  expect(id).toBeTruthy()
  return document.getElementById(id!)
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

const imageFile = () =>
  new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', {
    type: 'image/png',
  })

const pdfFile = () =>
  new File([new Uint8Array([37, 80, 68, 70])], 'notes.pdf', {
    type: 'application/pdf',
  })

const composerForm = () => paperclip()?.closest('form')

const dispatchTransfer = (
  type: 'paste' | 'drop',
  target: EventTarget,
  data: DataTransfer | object,
) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(
    event,
    type === 'paste' ? 'clipboardData' : 'dataTransfer',
    { value: data },
  )
  target.dispatchEvent(event)
}

const pasteFiles = (file: File) => {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  const target = field()
  if (!target) throw new Error('missing composer')
  dispatchTransfer('paste', target, transfer)
}

const dropFiles = (file: File) => {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  const form = composerForm()
  if (!form) throw new Error('missing composer form')
  dispatchTransfer('drop', form, transfer)
}

const pickFile = (file: File) => {
  const input = document.querySelector<HTMLInputElement>(
    '[data-attachment-input]',
  )
  if (!input) throw new Error('missing file input')
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

const openMenuLabels = (name: string) => {
  const menu = document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="${name}"]`,
  )
  expect(menu?.matches(':popover-open')).toBe(true)
  return [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (item) => item.dataset.menuLabel ?? item.textContent?.trim() ?? '',
  )
}

const messageParts = (body: unknown) => {
  const serialized = JSON.stringify(body)
  return serialized
}

const storedPuts: string[] = []
let restorePut: (() => void) | null = null

const watchStoredAttachments = () => {
  storedPuts.length = 0
  const original = repo.putAttachment.bind(repo)
  repo.putAttachment = async (blob: AttachmentBlob) => {
    storedPuts.push(blob.id)
    return original(blob)
  }
  restorePut = () => {
    repo.putAttachment = original
  }
}

afterEach(async () => {
  restorePut?.()
  restorePut = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Lena is stopped from attaching what the model cannot read', async () => {
  resetLocation()
  watchStoredAttachments()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: chatId,
        title: 'Field notes',
        model: 'openai/o3-mini',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi Lena.' },
        ],
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(chatId)
  await expect.poll(() => activeChat().id).toBe(chatId)
  await expect.poll(() => catalogById().get('openai/o3-mini')?.name).toBe(
    textModel,
  )
  await expect.poll(() => field()?.placeholder ?? '').toContain(textModel)

  const trigger = paperclip()
  expect(trigger, 'paperclip').toBeTruthy()
  expect(trigger!.getAttribute('aria-disabled')).toBe('true')
  const reason = reasonOf(trigger!)
  expect(reason?.textContent).toBe(`${textModel} can't read images or files`)
  expect(getComputedStyle(reason!).display).not.toBe('none')
  expect(getComputedStyle(reason!).visibility).not.toBe('hidden')
  expect(reason!.getClientRects().length).toBeGreaterThan(0)
  trigger!.focus()
  expect(document.activeElement).toBe(trigger)
  inView(trigger!)
  inView(reason!)
  await settle()
  await shoot('disabled')

  const draftBeforePaste = field()?.value ?? ''
  pasteFiles(imageFile())
  await I.see(text(`${textModel} can't read images`).wait())
  await I.see(text('Switch to a vision model').wait())
  expect(field()?.value).toBe(draftBeforePaste)
  expect(field()?.value ?? '').not.toContain('shot.png')
  expect(activeChat().draft.text()).not.toContain('shot.png')
  expect(activeChat().draft.attachments()).toEqual([])
  const imageChip = document.querySelector('[data-rejection="image"]')
  expect(imageChip).toBeTruthy()
  inView(imageChip!)
  await settle()
  await shoot('paste-rejected')

  dropFiles(pdfFile())
  await I.see(text(`${textModel} can't read files`).wait())
  expect(field()?.value ?? '').not.toContain('notes.pdf')
  expect(activeChat().draft.attachments()).toEqual([])
  const fileChip = document.querySelector('[data-rejection="file"]')
  expect(fileChip).toBeTruthy()
  inView(fileChip!)
  await settle()
  await shoot('drop-rejected')

  await I.click(button('Switch to a vision model'))
  await expect
    .poll(() => openMenuLabels('Switch to a vision model'))
    .toEqual(visionSuggestions)
  const menu = document.querySelector(
    '[role="menu"][aria-label="Switch to a vision model"]',
  )
  expect(menu).toBeTruthy()
  inView(menu!)
  await settle()
  await shoot('switch-offered')

  await I.click(role('menuitem', 'Google: Gemini 2.5 Flash'))
  await expect.poll(() => activeChat().model()).toBe('google/gemini-2.5-flash')
  await I.see(text('Attach again').wait())
  expect(document.querySelector('[data-rejection="image"]')).toBeNull()
  expect(activeChat().draft.attachments()).toEqual([])
  await I.see(
    text("Google: Gemini 2.5 Flash can't read files").wait(),
  )

  activeChat().setModel('openai/o3-mini')
  await expect.poll(() => activeChat().model()).toBe('openai/o3-mini')
  pickFile(imageFile())
  await I.see(text(`${textModel} can't read images`).wait())
  pickFile(pdfFile())
  await I.see(text(`${textModel} can't read files`).wait())
  expect(activeChat().draft.attachments()).toEqual([])
  expect(storedPuts).toEqual([])

  activeChat().draft.text.set('Just words')
  activeChat().draft.attachments.set([
    {
      id: 'pending-shot',
      kind: 'image',
      name: 'shot.png',
      mime: 'image/png',
      size: 4,
    },
  ])
  await I.see(text(`Not supported by ${textModel}`).wait())
  await expect.poll(() => sendButton()?.disabled).toBe(true)
  expect(sendButton()?.getAttribute('aria-label')).toBe(
    `Not supported by ${textModel}`,
  )
  expect(storedPuts).toEqual([])

  activeChat().draft.attachments.set([])
  await expect.poll(() => sendButton()?.disabled).toBe(false)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Send')

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      read: async () => {
        throw new DOMException('denied', 'NotAllowedError')
      },
      writeText: async () => {},
    },
  })
  const unreadable = {
    files: [] as File[],
    items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }],
    types: ['image/png'],
    getData: () => '',
  }
  const pasteTarget = field()
  if (!pasteTarget) throw new Error('missing composer')
  dispatchTransfer('paste', pasteTarget, unreadable)
  await I.see(text("Couldn't read the clipboard.").wait())
  expect(sendButton()?.disabled).toBe(false)
  expect(activeChat().draft.text()).toBe('Just words')
  expect(activeChat().draft.attachments()).toEqual([])

  mockGeneration({
    ...generationRecord,
    id: 'gen-attach-1',
    model: 'openai/o3-mini',
  })
  mockChatStream({
    chunks: [
      {
        data: {
          id: 'gen-attach-1',
          object: 'chat.completion.chunk',
          created: 1710000000,
          model: 'openai/o3-mini',
          choices: [
            { index: 0, delta: { content: 'Ok.' }, finish_reason: null },
          ],
        },
      },
      {
        data: {
          id: 'gen-attach-1',
          object: 'chat.completion.chunk',
          created: 1710000000,
          model: 'openai/o3-mini',
          choices: [
            { index: 0, delta: { content: '' }, finish_reason: 'stop' },
          ],
        },
      },
    ],
  })
  const posts = chatBodies().length
  sendButton()?.click()
  await expect.poll(() => chatBodies().length, { timeout: 4_000 }).toBe(posts + 1)
  const serialized = messageParts(chatBodies().at(-1))
  expect(serialized).not.toMatch(/image_url|imageUrl|file_data|fileData/)
  expect(serialized).not.toContain('"type":"file"')
  expect(serialized).toContain('Just words')
  await expect
    .poll(async () => {
      const messages = await repo.listMessages(chatId)
      const sent = messages.find(
        (message) => message.role === 'user' && message.content === 'Just words',
      )
      return sent?.role === 'user' ? sent.attachments : null
    })
    .toEqual([])
  const draft = await repo.getDraft(chatId, tabId)
  expect(draft?.attachments ?? []).toEqual([])
  expect(storedPuts).toEqual([])
})
