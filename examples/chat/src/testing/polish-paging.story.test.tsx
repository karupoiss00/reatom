import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { openChat } from '../routes'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-paging-story'
const chatId = 'chat-paging'
const prompt = '1 + 1?'

const keyboard = userEvent.setup() as unknown as UserEvent

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const userMessage = () =>
  document.querySelector<HTMLElement>('[data-slot="UserMessage"]')

const named = (label: string) =>
  userMessage()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

const box = (element: Element) => element.getBoundingClientRect()

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Nora sees paging, Edit, and Copy on one line under her message', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    seed: [
      {
        id: chatId,
        title: 'Paging',
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  openChat(chatId)
  await I.see(text(prompt).wait())
  await I.see(button('Previous version').wait())
  await I.see(button('Next version').wait())
  await I.see(button('Edit').wait())
  await I.see(button('Copy message').wait())

  const message = userMessage()
  const bubble = message?.querySelector<HTMLElement>('[dir="auto"]')
  const previous = named('Previous version')
  const next = named('Next version')
  const edit = named('Edit')
  const copy = named('Copy message')
  const version = message?.querySelector('[data-version]')
  expect(bubble).toBeTruthy()
  expect(previous).toBeTruthy()
  expect(next).toBeTruthy()
  expect(edit).toBeTruthy()
  expect(copy).toBeTruthy()
  expect(version?.textContent).toBe('1/1')

  const editBox = box(edit!)
  const copyBox = box(copy!)
  const bubbleBox = box(bubble!)
  const messageBox = box(message!)
  const editCenter = editBox.top + editBox.height / 2
  const copyCenter = copyBox.top + copyBox.height / 2
  expect(Math.abs(editCenter - copyCenter)).toBeLessThanOrEqual(4)
  expect(copyBox.left).toBeGreaterThanOrEqual(editBox.right - 1)
  expect(Math.abs(copyBox.right - bubbleBox.right)).toBeLessThanOrEqual(4)
  expect(copyBox.right).toBeGreaterThan(messageBox.left + messageBox.width / 2)
  expect(getComputedStyle(edit!).fontSize).toBe(getComputedStyle(copy!).fontSize)
  expect(getComputedStyle(version!).fontSize).toBe(getComputedStyle(edit!).fontSize)

  edit!.scrollIntoView({ block: 'center', inline: 'nearest' })
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('U-06', 'one-line')
})
