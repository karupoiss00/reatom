import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { openDB } from 'idb'
import {
  button,
  createActor,
  role,
  text,
  type UserEvent,
} from 'kahraman'
import { userEvent } from 'storybook/test'
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { resetRuntime } from '../platform/runtime'
import {
  catalogFetchedAt,
  catalogModels,
  catalogNewIds,
  catalogStatus,
  recordPick,
  refreshCatalog,
} from '../catalog'
import { getChatModel } from '../chat'
import { newChat } from '../chat/library'
import { now } from '../platform/env'
import { lastPickedModel, recentModels } from '../storage/prefs'
import { favoriteModels } from '../storage/prefs'
import { initStorage } from '../storage'
import { openChat } from '../routes'
import { writeStoredKey } from '../auth'
import { sessionMode } from '../auth/session'
import { limitedKey } from './fixtures/keys'
import {
  catalogModels as wireModels,
  freeModelId,
} from './fixtures/models'
import { resetBrowserState } from './env'
import {
  installOpenRouterMock,
  mockKey,
  mockModels,
  mockRouteDelay,
  requestsTo,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const mayaKey = 'sk-or-v1-mayapicker1'
const dayMs = 24 * 60 * 60 * 1000
const hourMs = 60 * 60 * 1000
const goneModelId = 'openai/gpt-retired'
const customModelId = 'vendor/not-listed'
const pricedFreeId = 'vendor/sample:free'
const freshModelId = 'openai/gpt-4.1'

const pricedFree = {
  ...wireModels.find((model) => model.id === freeModelId)!,
  id: pricedFreeId,
  canonical_slug: pricedFreeId,
  name: 'Vendor: Sample',
  pricing: { prompt: '0.000002', completion: '0.000004' },
}

const storyModels = [...wireModels, pricedFree]

const freshModel = {
  ...wireModels.find((model) => model.id === 'openai/gpt-4o-mini')!,
  id: freshModelId,
  canonical_slug: freshModelId,
  name: 'OpenAI: GPT-4.1',
}

const recentIds = [
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'openai/o3-mini',
  'mistralai/mistral-7b-instruct-v0.3',
]

let unmountTree: (() => void) | null = null

const settle = () => new Promise((resolve) => setTimeout(resolve, 220))

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot(flowId, name)
}

const chip = () => document.querySelector<HTMLElement>('[data-slot="ModelChip"]')

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-send]')

const pickerDialog = () => role('dialog', 'Choose a model')

const searchField = () =>
  document.querySelector<HTMLInputElement>(
    '[data-slot="ModelPicker"] input',
  )

const footer = () =>
  document.querySelector<HTMLElement>('[data-catalog-footer]')

const section = (name: string) =>
  document.querySelector<HTMLElement>(`[data-picker-section="${name}"]`)

const modelRows = (name: string) =>
  section(name)?.querySelectorAll<HTMLElement>('[data-model-id]') ?? []

const bootConnected = async (delayMs = 0) => {
  unmountTree?.()
  unmountTree = null
  await resetBrowserState()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(storyModels)
  mockKey(limitedKey)
  if (delayMs > 0) mockRouteDelay('/models', delayMs)
  await page.viewport(desktop.width, desktop.height)
  writeStoredKey(mayaKey, true)
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  unmountTree = mount(root, <App />).unmount
  await initStorage()
  await seedChats([
    { id: 'chat-a', title: 'Chat A', model: 'openai/gpt-4o-mini' },
    { id: 'chat-b', title: 'Chat B', model: 'google/gemini-2.5-flash' },
    { id: 'chat-gone', title: 'Retired', model: goneModelId },
    { id: 'chat-choose', title: 'Untitled', model: null },
  ])
  await boot()
  await expect.poll(() => sessionMode()).not.toBe('booting')
}

const remount = async (delayMs = 0) => {
  unmountTree?.()
  unmountTree = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(storyModels)
  mockKey(limitedKey)
  if (delayMs > 0) mockRouteDelay('/models', delayMs)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  unmountTree = mount(root, <App />).unmount
  await boot()
  await expect.poll(() => sessionMode()).not.toBe('booting')
}

