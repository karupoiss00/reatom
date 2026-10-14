import {
  action,
  atom,
  computed,
  withConnectHook,
  wrap,
} from '@reatom/core'

import { tabId } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import { createChannelLockBackend } from '../sync/channelLocks'
import type { HeldLock, LockBackend } from '../sync/lockBackend'
import { createWebLockBackend } from '../sync/webLocks'
import { humanToolName } from './names'

const knownWriteToken =
  /^(execute|update|export|save|write|create|delete|apply|click|run|patch|set|move|replace|remove|add|put|post|edit|insert|mutate|commit|push|send)s?$/i
const knownSafeReadToken =
  /^(read|get|list|fetch|search|lookup|inspect|describe|show|view|query|find|status|info|ping|schema)s?$/i

const toolNameTokens = (name: string) =>
  [name, humanToolName(name)]
    .flatMap((value) => value.split(/[\s_-]+/))
    .filter((token) => token.length > 0)

export const mcpCallLockName = 'mcp-call'
export const mcpBusyChannelName = 'atelier.mcpBusy'

const localHold = atom(false, 'mcp.busy.local')
const remoteHold = atom(false, 'mcp.busy.remote')

export const mcpCallBlocked = atom(false, 'mcp.busy.blocked')

export const mcpBusy = computed(
  () => localHold() || remoteHold(),
  'mcp.busy',
).extend(
  withConnectHook(() => {
    ensureWatchers()
    publish({ query: true })
  }),
)

export const mcpAlwaysAllow = atom(new Set<string>(), 'mcp.alwaysAllow')

export const isMcpWriteTool = (name: string) => {
  const tokens = toolNameTokens(name)
  if (tokens.some((token) => knownWriteToken.test(token))) return true
  return !tokens.some((token) => knownSafeReadToken.test(token))
}

export const mcpToolHostName = (name: string) => {
  const match = /^([\w-]+)_mcp_/i.exec(name)
  if (!match) return 'MCP'
  const host = match[1]!.replace(/[-_]+/g, ' ')
  return host.charAt(0).toUpperCase() + host.slice(1)
}

type BusyMessage = { busy: boolean } | { query: true }

let channel: BroadcastChannel | null = null
let locks: LockBackend | null = null
let heldLock: HeldLock | null = null
let watchersInstalled = false

const browserLockManager = () =>
  typeof navigator === 'undefined' ? undefined : navigator.locks

const lockBackend = (): LockBackend => {
  if (!locks) {
    const manager = browserLockManager()
    locks = manager
      ? createWebLockBackend(manager)
      : createChannelLockBackend({
          channelName: `${mcpBusyChannelName}.locks`,
          tabId: () => tabId,
        })
  }
  return locks
}

const applyBusyMessage = action((message: BusyMessage) => {
  if ('query' in message) {
    if (localHold()) publish({ busy: true })
    return
  }
  remoteHold.set(message.busy)
  mcpCallBlocked.set(message.busy)
}, 'mcp.busy.apply')

const onMessage = (event: MessageEvent<unknown>) => {
  const message = event.data as Partial<BusyMessage> | null
  if (!message || typeof message !== 'object') return
  if ('query' in message && message.query === true) {
    applyBusyMessage({ query: true })
    return
  }
  if ('busy' in message && typeof message.busy === 'boolean') {
    applyBusyMessage({ busy: message.busy })
  }
}

const publish = (message: BusyMessage) => {
  try {
    channel?.postMessage(message)
  } catch {
    return
  }
}

const ensureWatchers = () => {
  if (watchersInstalled) return
  watchersInstalled = true
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(mcpBusyChannelName)
    channel.addEventListener('message', onMessage)
  }
  onRuntimeReset(() => {
    channel?.removeEventListener('message', onMessage)
    channel?.close()
    channel = null
    void heldLock?.release()
    heldLock = null
    locks?.dispose()
    locks = null
    watchersInstalled = false
  })
}

export const acquireMcpCall = action(async (): Promise<boolean> => {
  ensureWatchers()
  if (localHold() || remoteHold()) {
    mcpCallBlocked.set(true)
    return false
  }
  const held = await wrap(lockBackend().acquireExclusive(mcpCallLockName))
  if (!held) {
    remoteHold.set(true)
    mcpCallBlocked.set(true)
    return false
  }
  heldLock = held
  localHold.set(true)
  mcpCallBlocked.set(false)
  publish({ busy: true })
  return true
}, 'mcp.acquireCall')

export const releaseMcpCall = () => {
  const held = heldLock
  heldLock = null
  localHold.set(false)
  mcpCallBlocked.set(false)
  publish({ busy: false })
  void held?.release()
}

export const mcpAlwaysAllows = (name: string) => {
  if (isMcpWriteTool(name)) return false
  return mcpAlwaysAllow().has(name)
}

export const rememberMcpAlwaysAllow = (name: string) => {
  if (isMcpWriteTool(name)) return
  mcpAlwaysAllow.set((names) => new Set(names).add(name))
}
