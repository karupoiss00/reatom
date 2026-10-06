import axe from 'axe-core'
import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { cdp, page } from 'vitest/browser'

import { ui } from '../app/ui'
import { unlimitedAckNeeded } from '../auth'
import { activeChat } from '../chat'
import { openChat } from '../routes'
import { curatedMiniModelId } from './fixtures/models'
import { unauthorized401 } from './fixtures/errors'
import { generationRecord } from './fixtures/generation'
import { limitedKey, unlimitedKey } from './fixtures/keys'
import { bootApp, unmountApp } from './boot'
import { mockChatStream, mockGeneration } from './openrouter-mock'
import { shot } from './screenshot'
import { contrastRatio, resolvedBackground } from '../ui'
import { unlimitedDialogOpen } from '../features/keychip/model'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const phone = { width: 390, height: 844 }
const storyKey = 'sk-or-v1-a11y-story'
const unlimitedStoryKey = 'sk-or-v1-a11y-unlimited'
const chatId = 'chat-a11y'
const modelLabel = 'OpenAI: GPT-4o-mini'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const emulateMedia = (features: Array<{ name: string; value: string }>) =>
  (
    cdp() as {
      send: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<unknown>
    }
  ).send('Emulation.setEmulatedMedia', { features })

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-24b', name)
}

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const sendButton = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="Composer"] [data-send]')

const liveRegion = () =>
  document.querySelector<HTMLElement>('[aria-live="polite"]')

const liveText = () => liveRegion()?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

const chunk = (content: string, finish: 'stop' | null = null) => ({
  id: 'gen-a11y',
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: curatedMiniModelId,
  choices: [
    {
      index: 0,
      delta: { content },
      finish_reason: finish,
    },
  ],
})

const accessibleName = (element: HTMLElement) => {
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) return text
  }
  const label = element.getAttribute('aria-label')?.trim()
  if (label) return label
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const buttonNamed = (pattern: RegExp) =>
  [...document.querySelectorAll('button')].find((element) =>
    pattern.test(accessibleName(element)),
  )

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const visibleFocusable = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => {
    if (element.closest('[hidden]')) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })

const openDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]')

const trackLive = () => {
  const heard: string[] = []
  const region = liveRegion()
  if (!region) throw new Error('missing live region')
  const read = () => region.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const push = () => {
    const text = read()
    if (text && heard.at(-1) !== text) heard.push(text)
  }
  push()
  const observer = new MutationObserver(push)
  observer.observe(region, { subtree: true, childList: true, characterData: true })
  return {
    heard: () => [...heard],
    stop: () => observer.disconnect(),
  }
}

const assertTrap = async (dialog: HTMLDialogElement) => {
  expect(dialog.contains(document.activeElement)).toBe(true)
  const items = visibleFocusable(dialog)
  expect(items.length).toBeGreaterThan(0)
  const steps = Math.min(items.length + 2, 12)
  for (let step = 0; step < steps; step += 1) {
    await keyboard.keyboard('{Tab}')
    expect(dialog.contains(document.activeElement)).toBe(true)
  }
  await keyboard.keyboard('{Shift>}{Tab}{/Shift}')
  expect(dialog.contains(document.activeElement)).toBe(true)
}

const closeOpenDialog = async () => {
  const dialog = openDialog()
  const close = dialog?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
  if (!close) throw new Error('missing close button')
  await keyboard.click(close)
  await expect.poll(() => openDialog()).toBeNull()
}

const withOpener = async (open: () => void) => {
  const opener = buttonNamed(/^New chat$/)
  if (!opener) throw new Error('missing New chat')
  opener.focus()
  open()
  await expect.poll(() => openDialog()).toBeTruthy()
  const dialog = openDialog()!
  await assertTrap(dialog)
  await closeOpenDialog()
  expect(document.activeElement).toBe(opener)
}

const axeSerious = async (screen: string) => {
  const results = await axe.run(document.body, { resultTypes: ['violations'] })
  return results.violations.flatMap((violation) => {
    if (violation.impact !== 'serious' && violation.impact !== 'critical') return []
    return violation.nodes.map((node) => ({
      screen,
      id: violation.id,
      impact: violation.impact,
      target: Array.isArray(node.target) ? node.target.join(' ') : String(node.target),
      html: node.html.slice(0, 220),
    }))
  })
}

const placed = (element: Element | null | undefined, label: string) => {
  if (!element) return { label, missing: true, usable: false }
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const hit = document.elementFromPoint(centerX, centerY)
  const reachable = hit === element || element.contains(hit) || Boolean(hit?.contains(element))
  const usable =
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    rect.width >= 32 &&
    rect.height >= 32 &&
    rect.left >= -1 &&
    rect.top >= -1 &&
    rect.right <= window.innerWidth + 1 &&
    rect.bottom <= window.innerHeight + 1 &&
    reachable
  return {
    label,
    usable,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
  }
}

const expectUsable = (
  controls: Array<Element | null | undefined>,
  labels: string[],
) => {
  const report = controls.map((element, index) => placed(element, labels[index] ?? 'control'))
  expect(report.filter((item) => !item.usable)).toEqual([])
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth + 1)
}