const openPicker = async () => {
  chip()?.click()
  await I.see(pickerDialog().wait())
}

const closePicker = async () => {
  await I.press('{Escape}')
  await I.dontSee(pickerDialog())
}

const setSort = (value: 'match' | 'price' | 'context') => {
  const sort = document.querySelector<HTMLSelectElement>(
    '[data-slot="ModelPicker"] select',
  )
  if (!sort) throw new Error('missing sort')
  sort.value = value
  sort.dispatchEvent(new Event('input', { bubbles: true }))
}

const persistedCatalog = async () => {
  const db = await openDB('reatom_default')
  try {
    if (!db.objectStoreNames.contains('atoms')) return undefined
    const record = (await db.get('atoms', 'atelier.catalog')) as
      | { data?: unknown }
      | undefined
    return record?.data
  } finally {
    db.close()
  }
}

const pressShortcut = () => {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'l',
      code: 'KeyL',
      bubbles: true,
      cancelable: true,
      metaKey: true,
      shiftKey: true,
    }),
  )
}

test('Maya browses the catalog, picks a model, and keeps each chat on its own', async () => {
  await bootConnected(900)
  I.init({
    canvasElement: document.body,
    userEvent: userEvent.setup() as unknown as UserEvent,
  })

  await expect.poll(() => requestsTo('/models').length).toBe(1)
  chip()?.click()
  await I.see(pickerDialog().wait())
  expect(document.activeElement).toBe(searchField())
  expect(document.querySelector('[data-skeleton]')).not.toBeNull()
  expect(document.querySelector('[data-model-id]')).toBeNull()
  await settle()
  await shoot('F-04', 'loading')

  await expect
    .poll(() => footer()?.textContent ?? '', { timeout: 3_000 })
    .toMatch(/Catalog updated .+ · Refresh/)
  expect(document.querySelector('[data-skeleton]')).toBeNull()
  expect(document.querySelector('[data-model-id]')).not.toBeNull()
  expect(footer()?.getAttribute('data-tone')).not.toBe('warning')
  expect(section('favorites')?.textContent).toContain(
    'Star models to keep them here',
  )
  expect(section('recent')?.textContent).toContain('Recent')
  const all = section('all')
  expect(all?.textContent).toContain('All models')
  expect(all?.querySelector(':scope > button')).toBeNull()
  expect(
    [...document.querySelectorAll('button')].some((item) =>
      /All models/.test(item.textContent ?? ''),
    ),
  ).toBe(false)
  expect(modelRows('all')).toHaveLength(storyModels.length)
  await settle()
  await shoot('F-04', 'cached')
  await shoot('F-04b', 'empty-favorites')
  await expect.poll(async () => {
    const data = await persistedCatalog()
    return Array.isArray(data) && data.length === storyModels.length
  }).toBe(true)
  await closePicker()

  await remount(2_000)
  const cacheShownAt = performance.now()
  chip()?.click()
  await expect
    .poll(
      () =>
        /Catalog updated .+ · Refresh/.test(footer()?.textContent ?? '') &&
        document.querySelector('[data-skeleton]') === null &&
        document.querySelector('[data-model-id]') !== null,
      { timeout: 100 },
    )
    .toBe(true)
  expect(performance.now() - cacheShownAt).toBeLessThan(100)
  await I.see(pickerDialog())
  await closePicker()

  await openPicker()
  mockRouteDelay('/models', 700)
  const refresh = refreshCatalog()
  await I.see(role('img', 'Updating catalog').wait())
  expect(document.querySelector('[data-skeleton]')).toBeNull()
  expect(modelRows('all')).toHaveLength(storyModels.length)
  await settle()
  await shoot('F-04', 'revalidating')
  await refresh
  await I.dontSee(role('img', 'Updating catalog'))

  mockModels([...storyModels, freshModel])
  await refreshCatalog()
  expect(catalogNewIds()).toEqual([freshModelId])
  expect(favoriteModels()).not.toContain(freshModelId)
  expect(recentModels()).not.toContain(freshModelId)
  const freshRow = document.querySelector(
    `[data-picker-section="all"] [data-model-id="${freshModelId}"]`,
  )
  expect(freshRow?.textContent).toContain('New')
  expect(section('favorites')?.textContent ?? '').not.toContain('GPT-4.1')
  expect(section('recent')?.textContent ?? '').not.toContain('New')

  for (const id of recentIds) recordPick(id)
  await settle()
  expect(modelRows('recent')).toHaveLength(5)
  expect(
    [...modelRows('recent')].some(
      (row) => row.dataset.modelId === 'openai/gpt-4o-mini',
    ),
  ).toBe(false)
  document
    .querySelector<HTMLButtonElement>(
      '[data-model-id="anthropic/claude-sonnet-4"] button[aria-label^="Star"]',
    )
    ?.click()
  await settle()
  expect(section('favorites')?.textContent).toContain(
    'Anthropic: Claude Sonnet 4',
  )
  expect(section('favorites')?.textContent).not.toContain(
    'Star models to keep them here',
  )
  await settle()
  await shoot('F-04b', 'populated')

  const claude = document.querySelector<HTMLElement>(
    '[data-model-id="anthropic/claude-sonnet-4"]',
  )
  expect(claude?.textContent).toContain('Anthropic: Claude Sonnet 4')
  expect(claude?.textContent).toContain('anthropic/claude-sonnet-4')
  expect(claude?.textContent).toContain('200k')
  expect(claude?.textContent).toContain('$3.00 / $15.00 per 1M in/out')
  expect(claude?.textContent).toContain('Image in')
  expect(claude?.textContent).toContain('File in')
  expect(claude?.textContent).toContain('Reasoning')
  expect(claude?.textContent).toContain('Moderated')

  const freeRow = document.querySelector(
    `[data-model-id="${freeModelId}"]`,
  )
  expect(freeRow?.textContent).toContain('Free')
  expect(freeRow?.textContent ?? '').not.toMatch(/\$\d/)

  const pricedFreeRow = document.querySelector(
    `[data-model-id="${pricedFreeId}"]`,
  )
  expect(pricedFreeRow?.textContent).toContain('$2.00 / $4.00 per 1M in/out')
  expect(pricedFreeRow?.textContent).not.toContain('Free')

  const field = searchField()
  if (!field) throw new Error('missing search')
  const filterStarted = performance.now()
  field.value = 'claude'
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await expect
    .poll(() => modelRows('all').length, { timeout: 100 })
    .toBe(1)
  expect(
    document.querySelector('[data-model-id="anthropic/claude-sonnet-4"]'),
  ).not.toBeNull()
  expect(performance.now() - filterStarted).toBeLessThan(100)
  await settle()
  await shoot('F-04b', 'filtered')

  field.value = ''
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await I.click(button('Free'))
  await I.click(button('Images'))
  expect(modelRows('all')).toHaveLength(0)
  await I.click(button('Images'))
  expect(
    [...modelRows('all')].map((row) => row.dataset.modelId),
  ).toEqual([freeModelId])
  await I.click(button('Free'))
  await I.click(button('Reasoning'))
  await I.click(button(/Long context/))
  expect(
    [...modelRows('all')].map((row) => row.dataset.modelId).sort(),
  ).toEqual(
    [
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-pro',
      'openai/o3-mini',
    ].sort(),
  )
  await I.click(button('Reasoning'))
  await I.click(button(/Long context/))
  field.value = 'Gemini'
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await expect
    .poll(() => modelRows('all')[0]?.dataset.modelId)
    .toBe('google/gemini-2.5-pro')
  field.value = ''
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  setSort('price')
  await expect.poll(() => {
    const ids = [...modelRows('all')].map((row) => row.dataset.modelId)
    const cheaperPaid = ids.indexOf('mistralai/mistral-7b-instruct-v0.3')
    const pricierPaid = ids.indexOf('openai/o3-mini')
    return (
      cheaperPaid >= 0 &&
      pricierPaid >= 0 &&
      cheaperPaid < pricierPaid &&
      ids.at(-1) === 'anthropic/claude-sonnet-4'
    )
  }).toBe(true)
  setSort('context')
  await expect
    .poll(() => modelRows('all')[0]?.dataset.modelId)
    .toBe('google/gemini-2.5-flash')
  setSort('match')

  field.value = customModelId
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await I.see(text(`Use \`${customModelId}\` as model id`))
  expect(document.querySelector('[data-custom-id]')?.textContent).toContain(
    'Custom',
  )
  expect(modelRows('all')).toHaveLength(0)
  await settle()
  await shoot('F-04b', 'no-results')
  field.value = ''
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await closePicker()

  openChat('chat-a')
  await openPicker()
  document
    .querySelector<HTMLElement>(
      '[data-picker-section="all"] [data-model-id="anthropic/claude-sonnet-4"] [role="option"], [data-model-id="anthropic/claude-sonnet-4"] [role="option"]',
    )
    ?.click()
  await I.dontSee(pickerDialog())
  expect(chip()?.textContent).toContain('Anthropic: Claude Sonnet 4')
  openChat('chat-b')
  await expect
    .poll(() => chip()?.textContent ?? '')
    .toContain('Google: Gemini 2.5 Flash')
  expect(chip()?.textContent ?? '').not.toContain('Claude')
  openChat('chat-a')
  await expect
    .poll(() => chip()?.textContent ?? '')
    .toContain('Anthropic: Claude Sonnet 4')

  await remount()
  openChat('chat-a')
  await expect
    .poll(() => chip()?.textContent ?? '')
    .toContain('Anthropic: Claude Sonnet 4')
  openChat('chat-b')
  await expect
    .poll(() => chip()?.textContent ?? '')
    .toContain('Google: Gemini 2.5 Flash')
  expect(lastPickedModel()).toBe('anthropic/claude-sonnet-4')
  newChat()
  await expect.poll(() => chip()?.textContent ?? '').toContain('Claude Sonnet')

  await I.click(role('textbox', 'Message'))
  pressShortcut()
  await I.see(pickerDialog().wait())
  const keyboardSearch = searchField()
  expect(document.activeElement).toBe(keyboardSearch)
  if (!keyboardSearch) throw new Error('missing search')
  keyboardSearch.value = 'llama'
  keyboardSearch.dispatchEvent(new InputEvent('input', { bubbles: true }))
  const selectedModelId = () =>
    document
      .querySelector('[role="option"][aria-selected="true"]')
      ?.closest('[data-model-id]')
      ?.getAttribute('data-model-id') ?? null
  const listedModelIds = () =>
    [...document.querySelectorAll('#model-picker-list [role="option"]')]
      .map(
        (option) =>
          option.closest('[data-model-id]')?.getAttribute('data-model-id') ??
          null,
      )
      .filter((id): id is string => id !== null)
  await expect.poll(() => listedModelIds().length).toBeGreaterThan(1)
  const listedIds = listedModelIds()
  const selectedBefore = selectedModelId()
  const selectedIndex = listedIds.indexOf(selectedBefore ?? '')
  expect(selectedIndex).toBeGreaterThanOrEqual(0)
  expect(selectedIndex).toBeLessThan(listedIds.length - 1)
  await I.press('{ArrowDown}')
  await expect.poll(selectedModelId).toBe(listedIds[selectedIndex + 1])
  await I.press('{ArrowUp}')
  await expect.poll(selectedModelId).toBe(selectedBefore)
  const chosenName = [...storyModels, freshModel].find(
    (model) => model.id === selectedBefore,
  )?.name
  expect(chosenName).toBeTruthy()
  await I.press('{Enter}')
  await I.dontSee(pickerDialog())
  expect(document.activeElement).toBe(chip())
  await expect
    .poll(() => chip()?.querySelector('[data-label]')?.textContent ?? '')
    .toBe(chosenName)

  await openPicker()
  await I.press('{Escape}')
  await I.dontSee(pickerDialog())
  expect(document.activeElement).toBe(chip())

  openChat('chat-a')
  await expect
    .poll(() => chip()?.textContent ?? '')
    .toContain('Anthropic: Claude Sonnet 4')
  await openPicker()
  const search = searchField()
  if (!search) throw new Error('missing search')
  search.value = customModelId
  search.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await expect
    .poll(() => document.querySelector<HTMLElement>('[data-custom-id]'))
    .not.toBeNull()
  document.querySelector<HTMLElement>('[data-custom-id]')?.click()
  await I.dontSee(pickerDialog())
  expect(chip()?.textContent).toContain(customModelId)
  expect(chip()?.textContent).toContain('Custom')
  expect(chip()?.getAttribute('data-state')).toBe('custom')
  await expect.poll(() => getChatModel('chat-a').model()).toBe(customModelId)
  await settle()
  await shoot('F-04b', 'custom')

  await remount()
  openChat('chat-a')
  await expect.poll(() => chip()?.getAttribute('data-state')).toBe('custom')
  expect(chip()?.textContent).toContain(customModelId)

  openChat('chat-gone')
  await expect.poll(() => chip()?.textContent ?? '').toContain(goneModelId)
  expect(chip()?.textContent).toContain('Not in catalog')
  expect(chip()?.textContent ?? '').not.toContain('Custom')
  expect(chip()?.getAttribute('data-state')).toBe('missing')
  const message = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Message"]',
  )
  if (!message) throw new Error('missing message')
  message.value = 'Hello'
  message.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await settle()
  expect(sendButton()?.disabled).toBe(false)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Send')

  openChat('chat-choose')
  await expect.poll(() => chip()?.textContent ?? '').toContain('Choose a model')
  expect(chip()?.getAttribute('data-state')).toBe('choose')
  expect(sendButton()?.disabled).toBe(true)
  expect(sendButton()?.getAttribute('aria-label')).toBe('Choose a model')

  catalogFetchedAt.set(now() - dayMs - 60_000)
  mockModels([{ id: 'not-a-model' }])
  await refreshCatalog().catch(() => undefined)
  expect(catalogStatus()).toBe('stale')
  await openPicker()
  expect(footer()?.getAttribute('data-tone')).toBe('warning')
  expect(footer()?.textContent ?? '').toMatch(/Prices as of .+ · Refresh/)
  expect(document.body.textContent ?? '').not.toContain(
    "Couldn't refresh models",
  )
  await settle()
  await shoot('F-04', 'stale')
  await closePicker()

  catalogFetchedAt.set(now() - 2 * hourMs)
  await refreshCatalog().catch(() => undefined)
  await openPicker()
  await I.see(
    text("Couldn't refresh models; showing list from 2 hours ago").wait(),
  )
  expect(document.querySelector('[data-toast-key]')).toBeNull()
  expect(document.querySelector('[data-model-id]')).not.toBeNull()
  expect(section('all')?.textContent).toContain('All models')
  await settle()
  await shoot('F-04', 'refresh-failed')
  await closePicker()

  mockRouteDelay('/models', 0)
  mockModels([])
  await refreshCatalog()
  expect(catalogStatus()).toBe('empty')
  await openPicker()
  await I.see(text('OpenRouter returned no models.'))
  await I.see(button('Retry'))
  expect(document.querySelector('[data-custom-id]')).not.toBeNull()
  await settle()
  await shoot('F-04', 'empty')
  await closePicker()

  catalogModels.set([])
  catalogFetchedAt.set(null)
  await expect.poll(() => persistedCatalog()).toEqual([])
  mockModels([{ id: 'not-a-model' }])
  await refreshCatalog().catch(() => undefined)
  expect(catalogStatus()).toBe('error')
  await openPicker()
  await I.see(text("Couldn't load models."))
  await I.see(button('Retry'))
  expect(document.querySelector('[data-custom-id]')).not.toBeNull()
  await settle()
  await shoot('F-04', 'error')

  mockModels(storyModels)
  await I.click(button('Retry'))
  await expect
    .poll(() => footer()?.textContent ?? '')
    .toMatch(/Catalog updated .+ · Refresh/)
  await I.see(text('OpenAI: GPT-4o-mini'))
  expect(getChatModel('chat-a').model()).toBe(customModelId)
  expect(getChatModel('chat-b').model()).toBe('google/gemini-2.5-flash')
  expect(getChatModel('chat-gone').model()).toBe(goneModelId)
}, 60_000)
