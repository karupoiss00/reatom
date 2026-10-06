import { addCallHook, context, notify } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { afterEach, expect, test } from 'vitest'
import { cdp, page } from 'vitest/browser'

import {
  MissingApiKeyError,
  openRouter,
  openRouterPublic,
} from './api/openrouter'
import { App } from './App'
import { boot } from './app/boot'
import { commands } from './app/commands'
import { ui } from './app/ui'
import { activeChat } from './chat/chatModel'
import { stop } from './chat/engine'
import { localStreams, startingNewChatId } from './chat/streams'
import { activeChatId, homeRoute } from './routes'
import { registerOpenLayer } from './ui'
import { keyStorageKey } from './auth/keyStore'
import { sessionMode } from './auth/session'
import { resetRuntime } from './platform/runtime'
import { initStorage, repo, resetRepoBackend } from './storage'
import { createChatRecord } from './storage/records'
import { openRouterRequests } from './testing/openrouter-mock'
import { shot } from './testing/screenshot'

const seededKey = 'sk-or-v1-test-session-key'

let unmountApp: (() => void) | null = null

const paint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })

const emulateScheme = (scheme: 'light' | 'dark') =>
  (
    cdp() as {
      send: (method: string, params?: Record<string, unknown>) => Promise<void>
    }
  ).send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  })

const mountApp = () => {
  context.reset()
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)
  unmountApp = mount(root, <App />).unmount
}

const startApp = async () => {
  mountApp()
  await boot()
  await expect.poll(() => sessionMode()).not.toBe('booting')
  await paint()
}

const slot = (name: string) =>
  document.querySelector<HTMLElement>(`[data-slot="${name}"]`)

const settingsDialog = (slotName: string, title: string) => {
  const dialog = slot(slotName)?.querySelector('dialog') ?? null
  const titleId = dialog?.getAttribute('aria-labelledby')
  const titleText = titleId
    ? document.getElementById(titleId)?.textContent
    : null
  expect(titleText).toBe(title)
  return dialog
}

afterEach(() => {
  unmountApp?.()
  unmountApp = null
  resetRuntime()
  resetRepoBackend()
  localStorage.clear()
  sessionStorage.clear()
})

test('public OpenRouter client never sends Authorization; the keyed client refuses without a key', async () => {
  await openRouterPublic().models.list()
  const modelRequests = openRouterRequests().filter((request) =>
    request.url.includes('/models'),
  )
  expect(modelRequests).toHaveLength(1)
  expect(modelRequests[0]!.headers).not.toHaveProperty('authorization')

  await expect(
    openRouter().generations.getGeneration({ id: 'gen-missing-key' }),
  ).rejects.toBeInstanceOf(MissingApiKeyError)
  expect(
    openRouterRequests().filter((request) =>
      request.url.includes('/generation'),
    ),
  ).toHaveLength(0)
})

test('shows the welcome slot when no key is stored', async () => {
  localStorage.clear()
  sessionStorage.clear()

  await startApp()

  expect(sessionMode()).toBe('welcome')
  expect(slot('Shell')).toBeInstanceOf(HTMLElement)
  expect(slot('Welcome')).toBeInstanceOf(HTMLElement)
  expect(slot('ChatScreen')).toBeNull()
})

test('shows the chat slot when a key is seeded in sessionStorage', async () => {
  sessionStorage.setItem(keyStorageKey, seededKey)

  await startApp()

  expect(sessionMode()).toBe('connected')
  expect(slot('Shell')).toBeInstanceOf(HTMLElement)
  expect(slot('Sidebar')).toBeInstanceOf(HTMLElement)
  expect(slot('ChatScreen')).toBeInstanceOf(HTMLElement)
  expect(slot('Welcome')).toBeNull()
  expect(document.body.textContent).not.toContain(seededKey)
})

