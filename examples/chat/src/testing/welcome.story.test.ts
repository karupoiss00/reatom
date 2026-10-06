import { expect, test } from 'vitest'
import { page } from 'vitest/browser'
import {
  button,
  createActor,
  heading,
  link,
  role,
  text,
  type UserEvent,
} from 'kahraman'
import { userEvent } from 'storybook/test'

import { apiKey, completeOAuthFromUrl, forgetKey, readStoredKey, startOAuth } from '../auth'
import { busyCountdown, leaveOAuthError } from '../features/welcome/model'
import { library } from '../chat/library'
import { openChat } from '../routes'
import { bootApp, unmountApp } from './boot'
import { exchangedKey } from './fixtures/auth'
import { limitedKey } from './fixtures/keys'
import { captureExternalNavigation } from './navigation'
import {
  mockAuthExchange,
  mockKey,
  mockRouteDelay,
  requestsTo,
} from './openrouter-mock'
import { shot } from './screenshot'
import { seedChats } from './seed'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const pastedKey = 'sk-or-v1-au7works890'
const rejectedKey = 'sk-or-v1-bad'

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const watchCountdown = () => {
  const ids = new Set<number>()
  const originalSet = globalThis.setInterval
  const originalClear = globalThis.clearInterval
  globalThis.setInterval = ((handler, timeout, ...args) => {
    const id = originalSet(handler, timeout, ...args)
    if (timeout === 1000) ids.add(Number(id))
    return id
  }) as typeof globalThis.setInterval
  globalThis.clearInterval = ((id?: number) => {
    if (id !== undefined) ids.delete(Number(id))
    return originalClear(id)
  }) as typeof globalThis.clearInterval
  return {
    ids,
    restore() {
      globalThis.setInterval = originalSet
      globalThis.clearInterval = originalClear
    },
  }
}

const expectKeyUnstored = () => {
  expect(apiKey()).toBeNull()
  expect(readStoredKey()).toBeNull()
}

const shoot = async (flowId: string, name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot(flowId, name)
}

const callbackFromPending = () => {
  const raw = sessionStorage.getItem('atelier.oauth')
  if (!raw) throw new Error('missing pending oauth')
  const pending = JSON.parse(raw) as { state?: string }
  if (!pending.state) throw new Error('missing oauth state')
  const url = new URL(location.origin)
  url.searchParams.set('code', 'auth-code')
  url.searchParams.set('state', pending.state)
  return url
}

