import { createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { compareSession, sameModelNote } from '../chat/compare'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-polish-compare'
const primaryId = 'openai/gpt-4o-mini'
const secondId = 'anthropic/claude-sonnet-4'
const primaryName = 'OpenAI: GPT-4o-mini'
const secondName = 'Anthropic: Claude Sonnet 4'
const different = 'Pick a different model.'
const hold = 'Pick a reply to continue'
const sendsTwo = 'Sends 2 requests'
const slack = 2

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const card = () => document.querySelector<HTMLElement>('[data-composer-card]')

const searchField = () =>
  document.querySelector<HTMLInputElement>('[data-slot="ModelPicker"] input')

const pickerOpen = () =>
  document.querySelector('[data-slot="ModelPicker"]')?.closest('dialog')?.open ??
  false

const compareSwitch = () =>
  document.querySelector<HTMLInputElement>('[data-testid="model-picker-compare-switch"]')

const openModelPicker = async () => {
  document.querySelector<HTMLButtonElement>('[data-slot="ModelChip"]')?.click()
  await expect.poll(() => searchField()).toBeTruthy()
}

const setPickerQuery = async (query: string) => {
  const field = searchField()
  if (!field) throw new Error('missing search')
  field.focus()
  field.value = query
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
}

const clickListed = async (modelId: string) => {
  const option = () =>
    document.querySelector<HTMLElement>(
      `[data-picker-section="all"] [data-model-id="${modelId}"] [role="option"]`,
    )
  await expect.poll(() => option()).toBeTruthy()
  option()?.click()
}

const setCompareSwitch = async (on: boolean) => {
  const pressed = compareSwitch()?.getAttribute('aria-pressed') === 'true'
  if (pressed !== on) compareSwitch()?.click()
  await expect.poll(() => compareSwitch()?.getAttribute('aria-pressed')).toBe(
    on ? 'true' : 'false',
  )
}

const closeModelPicker = async () => {
  await I.press('{Escape}')
  await expect.poll(() => pickerOpen()).toBe(false)
}

const pickModel = async (modelId: string, query: string) => {
  await openModelPicker()
  await setCompareSwitch(false)
  await setCompareSwitch(true)
  if (modelId === primaryId) {
    await setPickerQuery(primaryId)
    await clickListed(primaryId)
    await clickListed(primaryId)
    await closeModelPicker()
    return
  }
  await setPickerQuery(primaryId)
  await clickListed(primaryId)
  await setPickerQuery(query)
  await clickListed(modelId)
  await closeModelPicker()
}

const insideCard = (element: Element, label: string) => {
  const box = card()?.getBoundingClientRect()
  if (!box) throw new Error('missing composer card')
  const item = element.getBoundingClientRect()
  expect(item.width, `${label} has no width`).toBeGreaterThan(0)
  expect(item.height, `${label} has no height`).toBeGreaterThan(0)
  expect(item.left, `${label} left edge is outside the composer card`).toBeGreaterThanOrEqual(
    box.left - slack,
  )
  expect(item.top, `${label} top edge is outside the composer card`).toBeGreaterThanOrEqual(
    box.top - slack,
  )
  expect(
    item.right,
    `${label} right edge is outside the composer card`,
  ).toBeLessThanOrEqual(box.right + slack)
  expect(
    item.bottom,
    `${label} bottom edge is outside the composer card`,
  ).toBeLessThanOrEqual(box.bottom + slack)
}

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('armed compare chrome stays inside the composer card', async () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(primaryName)

  await pickModel(secondId, 'claude-sonnet-4')
  const model = document.querySelector<HTMLElement>('[data-compare-model]')
  const estimate = document.querySelector<HTMLElement>('[data-compare-estimate]')
  expect(
    [...document.querySelectorAll('[data-composer-card] button')].some(
      (item) => item.textContent?.trim() === 'Compare',
    ),
  ).toBe(false)
  expect(model?.textContent).toContain(secondName)
  expect(estimate?.textContent).toContain(sendsTwo)
  expect(estimate?.textContent).toMatch(/≈|\$/)
  if (!model || !estimate) throw new Error('missing compare chrome')

  const primary = document.querySelector<HTMLElement>('[data-slot="ModelChip"]')
  const primaryLabel = primary?.querySelector<HTMLElement>('[data-label]')
  const modelLabel = model.querySelector<HTMLElement>('span')
  if (!primary || !primaryLabel || !modelLabel) throw new Error('missing model labels')
  expect(Math.abs(model.getBoundingClientRect().top - primary.getBoundingClientRect().top)).toBeLessThan(
    48,
  )
  expect(primaryLabel.scrollWidth).toBeLessThanOrEqual(primaryLabel.clientWidth + 1)
  expect(modelLabel.scrollWidth).toBeLessThanOrEqual(modelLabel.clientWidth + 1)
  expect(estimate.scrollWidth).toBeLessThanOrEqual(estimate.clientWidth + 1)
  insideCard(model, 'model chip')
  insideCard(estimate, 'estimate')
  expect(modelLabel.textContent).toContain(secondName)
  const outsideExact = [...document.body.querySelectorAll('*')].filter((element) => {
    if (element.closest('[data-composer-card]')) return false
    return (element.textContent ?? '').trim() === sendsTwo
  })
  expect(outsideExact, 'Sends 2 requests sits outside the composer card').toEqual([])

  expect(document.querySelector('vite-error-overlay')).toBeNull()
  card()?.scrollIntoView({ block: 'center', inline: 'nearest' })
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  await settle()
  await shot('U-09', 'inside')

  await pickModel(primaryId, primaryId)
  const notice = document.querySelector<HTMLElement>('[data-compare-notice]')
  expect(notice?.textContent).toContain(different)
  expect(document.querySelector('[data-compare-model]')).toBeNull()
  if (!notice) throw new Error('missing compare notice')
  insideCard(notice, 'different-model note')

  sameModelNote.set(false)
  compareSession.set({
    chatId: activeChat().id,
    phase: 'pending',
    models: [primaryId, secondId],
    groupId: null,
  })
  await expect.poll(() => document.querySelector('[data-compare-hold]')?.textContent).toContain(
    hold,
  )
  const held = document.querySelector<HTMLElement>('[data-compare-hold]')
  if (!held) throw new Error('missing compare hold')
  insideCard(held, 'hold')
})
