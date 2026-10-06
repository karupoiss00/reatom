import { button, createActor, role, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels, curatedMiniModelId } from './fixtures/models'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-polish-effort'
const middleModelId = curatedMiniModelId
const middleEfforts = ['max', 'high', 'low'] as const

const middleModels = catalogModels.map((entry) =>
  entry.id === middleModelId
    ? {
        ...entry,
        reasoning: {
          mandatory: false,
          supported_efforts: [...middleEfforts],
        },
      }
    : entry,
)

const keyboard = userEvent.setup() as unknown as UserEvent

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const effortChip = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] button[aria-label^="Effort:"]',
  )

const effortMenu = () =>
  document.querySelector<HTMLElement>('[role="menu"][aria-label^="Effort:"]')

const effortMarks = () =>
  effortChip()?.querySelector<SVGElement>('[data-effort]')?.getAttribute('data-effort') ??
  null

const effortMarkCount = () =>
  effortChip()?.querySelector<SVGElement>('[data-marks]')?.getAttribute('data-marks') ??
  null

const checkedEffort = () =>
  effortMenu()?.querySelector<HTMLElement>('[aria-checked="true"]')?.dataset
    .menuLabel

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('a max high low model opens on the middle effort', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
    models: middleModels,
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })

  activeChat().setModel(middleModelId)
  await expect.poll(() => activeChat().model()).toBe(middleModelId)
  await expect.poll(() => effortChip()?.getAttribute('aria-label')).toBe('Effort: high')
  expect(effortMarks()).toBe('high')
  expect(effortMarkCount()).toBe('4')
  expect(activeChat().settings().params.reasoningEffort).toBeUndefined()

  await I.click(button('Effort: high'))
  await expect.poll(() => checkedEffort()).toBe('high')
  expect(
    [...(effortMenu()?.querySelectorAll<HTMLElement>('[data-menu-label]') ?? [])].map(
      (item) => item.dataset.menuLabel,
    ),
  ).toEqual([...middleEfforts])
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await settle()
  await shot('U-08', 'middle')

  await I.click(role('menuitemradio', 'low'))
  await expect.poll(() => effortChip()?.getAttribute('aria-label')).toBe('Effort: low')
  expect(effortMarks()).toBe('low')
  expect(effortMarkCount()).toBe('2')
  expect(activeChat().settings().params.reasoningEffort).toBe('low')

  await I.click(button('Effort: low'))
  await I.click(role('menuitemradio', 'high'))
  await expect.poll(() => effortChip()?.getAttribute('aria-label')).toBe('Effort: high')
  expect(effortMarks()).toBe('high')
  expect(effortMarkCount()).toBe('4')
  expect(activeChat().settings().params.reasoningEffort).toBeUndefined()
})