test('R-1: without a key, saved chats open as an archive and Welcome never shows', async () => {
  context.reset()
  await initStorage()
  await repo.createChat(
    createChatRecord({ id: 'chat-archived', at: Date.now(), title: 'Saved' }),
  )

  let welcomeEverShown = false
  const watchWelcome = new MutationObserver(() => {
    if (slot('Welcome')) welcomeEverShown = true
  })
  watchWelcome.observe(document.body, { childList: true, subtree: true })
  try {
    mountApp()
    if (slot('Welcome')) welcomeEverShown = true
    await boot()
    await expect.poll(() => sessionMode()).toBe('archive')
    await paint()
  } finally {
    watchWelcome.disconnect()
  }

  expect(slot('ConnectBar')).toBeInstanceOf(HTMLElement)
  expect(slot('Composer')).toBeNull()
  expect(slot('Welcome')).toBeNull()
  expect(welcomeEverShown).toBe(false)
})

test('mounts the global layers once', async () => {
  await startApp()

  for (const name of [
    'AppSettings',
    'ModelPicker',
    'SearchDialog',
    'ShortcutsDialog',
    'UnlimitedKeyDialog',
  ]) {
    expect(document.querySelectorAll(`[data-slot="${name}"]`)).toHaveLength(1)
  }
  expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
})

test('app settings is a tabbed dialog whose sections are slots', async () => {
  await startApp()

  ui.appSettings.set('appearance')
  await paint()

  const dialog = settingsDialog('AppSettings', 'Settings')
  expect(dialog?.open).toBe(true)
  const tabs = [...dialog!.querySelectorAll('[role="tab"]')]
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Account & usage',
    'Appearance',
    'Data',
    'Privacy',
    'Keyboard',
  ])
  expect(
    dialog!.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
  ).toBe('Appearance')
  expect(slot('AppearanceSection')).toBeInstanceOf(HTMLElement)
  ;(tabs[2] as HTMLButtonElement).click()
  await paint()
  expect(ui.appSettings()).toBe('data')
  expect(slot('DataSection')).toBeInstanceOf(HTMLElement)
  expect(slot('AppearanceSection')).toBeNull()

  dialog!.close()
  await paint()
  expect(ui.appSettings()).toBeNull()
})

test('chat settings is a tabbed dialog for the active chat', async () => {
  sessionStorage.setItem(keyStorageKey, seededKey)
  await startApp()

  ui.chatSettings.set('prompt')
  await paint()

  const dialog = settingsDialog('ChatSettings', 'Chat settings')
  expect(dialog?.open).toBe(true)
  expect(
    [...dialog!.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent),
  ).toEqual(['System prompt', 'Advanced', 'Privacy', 'Routing'])
  expect(slot('PromptSection')).toBeInstanceOf(HTMLElement)
})

test('shell screenshots in light and dark', async () => {
  sessionStorage.setItem(keyStorageKey, seededKey)
  await page.viewport(1280, 800)
  await startApp()

  await emulateScheme('light')
  await paint()
  await shot('T-002', 'shell-light')

  await emulateScheme('dark')
  await paint()
  await shot('T-002', 'shell-dark')

  await emulateScheme('light')
})

test("while the route chat id is 'new' and that model is streaming, escape calls stop('new') when openLayerCount is 0 and does not call stop when a layer is open", () => {
  homeRoute.go()
  const startingId = 'chat-accepted'
  const controller = new AbortController()
  startingNewChatId.set(startingId)
  localStreams.set(
    new Map([
      [
        startingId,
        {
          messageId: 'msg-accepted',
          controller,
          stopRequested: false,
        },
      ],
    ]),
  )
  expect(activeChatId()).toBe('new')
  expect(activeChat().id).toBe('new')
  expect(activeChat().streaming()).toEqual({
    messageId: 'msg-accepted',
    local: true,
  })

  const stopped: string[] = []
  const releaseHook = addCallHook(stop, (_result, params) => {
    stopped.push(params[0])
  })
  try {
    expect(ui.openLayerCount()).toBe(0)
    commands.escape()
    notify()
    expect(stopped).toEqual(['new'])

    stopped.length = 0
    const releaseLayer = registerOpenLayer()
    try {
      expect(ui.openLayerCount()).toBe(1)
      commands.escape()
      notify()
      expect(stopped).toEqual([])
    } finally {
      releaseLayer()
    }
  } finally {
    releaseHook()
  }
})