test('Tom connects, Maya pastes a key, and a saved chat stays read-only without one', async () => {
  await bootApp({ viewport: desktop })
  I.init({
    canvasElement: document.body,
    userEvent: userEvent.setup() as unknown as UserEvent,
  })
  const urls = captureExternalNavigation()
  const limit = role('textbox', 'Spending limit')
  const remember = role('checkbox', /Remember on this device/)

  await I.see(heading('Atelier'))
  await I.seeChecked(remember)
  await I.seeInField(limit, '10')
  await I.see(
    text(
      'Your key stays in this browser. Anyone with access to this browser profile or a malicious extension could use it.',
    ),
  )
  await I.dontSeeDisabled(button('Connect with a $10 limit'))
  await settle()
  await shoot('F-01', 'welcome')

  await I.fill(limit, '25')
  await I.see(button('Connect with a $25 limit'))
  await settle()
  await shoot('F-01', 'limit-set')

  await I.clear(limit)
  await I.see(
    role('checkbox', /I understand this key can spend my whole balance/),
  )
  await I.seeDisabled(button('Connect with no limit'))
  await I.click(heading('Atelier'))
  await settle()
  await shoot('F-01', 'no-limit')

  const unlimited = role(
    'checkbox',
    /I understand this key can spend my whole balance/,
  )
  await I.click(unlimited)
  await I.dontSeeDisabled(button('Connect with no limit'))
  await I.click(button('Connect with no limit'))
  await expect.poll(() => urls.length).toBe(1)
  expect(new URL(urls[0]!).searchParams.has('limit')).toBe(false)
  leaveOAuthError()

  await I.fill(limit, '0')
  await I.see(
    text('Enter a limit above 0, or clear the field for no limit.'),
  )
  await I.seeDisabled(button('Connect with OpenRouter'))
  expect(urls).toHaveLength(1)

  await I.fill(limit, '10')
  await I.click(button('Connect with a $10 limit'))
  await expect.poll(() => urls.length).toBe(2)
  const authUrl = new URL(urls[1]!)
  expect(authUrl.hostname).toBe('openrouter.ai')
  expect(authUrl.pathname).toBe('/auth')
  expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authUrl.searchParams.get('code_challenge')).toBeTruthy()
  expect(authUrl.searchParams.get('callback_url')).toBe(location.origin)
  expect(authUrl.searchParams.get('state')).toBeTruthy()
  expect(authUrl.searchParams.get('limit')).toBe('10')
  expect(location.hostname).not.toBe('openrouter.ai')
  await I.seeAttribute(button('Connect with a $10 limit'), 'aria-busy', 'true')
  await settle()
  await shoot('F-01', 'redirecting')

  mockAuthExchange({
    status: 400,
    body: { error: { code: 400, message: 'bad code' } },
  })
  mockRouteDelay('/api/v1/auth/keys', 500)
  const failedExchange = completeOAuthFromUrl(callbackFromPending())
  await I.see(heading('Connecting to OpenRouter…').wait())
  await settle()
  await shoot('F-01', 'connecting')
  await failedExchange
  await I.see(heading("OpenRouter couldn't create a key").wait())
  await I.see(
    text('Nothing was changed. Try again, or paste a key you already have.'),
  )
  await I.see(button('Try again'))
  await I.see(button('Paste a key instead'))
  await settle()
  await shoot('F-01', 'error')

  await I.click(button('Paste a key instead'))
  const pasteDialog = role('dialog', 'Paste an API key')
  await I.see(pasteDialog.wait())
  await I.see(link('Create a key at openrouter.ai/keys').within(pasteDialog))
  await I.seeChecked(role('checkbox', /Remember on this device/).within(pasteDialog))
  await I.seeDisabled(button('Check and connect').within(pasteDialog))
  await settle()
  await shoot('F-02', 'empty')

  await I.click(button('Show').within(pasteDialog))
  const keyField = role('textbox', 'OpenRouter API key').wait()
  await I.fill(keyField, 'maya-key')
  await I.see(text('OpenRouter keys usually start with sk-or-'))
  await I.dontSeeDisabled(button('Check and connect'))
  await settle()
  await shoot('F-02', 'typing')

  await I.fill(keyField, rejectedKey)
  mockKey({ status: 401 })
  mockRouteDelay('/api/v1/key', 500)
  await I.click(button('Check and connect'))
  await I.see(button('Checking…').wait())
  await settle()
  await shoot('F-02', 'checking')
  await I.see(
    text(
      "OpenRouter didn't accept this key. It may be mistyped, disabled, or deleted.",
    ).wait(),
  )
  await I.see(link('Manage keys'))
  await I.seeInField(keyField, rejectedKey)
  await I.see(pasteDialog)
  expect(document.querySelector('[data-slot="Welcome"]')).toBeInstanceOf(
    HTMLElement,
  )
  await I.dontSee(role('textbox', 'Message'))
  expect(requestsTo('/chat/completions')).toHaveLength(0)
  expect(
    requestsTo('/key').some(
      (request) => request.headers.authorization === `Bearer ${rejectedKey}`,
    ),
  ).toBe(true)
  expectKeyUnstored()
  await settle()
  await shoot('F-02', 'invalid')

  const managementKey = 'sk-or-v1-management'
  mockKey({ ...limitedKey, is_management_key: true })
  mockRouteDelay('/api/v1/key', 0)
  await I.fill(keyField, managementKey)
  await I.click(button('Check and connect'))
  await I.see(
    text(
      'This is a management key. For safety, create a regular API key and paste that instead.',
    ).wait(),
  )
  expectKeyUnstored()
  await I.see(pasteDialog)

  const countdown = watchCountdown()
  try {
    mockKey({
      status: 429,
      headers: { 'retry-after': '12' },
      body: { error: { code: 429, message: 'slow' } },
    })
    await I.fill(keyField, 'sk-or-v1-busy')
    await I.click(button('Check and connect'))
    await I.see(
      text('OpenRouter is busy (code 429). Try again in a moment. 12s').wait(),
    )
    expect(countdown.ids.size).toBeGreaterThan(0)
    await I.click(button('Close').within(pasteDialog))
    expect(countdown.ids.size).toBe(0)
    expect(busyCountdown()).toBeNull()
  } finally {
    countdown.restore()
  }
  await I.dontSee(pasteDialog)
  await I.click(button('Paste an API key'))
  await I.see(pasteDialog.wait())

  mockKey(limitedKey)
  mockRouteDelay('/api/v1/key', 0)
  const reopenedKey = role('textbox', 'OpenRouter API key').wait()
  await I.fill(reopenedKey, `  ${pastedKey}  `)
  await I.click(button('Check and connect'))
  await I.see(role('textbox', 'Message').wait())
  await I.dontSee(heading('Atelier'))
  expect(document.body.textContent ?? '').not.toContain(pastedKey)
  await settle()
  await shoot('F-02', 'connected')

  forgetKey()
  await I.see(heading('Atelier').wait())
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  mockRouteDelay('/api/v1/auth/keys', 0)
  await I.click(button('Connect with a $10 limit'))
  await expect.poll(() => urls.length).toBe(3)
  expect(new URL(urls[2]!).searchParams.get('limit')).toBe('10')
  const connected = completeOAuthFromUrl(callbackFromPending())
  await I.see(text('What should we think about?').wait())
  await connected
  expect(document.body.textContent ?? '').not.toContain('sk-or-v1-exchanged')
  await settle()
  await shoot('F-01', 'connected')

  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  mockRouteDelay('/api/v1/auth/keys', 600)
  void startOAuth({ limit: 10, remember: true, returnTo: null })
  await expect.poll(() => urls.length).toBe(4)
  const reconnecting = completeOAuthFromUrl(callbackFromPending())
  await I.see(heading('Reconnecting to OpenRouter…').wait())
  await settle()
  await shoot('F-01', 'reconnect')
  await reconnecting

  mockAuthExchange({
    status: 400,
    body: { error: { code: 400, message: 'bad code' } },
  })
  mockRouteDelay('/api/v1/auth/keys', 0)
  void startOAuth({ limit: 10, remember: true, returnTo: null })
  await expect.poll(() => urls.length).toBe(5)
  const failedReconnect = completeOAuthFromUrl(callbackFromPending())
  await I.see(heading("OpenRouter couldn't create a key").wait())
  await failedReconnect
  expect(apiKey()).toBe('sk-or-v1-exchanged')
  expect(readStoredKey()?.key).toBe('sk-or-v1-exchanged')
  await I.click(button('Paste a key instead'))
  const reconnectPaste = role('dialog', 'Paste an API key')
  await I.see(reconnectPaste.wait())
  expect(document.querySelector('[data-slot="ChatScreen"]')).toBeInstanceOf(
    HTMLElement,
  )
  expect(document.querySelector('[data-slot="OAuthCallback"]')).toBeNull()
  await I.click(button('Close').within(reconnectPaste))
  await I.dontSee(reconnectPaste)

  await seedChats([
    {
      id: 'chat-archive',
      title: 'Lisbon notes',
      messages: [
        { role: 'user', content: 'Keep this transcript' },
        { role: 'assistant', content: 'Saved locally.' },
      ],
    },
  ])
  await library.reload()
  forgetKey()
  openChat('chat-archive')
  await I.see(text('Connect to continue').wait())
  await I.see(heading('Lisbon notes').wait())
  await I.see(text('Keep this transcript').wait())
  await I.see(text('Saved locally.'))
  await I.see(button('Connect with OpenRouter'))
  await I.see(button('Paste a key'))
  await I.dontSee(role('textbox', 'Message'))
  await I.dontSee(heading('Atelier'))
  await I.dontSee(button('Send'))
  expect(document.querySelector('[data-slot="Welcome"]')).toBeNull()
  expect(document.querySelector('[data-slot="ConnectBar"]')).toBeInstanceOf(
    HTMLElement,
  )
  expect(document.querySelector('vite-error-overlay')).toBeNull()
}, 90_000)

test.afterEach(() => {
  unmountApp()
  return page.viewport(desktop.width, desktop.height)
})
