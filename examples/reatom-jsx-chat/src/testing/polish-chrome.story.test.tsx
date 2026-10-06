import { button, createActor, role, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { ui } from '../app/ui'
import { openChat } from '../routes'
import { themePref } from '../storage/prefs'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-polish-chrome'
const chatTitle = 'Lattice notes'
const root = document.documentElement

const keyboard = userEvent.setup() as unknown as UserEvent

const header = () => document.querySelector<HTMLElement>('[data-slot="ChatHeader"]')

const themeLabels = () =>
  [
    ...(header()?.querySelectorAll<HTMLElement>('[data-slot="ThemeSwitch"] label') ??
      []),
  ].map((label) => label.textContent?.trim())

const themeControl = (label: string) => {
  const match = [
    ...(header()?.querySelectorAll<HTMLElement>('[data-slot="ThemeSwitch"] label') ??
      []),
  ].find((item) => item.textContent?.trim() === label)
  return match?.querySelector<HTMLInputElement>('input') ?? match
}

const appearanceChoice = (value: string) =>
  [
    ...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="theme"]'),
  ].find((input) => input.value === value)

const rowMenu = () =>
  document.querySelector<HTMLElement>(
    `[role="menu"][aria-label="Actions for ${chatTitle}"]`,
  )

const menuLabels = () =>
  [...(rowMenu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].map(
    (item) => item.dataset.menuLabel,
  )

const paint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

afterEach(async () => {
  unmountApp()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-theme-pref')
  await page.viewport(desktop.width, desktop.height)
})

test('the header switches theme and the row menu exports markdown', async () => {
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    seed: [
      {
        id: 'chat-lattice',
        title: chatTitle,
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Sketch the lattice.' },
          { role: 'assistant', content: 'A quiet grid.', status: 'done' },
        ],
      },
    ],
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => header()).toBeTruthy()

  expect({
    chatActions: header()?.querySelector('button[aria-label="Chat actions"]') != null,
    theme: themeLabels(),
    headerTotal: header()?.textContent?.includes('This chat:') ?? false,
  }).toEqual({
    chatActions: false,
    theme: ['Light', 'Dark', 'System'],
    headerTotal: false,
  })
  expect(document.querySelector('vite-error-overlay')).toBeNull()

  openChat('chat-lattice')
  await expect.poll(() => header()?.querySelector('h1')?.textContent).toBe(chatTitle)
  expect(header()?.querySelector('button[aria-label="Chat actions"]')).toBeNull()
  expect(header()?.textContent ?? '').not.toContain('This chat:')
  await expect
    .poll(() => document.querySelector('[data-cost-label]')?.textContent ?? '')
    .toContain('This chat:')

  themeControl('Dark')?.click()
  expect(root.dataset.theme).toBe('dark')
  expect(root.dataset.themePref).toBe('dark')
  expect(themePref()).toBe('dark')

  themeControl('Light')?.click()
  expect(root.dataset.theme).toBe('light')
  expect(root.dataset.themePref).toBe('light')
  expect(themePref()).toBe('light')

  themeControl('System')?.click()
  expect(root.dataset.themePref).toBe('system')
  expect(themePref()).toBe('system')
  expect(['light', 'dark']).toContain(root.dataset.theme)

  ui.appSettings.set('appearance')
  await expect.poll(() => appearanceChoice('system')?.checked).toBe(true)
  ui.appSettings.set(null)
  await expect
    .poll(
      () =>
        document.querySelector<HTMLDialogElement>('[data-slot="AppSettings"] dialog')
          ?.open ?? false,
    )
    .toBe(false)

  themeControl('Dark')?.click()
  expect(root.dataset.theme).toBe('dark')
  await paint()
  await sleep(300)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('U-07', 'theme')

  const trigger = button('⋯').within(role('listitem', chatTitle))
  await I.click(trigger)
  await expect.poll(() => menuLabels()).toEqual([
    'Rename',
    'Pin',
    'Export',
    'Export Markdown',
    'Copy as Markdown',
    'Delete',
  ])
  expect(menuLabels().filter((label) => label === 'Export JSON')).toEqual([])
  await paint()
  await sleep(300)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('U-07', 'row-menu')
})
