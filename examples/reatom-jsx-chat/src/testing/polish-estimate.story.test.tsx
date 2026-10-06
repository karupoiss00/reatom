import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { openLayerCount } from '../ui'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-polish-estimate'
const noWebPriceId = 'google/gemini-2.5-pro'
const totalExplanation = 'Total cost of replies in this chat'
const mayAddCost = 'Web search may add cost'
const emptyHeading = 'What should we think about?'

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
  hover: (element: Element) => Promise<void>
  unhover: (element: Element) => Promise<void>
}

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

const chatTotal = () =>
  document.querySelector<HTMLElement>('[data-chat-total]')

const globe = () =>
  document.querySelector<HTMLButtonElement>('[data-web-search-toggle]')

const composerCard = () =>
  document.querySelector<HTMLElement>('[data-composer-card]')

const heading = () =>
  [...document.querySelectorAll('p')].find(
    (node) => node.textContent?.trim() === emptyHeading,
  )

const openTip = (sentence: string) =>
  [...document.querySelectorAll('[role="tooltip"]')].find(
    (panel) =>
      panel.matches(':popover-open') &&
      (panel.textContent ?? '').includes(sentence),
  )

const inFlowCostWarning = () =>
  document.querySelector('[data-cost-notes], [data-web-search-notice]')
    ?.textContent ?? ''

test('hovering the estimate and the globe explains cost without moving the composer', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await I.see(text(emptyHeading))
  await expect.poll(() => {
    const total = chatTotal()
    const box = total?.getBoundingClientRect()
    return Boolean(total && box && box.width > 0 && box.height > 0)
  }).toBe(true)

  const aboutEstimate = chatTotal()!
  expect(openTip(totalExplanation)).toBeUndefined()
  expect(openLayerCount()).toBe(0)

  await keyboard.hover(aboutEstimate)
  await expect.poll(() => {
    const tip = openTip(totalExplanation)
    const total = chatTotal()
    if (!tip || !total) return false
    const tipBox = tip.getBoundingClientRect()
    const buttonBox = total.getBoundingClientRect()
    return (
      tipBox.width > 0 &&
      tipBox.height > 0 &&
      tipBox.bottom <= buttonBox.top + 8 &&
      tipBox.left >= 0 &&
      tipBox.right <= window.innerWidth + 1
    )
  }).toBe(true)
  expect(document.activeElement).not.toBe(openTip(totalExplanation))
  expect(openLayerCount()).toBe(0)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await settle()
  await shot('U-01', 'hover')

  await keyboard.unhover(aboutEstimate)
  await expect.poll(() => openTip(totalExplanation)).toBeUndefined()

  aboutEstimate.focus()
  await expect.poll(() => openTip(totalExplanation)).toBeTruthy()
  expect(document.activeElement).toBe(aboutEstimate)
  expect(openLayerCount()).toBe(0)
  aboutEstimate.blur()
  await expect.poll(() => openTip(totalExplanation)).toBeUndefined()

  activeChat().setModel(noWebPriceId)
  await expect.poll(() => activeChat().model()).toBe(noWebPriceId)
  await expect.poll(() => composerCard()).toBeTruthy()
  expect(globe()?.getAttribute('aria-pressed')).toBe('false')

  const cardBefore = composerCard()!.getBoundingClientRect().top
  const headingBefore = heading()!.getBoundingClientRect().top

  await I.click(button('Web search'))
  await expect.poll(() => globe()?.getAttribute('aria-pressed')).toBe('true')
  expect(inFlowCostWarning()).not.toContain(mayAddCost)
  expect(composerCard()!.getBoundingClientRect().top).toBe(cardBefore)
  expect(heading()!.getBoundingClientRect().top).toBe(headingBefore)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await settle()
  await shot('U-02', 'no-shift')

  const globeButton = globe()!
  await keyboard.hover(globeButton)
  await expect.poll(() => {
    const tip = openTip(mayAddCost)
    const button = globe()
    if (!tip || !button) return false
    const tipBox = tip.getBoundingClientRect()
    const buttonBox = button.getBoundingClientRect()
    return (
      tipBox.width > 0 &&
      tipBox.height > 0 &&
      tipBox.bottom <= buttonBox.top + 8 &&
      tipBox.left >= 0 &&
      tipBox.right <= window.innerWidth + 1
    )
  }).toBe(true)
  expect(document.activeElement).not.toBe(openTip(mayAddCost))
  expect(openLayerCount()).toBe(0)
  await keyboard.unhover(globeButton)
  await expect.poll(() => openTip(mayAddCost)).toBeUndefined()

  globeButton.focus()
  await expect.poll(() => openTip(mayAddCost)).toBeTruthy()
  expect(document.activeElement).toBe(globeButton)
  globeButton.blur()
  await expect.poll(() => openTip(mayAddCost)).toBeUndefined()

  await I.click(button('Web search'))
  await expect.poll(() => globe()?.getAttribute('aria-pressed')).toBe('false')
})
