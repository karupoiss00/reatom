import { addCallHook, type Computed } from '@reatom/core'
import { mount } from '@reatom/jsx'

import { App } from '../../App'
import { boot } from '../../app/boot'
import { writeStoredKey } from '../../auth/keyStore'
import { sessionMode } from '../../auth/session'
import { getChatModel } from '../../chat/chatModel'
import { send, stop } from '../../chat/engine'
import { deleteChats, libraryRecords, renameChat } from '../../chat/library'
import { connectMcp, mcpReady } from '../../mcp'
import { mcpAlwaysAllow, mcpBusy } from '../../mcp/busy'
import { tabId } from '../../platform/env'
import { openChat } from '../../routes'
import { syncReceived } from '../../sync/bus'
import { acquireStreamLock, streamHeldElsewhere } from '../../sync/locks'
import type { StreamLock } from '../../sync/types'
import { fusionMcpUrl } from '../fixtures/mcp'
import { catalogModels } from '../fixtures/models'
import {
  installMcpMock,
  mcpExecuteCalls,
  mcpMethods,
  simulateMcpCallDelay,
} from '../mcp-mock'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStreams,
  mockKey,
  mockModels,
} from '../openrouter-mock'
import {
  harnessTag,
  type TabCommand,
  type TabMessage,
  type TabRequest,
  type TabResults,
  type TabState,
} from './protocol'

const bootWaitMs = 10_000

installOpenRouterMock()
installMcpMock()

const received: string[] = []
addCallHook(syncReceived, (event) => {
  received.push(event.type)
})

const heldLocks = new Map<string, StreamLock>()
const watchedHolds = new Map<string, Computed<boolean>>()

const waitUntilBooted = async () => {
  const deadline = performance.now() + bootWaitMs
  while (sessionMode() === 'booting') {
    if (performance.now() > deadline) throw new Error('The second tab did not finish booting')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const mcpChipLabel = () =>
  document.querySelector('[data-mcp-toggle]')?.textContent?.trim() ?? null

const mcpToolCardText = () =>
  document.querySelector('[data-mcp-tool-card]')?.textContent ?? null

const mcpAllowButton = () =>
  [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Allow once',
  ) ?? null

const readState = (): TabState => ({
  tabId,
  path: location.pathname,
  sessionMode: sessionMode(),
  chats: libraryRecords().map((chat) => ({
    id: chat.id,
    title: chat.title,
    deletedAt: chat.deletedAt,
  })),
  chatRequests: chatBodies().length,
  received: [...received],
  mcpReady: mcpReady(),
  mcpBusy: mcpBusy(),
  mcpChip: mcpChipLabel(),
  mcpAlways: [...mcpAlwaysAllow()],
  mcpExecutes: mcpExecuteCalls().length,
  mcpToolCalls: mcpMethods().filter((method) => method === 'tools/call').length,
  mcpToolCard: mcpToolCardText(),
  mcpAllowDisabled: mcpAllowButton()?.disabled ?? null,
})

const watchHeldElsewhere = (chatId: string) => {
  let held = watchedHolds.get(chatId)
  if (!held) {
    held = streamHeldElsewhere(chatId)
    held.subscribe(() => {})
    watchedHolds.set(chatId, held)
  }
  return held
}

type Handlers = {
  [Type in TabCommand['type']]: (
    command: Extract<TabCommand, { type: Type }>,
  ) => TabResults[Type] | Promise<TabResults[Type]>
}

const handlers: Handlers = {
  async boot(command) {
    mockModels(command.models ?? catalogModels)
    if (command.keyMeta !== undefined) mockKey(command.keyMeta)
    if (command.key) writeStoredKey(command.key, command.remember === true)
    const root = document.getElementById('app')!
    mount(root, <App />)
    await boot()
    await waitUntilBooted()
    return { tabId }
  },
  'mock-streams'(command) {
    mockChatStreams(command.scripts)
    return null
  },
  open(command) {
    openChat(command.chatId)
    return null
  },
  send(command) {
    send(command.chatId, { text: command.text, attachments: [] }).catch(
      (error: unknown) => console.warn('Second tab send failed', error),
    )
    return null
  },
  stop(command) {
    stop(command.chatId)
    return null
  },
  rename(command) {
    renameChat(command.chatId, command.title)
    return null
  },
  delete(command) {
    deleteChats(command.chatIds)
    return null
  },
  read(command) {
    return document.querySelector(command.selector)?.textContent ?? null
  },
  state: readState,
  async 'acquire-lock'(command) {
    const lock = await acquireStreamLock(command.chatId)
    if (lock) heldLocks.set(command.chatId, lock)
    return lock !== null
  },
  'release-lock'(command) {
    heldLocks.get(command.chatId)?.release()
    heldLocks.delete(command.chatId)
    return null
  },
  'held-elsewhere'(command) {
    return watchHeldElsewhere(command.chatId)()
  },
  async 'connect-mcp'(command) {
    await connectMcp(command.url ?? fusionMcpUrl)
    return { ready: mcpReady() }
  },
  'mcp-delay'(command) {
    simulateMcpCallDelay(command.delayMs)
    return null
  },
  'enable-mcp'(command) {
    getChatModel(command.chatId).updateSettings({ mcpEnabled: true })
    return null
  },
  click(command) {
    const match = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === command.text,
    )
    if (!match) throw new Error(`Second tab has no button "${command.text}"`)
    match.click()
    return null
  },
}

const reply = (message: TabMessage) => {
  window.parent.postMessage(message, location.origin)
}

const run = async (command: TabCommand): Promise<unknown> => {
  const handler = handlers[command.type] as (command: TabCommand) => unknown
  return handler(command)
}

window.addEventListener('message', (event: MessageEvent<TabRequest>) => {
  if (event.source !== window.parent) return
  const request = event.data
  if (request?.tag !== harnessTag) return
  run(request.command).then(
    (value) => reply({ tag: harnessTag, type: 'reply', id: request.id, ok: true, value }),
    (error: unknown) =>
      reply({
        tag: harnessTag,
        type: 'reply',
        id: request.id,
        ok: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      }),
  )
})

reply({ tag: harnessTag, type: 'ready' })
