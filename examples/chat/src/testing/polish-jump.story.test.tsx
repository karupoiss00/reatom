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
const storyKey = 'sk-or-v1-polish-jump'

const keyboard = userEvent.setup() as unknown as UserEvent

const distanceFromEnd = (scroller: HTMLElement) =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

const thread = () => document.querySelector<HTMLElement>('[data-slot="Thread"]')

const backdropAlpha = (element: Element) => {
  const color = getComputedStyle(element).backgroundColor
  if (color === 'transparent') return 0
  const channels = color.match(/[\d.]+/g) ?? []
  if (channels.length < 4) return 1
  return Number(channels[3])
}

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('the jump bar lets the thread show through', async () => {
  resetLocation()
  const history = Array.from({ length: 12 }, (_, index) => [
    {
      role: 'user' as const,
      content: `Earlier question ${index} stays in the page for find-in-page.`,
    },
    {
      role: 'assistant' as const,
      content: `Earlier answer ${index} is not virtualized. ${'line '.repeat(40)}`,
      status: 'done' as const,
    },
  ]).flat()

  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: 'chat-long',
        title: 'Long thread',
        model: 'openai/gpt-4o-mini',
        messages: history,
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  openChat('chat-long')
  await I.see(text('Earlier question 0 stays in the page for find-in-page.').wait())
  await expect
    .poll(() => thread()?.textContent ?? '')
    .toContain('Earlier answer 11 is not virtualized.')
  const scroller = thread()
  expect(scroller).toBeTruthy()
  await expect.poll(() => distanceFromEnd(scroller!)).toBeLessThanOrEqual(40)

  scroller!.scrollTop = Math.max(0, scroller!.scrollTop - 160)
  await expect.poll(() => scroller?.getAttribute('data-following')).toBe('false')
  await I.see(button(/Jump to latest/).wait())

  const pill = document.querySelector<HTMLButtonElement>('[data-scroll-pill]')
  const bar = pill?.parentElement
  expect(bar).toBeTruthy()
  expect(pill?.textContent).toBe('Jump to latest ↓')
  expect(pill?.getClientRects().length).toBeGreaterThan(0)
  expect(backdropAlpha(bar!)).toBe(0)
  expect(getComputedStyle(bar!).position).toBe('absolute')
  const shell = scroller!.parentElement
  expect(shell).toBeTruthy()
  expect(Math.abs(scroller!.clientHeight - shell!.clientHeight)).toBeLessThanOrEqual(1)
  const shellBox = shell!.getBoundingClientRect()
  const pillBox = pill!.getBoundingClientRect()
  const pillCenter = pillBox.left + pillBox.width / 2
  const shellCenter = shellBox.left + shellBox.width / 2
  expect(Math.abs(pillCenter - shellCenter)).toBeLessThanOrEqual(1)
  expect(shellBox.bottom - pillBox.bottom).toBeGreaterThanOrEqual(0)
  expect(shellBox.bottom - pillBox.bottom).toBeLessThanOrEqual(24)

  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('U-05', 'transparent')

  const parked = scroller!.scrollTop
  pill?.click()
  await expect.poll(() => scroller?.getAttribute('data-following')).toBe('true')
  await expect.poll(() => distanceFromEnd(scroller!)).toBeLessThanOrEqual(40)
  expect(scroller!.scrollTop).toBeGreaterThan(parked)
})
