import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
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
import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { ui } from '../app/ui'
import { boot } from '../app/boot'
import {
  apiKey,
  keyStorageKey,
  refreshKeyMeta,
  sessionMode,
  writeStoredKey,
} from '../auth'
import { send, streamLifecycle } from '../chat/engine'
import { library } from '../chat/library'
import { openChat } from '../routes'
import { bootApp, unmountApp } from './boot'
import { catalogModels } from './fixtures/models'
import { freeTierKey, limitedKey, unlimitedKey } from './fixtures/keys'
import {
  installOpenRouterMock,
  mockChatStream,
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
const rajKey = 'sk-or-v1-rajlimit74'
const unlimitedPaste = 'sk-or-v1-unlimited000'
const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

let remountedUnmount: (() => void) | null = null

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-03', name)
}

const chipText = () =>
  document.querySelector('[data-slot="KeyChip"]')?.textContent ?? ''

const lowKey = { ...limitedKey, limit_remaining: 0.5 }

const paintedChunks = [
  {
    data: {
      id: 'gen-revoke',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    },
  },
  {
    data: {
      id: 'gen-revoke',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { content: 'Painted token' },
          finish_reason: null,
        },
      ],
    },
  },
]

const remountKeepingStorage = async (meta: object) => {
  unmountApp()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(catalogModels)
  mockKey(meta)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  remountedUnmount = mount(root, <App />).unmount
  await boot()
  await expect.poll(() => sessionMode()).not.toBe('booting')
}

