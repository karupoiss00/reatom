import { createActor, role, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-sort-pad'

const keyboard = userEvent.setup() as unknown as UserEvent

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const sortSelect = () =>
  document.querySelector<HTMLSelectElement>(
    '[data-slot="ModelPicker"] select[aria-label="Sort"]',
  )

const lengthPx = (value: string) => {
  const match = value.trim().match(/^([\d.]+)px$/)
  return match ? Number(match[1]) : Number.NaN
}

const chevronInsetPx = (style: CSSStyleDeclaration) => {
  if (style.backgroundImage === 'none' || style.backgroundImage === '') return 0
  const horizontal = style.backgroundPositionX.trim()
  const fromEnd = horizontal.match(/calc\(100%\s*-\s*([\d.]+)px\)/)
  if (fromEnd) return Number(fromEnd[1])
  const keyword = horizontal.match(/right\s+([\d.]+)px/)
  if (keyword) return Number(keyword[1])
  if (horizontal === '100%') return 0
  return 0
}

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya sees the sort arrow inset from the pill edge', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [{ id: 'chat-sort', title: 'Sort', model: 'openai/gpt-4o-mini' }],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  await expect
    .poll(() => document.querySelector('[data-slot="ModelChip"]'))
    .not.toBeNull()
  document.querySelector<HTMLElement>('[data-slot="ModelChip"]')?.click()
  await I.see(role('dialog', 'Choose a model').wait())
  await expect.poll(() => sortSelect()).not.toBeNull()

  const select = sortSelect()
  if (!select) throw new Error('missing sort')
  expect([...select.options].map((option) => option.text)).toEqual([
    'Best match',
    'Price',
    'Context',
  ])
  expect([...select.options].map((option) => option.value)).toEqual([
    'match',
    'price',
    'context',
  ])
  expect(select.value).toBe('match')

  const style = getComputedStyle(select)
  const paddingInlineEnd = lengthPx(style.paddingInlineEnd)
  const chevronInset = chevronInsetPx(style)
  expect(paddingInlineEnd).toBeGreaterThanOrEqual(28)
  expect(chevronInset).toBeGreaterThanOrEqual(10)
  expect(style.appearance).toBe('none')

  const free = [...document.querySelectorAll('[data-slot="ModelPicker"] button')].find(
    (node) => node.textContent?.trim() === 'Free',
  )
  expect(free).toBeTruthy()
  const freeBox = free!.getBoundingClientRect()
  const selectBox = select.getBoundingClientRect()
  const freeMid = freeBox.top + freeBox.height / 2
  const selectMid = selectBox.top + selectBox.height / 2
  expect(Math.abs(freeMid - selectMid)).toBeLessThanOrEqual(1)

  await settle()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('U-03', 'sort')
})