const motionClear = () => {
  const offenders: string[] = []
  for (const element of document.querySelectorAll('*')) {
    for (const pseudo of [undefined, '::before', '::after'] as const) {
      const style = getComputedStyle(element, pseudo)
      const name = style.animationName
      if (name !== 'none') {
        offenders.push(`${element.tagName} ${pseudo ?? ''} animation ${name}`)
      }
      if (pseudo === undefined && style.scrollBehavior !== 'auto') {
        offenders.push(`${element.tagName} scroll ${style.scrollBehavior}`)
      }
    }
  }
  return offenders.slice(0, 8)
}

const seed = [
  {
    id: chatId,
    title: 'Focus rings',
    model: curatedMiniModelId,
    messages: [
      { id: 'a11y-user', role: 'user' as const, content: 'What is a focus ring?' },
      {
        id: 'a11y-assistant',
        role: 'assistant' as const,
        content: 'A short reply worth keeping.',
        parentId: 'a11y-user',
      },
    ],
  },
]

afterEach(async () => {
  unmountApp()
  await emulateMedia([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ])
  await page.viewport(desktop.width, desktop.height)
})

test('Ana hears status, keeps focus, and uses the phone layout', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    seed,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  mockGeneration({ ...generationRecord, id: 'gen-a11y' })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  openChat(chatId)
  await I.see(text('A short reply worth keeping.').wait())
  await expect.poll(() => field()?.getAttribute('aria-label') ?? '').toBe('Message')

  expect(buttonNamed(/^Send$/)).toBeTruthy()
  expect(buttonNamed(/^Copy/)).toBeTruthy()
  expect(buttonNamed(/^Regenerate$/)).toBeTruthy()
  expect(buttonNamed(/^Edit$/)).toBeTruthy()
  expect(buttonNamed(/^Previous version$/)).toBeTruthy()
  expect(buttonNamed(/^Next version$/)).toBeTruthy()
  expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)

  const announcements = trackLive()
  mockChatStream({
    firstTokenDelayMs: 700,
    chunks: [
      { delayMs: 40, data: chunk('Hello ') },
      { data: chunk('', 'stop') },
    ],
  })
  setDraft('Tell me something short')
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
  await expect
    .poll(() => liveText(), { timeout: 4_000 })
    .toBe('Generating reply')
  const streaming = document.querySelector('[data-slot="AssistantMessage"]')
  expect(streaming?.getAttribute('aria-live')).toBeNull()
  expect(streaming?.querySelector('[aria-live]')).toBeNull()
  expect(streaming?.closest('[aria-live]')).toBeNull()
  await expect.poll(() => liveText(), { timeout: 6_000 }).toBe('Reply complete')
  expect(buttonNamed(/^Stop$/)).toBeFalsy()

  mockChatStream({
    firstTokenDelayMs: 200,
    hang: true,
    chunks: [{ delayMs: 40, data: chunk('PARTIAL-TOKEN') }],
  })
  setDraft('Keep going')
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
  await expect.poll(() => sendButton()?.getAttribute('data-mode') ?? '').toBe('stop')
  expect(accessibleName(sendButton()!)).toBe('Stop')
  await expect
    .poll(() =>
      [...document.querySelectorAll('[data-slot="AssistantMessage"]')].at(-1)?.textContent ?? '',
    )
    .toContain('PARTIAL-TOKEN')
  await I.click(button('Stop'))
  await expect.poll(() => liveText(), { timeout: 4_000 }).toBe('Stopped')

  const allowedBeforeError = new Set(['Generating reply', 'Reply complete', 'Stopped'])
  expect(announcements.heard().filter((item) => !allowedBeforeError.has(item))).toEqual([])

  setDraft('Look at this ring')
  const composer = field()
  if (!composer) throw new Error('missing composer')
  composer.focus()
  const card = document.querySelector<HTMLElement>('[data-composer-card]')
  if (!card) throw new Error('missing composer card')
  const focusStyle = getComputedStyle(card)
  expect(getComputedStyle(composer).outlineStyle).toBe('none')
  expect(focusStyle.outlineWidth).toBe('2px')
  expect(focusStyle.outlineStyle).toBe('solid')
  expect(
    contrastRatio(
      focusStyle.outlineColor,
      resolvedBackground(card.parentElement ?? card),
    ),
  ).toBeGreaterThanOrEqual(4.5)
  await settle()
  await shoot('focus-rings')

  await emulateMedia([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ])
  await settle()
  expect(motionClear()).toEqual([])
  expect(getComputedStyle(document.documentElement).scrollBehavior).toBe('auto')
  await shoot('reduced-motion')
  await emulateMedia([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ])

  const violations = [
    ...(await axeSerious('thread')),
  ]

  const chip = document.querySelector<HTMLButtonElement>('[data-slot="ModelChip"]')
  if (!chip) throw new Error('missing model chip')
  chip.focus()
  await keyboard.click(chip)
  await expect.poll(() => openDialog()?.textContent ?? '').toContain('Choose a model')
  violations.push(...(await axeSerious('picker')))
  await page.viewport(phone.width, phone.height)
  await settle()
  expectUsable(
    [
      openDialog()?.querySelector('input') ?? null,
      openDialog()?.querySelector('button[aria-label="Close"]') ?? null,
    ],
    ['model search', 'close picker'],
  )
  await page.viewport(desktop.width, desktop.height)
  await settle()
  await assertTrap(openDialog()!)
  await closeOpenDialog()
  expect(document.activeElement).toBe(chip)

  await withOpener(() => ui.search.set(true))
  await withOpener(() => ui.shortcuts.set(true))
  const settingsOpener = chip
  settingsOpener.focus()
  ui.appSettings.set('appearance')
  await expect.poll(() => openDialog()?.textContent ?? '').toContain('Settings')
  violations.push(...(await axeSerious('settings')))
  await page.viewport(phone.width, phone.height)
  await settle()
  expectUsable(
    [
      openDialog()?.querySelector('button[aria-label="Close"]') ?? null,
      openDialog()?.querySelector('[role="tab"]') ?? null,
    ],
    ['close settings', 'settings tab'],
  )
  await page.viewport(desktop.width, desktop.height)
  await settle()
  await assertTrap(openDialog()!)
  await closeOpenDialog()
  expect(document.activeElement).toBe(settingsOpener)

  await page.viewport(phone.width, phone.height)
  await settle()
  expectUsable(
    [
      field(),
      sendButton(),
      document.querySelector('[data-testid="drawer-menu"]'),
    ],
    ['composer', 'send', 'open sidebar'],
  )
  await page.viewport(390, 800)
  await settle()
  await shoot('phone')
  await page.viewport(desktop.width, desktop.height)
  await settle()

  mockChatStream(unauthorized401)
  setDraft('This should fail')
  await expect.poll(() => sendButton()?.disabled ?? true).toBe(false)
  sendButton()?.click()
  await expect
    .poll(() => document.querySelector('[data-error-title]')?.textContent?.trim() ?? '', {
      timeout: 6_000,
    })
    .toBe('Your OpenRouter key was rejected.')
  const errorTitle =
    document.querySelector('[data-error-title]')?.textContent?.trim() ?? ''
  await expect.poll(() => liveText()).toBe(errorTitle)
  const allowed = new Set([
    'Generating reply',
    'Reply complete',
    'Stopped',
    errorTitle,
  ])
  expect(announcements.heard().filter((item) => !allowed.has(item))).toEqual([])
  expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
  violations.push(...(await axeSerious('error-card')))
  await page.viewport(phone.width, phone.height)
  await settle()
  document.querySelector('[data-slot="ErrorCard"] button')?.scrollIntoView({ block: 'center' })
  await settle()
  expectUsable(
    [document.querySelector('[data-slot="ErrorCard"] button')],
    ['error action'],
  )
  await page.viewport(desktop.width, desktop.height)
  announcements.stop()

  resetLocation()
  await bootApp({ viewport: desktop })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => document.querySelector('[data-slot="Welcome"]')).toBeTruthy()
  violations.push(...(await axeSerious('welcome')))
  await page.viewport(phone.width, phone.height)
  await settle()
  expectUsable(
    [
      document.querySelector('[aria-label="Spending limit"]'),
      buttonNamed(/Connect/),
    ],
    ['spending limit', 'connect'],
  )
  await page.viewport(desktop.width, desktop.height)

  resetLocation()
  await bootApp({
    seed: [{ id: 'chat-saved', title: 'Saved chat', model: curatedMiniModelId }],
    viewport: desktop,
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await I.see(text('Connect to continue').wait())
  violations.push(...(await axeSerious('archive')))
  await page.viewport(phone.width, phone.height)
  await settle()
  expectUsable(
    [
      buttonNamed(/^Connect with OpenRouter$/),
      buttonNamed(/^Paste a key$/),
      document.querySelector('[data-testid="drawer-menu"]'),
    ],
    ['connect', 'paste a key', 'open sidebar'],
  )

  resetLocation()
  await bootApp({
    key: unlimitedStoryKey,
    keyMeta: unlimitedKey,
    viewport: desktop,
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => unlimitedAckNeeded(), { timeout: 6_000 }).toBe(true)
  await expect.poll(() => openDialog()?.textContent ?? '').toContain('No spending limit')
  await assertTrap(openDialog()!)
  unlimitedDialogOpen.set(false)
  await expect.poll(() => openDialog()).toBeNull()
  const unlimitedOpener = buttonNamed(/^New chat$/)
  if (!unlimitedOpener) throw new Error('missing New chat')
  unlimitedOpener.focus()
  unlimitedDialogOpen.set(true)
  await expect.poll(() => openDialog()?.textContent ?? '').toContain('No spending limit')
  await assertTrap(openDialog()!)
  unlimitedDialogOpen.set(false)
  await expect.poll(() => openDialog()).toBeNull()
  expect(document.activeElement).toBe(unlimitedOpener)

  expect(violations).toEqual([])
}, 90_000)