test('Raj sees the remaining limit, changes or forgets the key, and confirms an unlimited key', async () => {
  await bootApp({ viewport: desktop })
  I.init({
    canvasElement: document.body,
    userEvent: userEvent.setup() as unknown as UserEvent,
  })

  mockKey(limitedKey)
  mockRouteDelay('/api/v1/key', 1200)
  writeStoredKey(rajKey, true)
  apiKey.set(rajKey)

  await I.see(button('Loading key limit').wait())
  await settle()
  await shoot('loading')

  mockRouteDelay('/api/v1/key', 0)
  const limitChip = button('$74.50 left')
  await I.see(limitChip.wait())
  expect(chipText()).not.toContain(rajKey)
  await settle()
  await shoot('capped')

  await I.click(limitChip)
  const menu = role('dialog', 'API key')
  await I.see(menu.wait())
  await I.see(text('sk-or-v1-au7...890').within(menu))
  await I.see(text('$100.00').within(menu))
  await I.see(text('$74.50').within(menu))
  await I.see(text('resets monthly').within(menu))
  await I.see(text('$1.20').within(menu))
  await I.see(text('$4.40').within(menu))
  await I.see(text('$25.50').within(menu))
  await I.see(text('$17.38').within(menu))
  await I.seeChecked(role('switch', /Remember on this device/).within(menu))
  await I.see(link('Manage key on OpenRouter').within(menu))
  await I.see(link('Add credits').within(menu))
  await I.see(link('BYOK settings').within(menu))
  await I.seeAttribute(
    link('Add credits'),
    'href',
    'https://openrouter.ai/credits',
  )
  await I.seeAttribute(
    link('BYOK settings'),
    'href',
    'https://openrouter.ai/settings/integrations',
  )

  await I.click(role('switch', /Remember on this device/))
  await I.dontSeeChecked(role('switch', /Remember on this device/))
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(sessionStorage.getItem(keyStorageKey)).toBe(rajKey)
  await I.click(role('switch', /Remember on this device/))
  await I.seeChecked(role('switch', /Remember on this device/))
  expect(localStorage.getItem(keyStorageKey)).toBe(rajKey)
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()

  await I.click(button('Change key').within(menu))
  const changeKey = role('dialog', 'Change key')
  await I.see(changeKey.wait())
  await I.click(button('Close').within(changeKey))
  await I.dontSee(changeKey)

  ui.appSettings.set('account')
  const settings = role('dialog', 'Settings')
  await I.see(settings.wait())
  await I.see(text('$74.50').within(settings))
  await I.see(text('resets monthly').within(settings))
  await I.see(text('sk-or-v1-au7...890').within(settings))
  ui.appSettings.set(null)
  await I.waitExit(settings)

  mockKey(lowKey)
  refreshKeyMeta({ force: true })
  const lowChip = button(/50\.00¢ left/)
  await I.see(lowChip.wait())
  await I.seeAttribute(lowChip, 'data-tone', 'warning')
  expect(
    document.querySelector('[data-slot="KeyChip"]')?.getAttribute('aria-label') ??
      '',
  ).toMatch(/low/i)
  await settle()
  await shoot('low')

  mockKey(freeTierKey)
  refreshKeyMeta({ force: true })
  await I.see(button(/0\.00¢ left/).wait())
  await I.click(button(/0\.00¢ left/))
  await I.see(menu.wait())
  await I.see(text('Free-tier key').within(menu))
  const menuCopy = document.querySelector('[data-slot="KeyMenu"]')?.textContent ?? ''
  expect(menuCopy).not.toMatch(/request/i)
  expect(menuCopy).not.toContain('50')
  expect(menuCopy).not.toContain('12')
  await settle()
  await shoot('free-tier')
  await I.press('{Escape}')
  await I.dontSee(menu)

  mockKey({ status: 502, body: { error: { code: 502, message: 'down' } } })
  refreshKeyMeta({ force: true })
  const unavailable = button('Limit unavailable')
  await I.see(unavailable.wait())
  await I.click(role('textbox', 'Message'))
  await I.press('Still here')
  await I.dontSeeDisabled(button('Send'))
  await settle()
  await shoot('unavailable')
  const message = document.querySelector('textarea')
  if (message instanceof HTMLTextAreaElement) {
    message.focus()
    await userEvent.clear(message)
  }

  mockKey(limitedKey)
  await I.click(unavailable)
  await I.see(limitChip.wait())

  await I.click(limitChip)
  await I.see(menu.wait())
  await I.click(button('Change key').within(menu))
  await I.see(changeKey.wait())
  await I.click(button('Show').within(changeKey))
  mockKey(unlimitedKey)
  const keyField = role('textbox', 'OpenRouter API key').wait()
  await I.fill(keyField, `  ${unlimitedPaste}  `)
  await I.click(button('Check and connect').within(changeKey))

  const unlimited = role('dialog', 'No spending limit')
  await I.see(unlimited.wait())
  await I.see(
    text(
      'This key has no spending limit. It can spend your whole OpenRouter balance, including auto top-ups.',
    ).within(unlimited),
  )
  await I.see(link('Set a limit on OpenRouter').within(unlimited))
  await I.see(button('I understand').within(unlimited))
  await I.dontSee(button('Close').within(unlimited))
  expect(chipText()).toContain('No limit')
  expect(chipText()).not.toMatch(/\$\d/)
  expect(document.body.textContent ?? '').not.toContain(unlimitedPaste)
  const sendButton = document.querySelector(
    'button[aria-label="Confirm the key has no limit"]',
  )
  expect(sendButton).toBeInstanceOf(HTMLButtonElement)
  expect((sendButton as HTMLButtonElement).disabled).toBe(true)
  await I.press('{Escape}')
  await I.see(unlimited)
  await settle()
  await shoot('no-limit-dialog')

  await I.click(button('I understand'))
  await I.waitExit(unlimited)
  const noLimit = button(/No limit/)
  await I.see(noLimit.wait())
  await I.seeAttribute(noLimit, 'data-tone', 'warning')
  expect(chipText()).not.toMatch(/\$\d/)
  await I.dontSee(button('Confirm the key has no limit'))
  await settle()
  await shoot('no-limit-badge')

  await expect
    .poll(() => localStorage.getItem('atelier.unlimitedAckHashes') ?? '')
    .not.toBe('')
  await remountKeepingStorage(unlimitedKey)
  await I.dontSee(text('This key has no spending limit'))
  await I.see(button(/No limit/).wait())
  await I.seeAttribute(button(/No limit/), 'data-tone', 'warning')

  await I.click(button(/No limit/))
  await I.see(menu.wait())
  await I.click(button('Forget key on this device').within(menu))
  await I.see(
    text('The key still works on OpenRouter until you delete it there.').within(
      menu,
    ),
  )
  await I.click(button('Forget key').within(menu))
  await I.see(heading('Atelier').wait())
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
  expect(requestsTo('/credits')).toHaveLength(0)

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
  openChat('chat-archive')
  await I.see(text('Connect to continue').wait())
  await I.see(heading('Lisbon notes').wait())
  await I.see(text('Keep this transcript').wait())
  await I.dontSee(heading('Atelier'))
  await I.dontSee(button(/left/))
  await settle()
  await shoot('signed-out')

  mockKey(limitedKey)
  await I.click(button('Paste a key'))
  const paste = role('dialog', 'Paste an API key')
  await I.see(paste.wait())
  await I.click(button('Show').within(paste))
  await I.fill(role('textbox', 'OpenRouter API key').wait(), rajKey)
  await I.click(button('Check and connect').within(paste))
  await I.see(limitChip.wait())

  await I.click(button('New chat').within(role('complementary', 'Chats')))
  mockChatStream({ hang: true, chunks: paintedChunks })
  void send('new', { text: 'Keep painting', attachments: [] })
  await I.see(text('Painted token').wait())
  mockKey({ status: 401, body: { error: { code: 401, message: 'revoked' } } })
  refreshKeyMeta({ force: true })
  await I.see(text('This key was revoked. This reply may not finish.').wait())
  await I.see(text('Painted token'))
  await settle()
  await shoot('revoked-stream')

  const assistant = document.querySelector('[data-role="assistant"]')
  const messageId = assistant?.getAttribute('data-message-id')
  const chatId = decodeURIComponent(location.pathname.replace(/^\/c\//, ''))
  expect(messageId).toBeTruthy()
  streamLifecycle({
    type: 'completed',
    chatId,
    messageId: messageId ?? '',
  })
  await I.see(
    text('Your key was revoked or disabled.').within(role('alert')).wait(),
  )
  await I.see(button('Reconnect'))
  await I.see(text('Painted token'))
  await I.see(text('Connect to continue'))
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
  expect(requestsTo('/credits')).toHaveLength(0)
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await settle()
  await shoot('revoked')
}, 120_000)

test.afterEach(() => {
  remountedUnmount?.()
  remountedUnmount = null
  unmountApp()
  return page.viewport(desktop.width, desktop.height)
})
