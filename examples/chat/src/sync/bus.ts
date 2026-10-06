import { action } from '@reatom/core'

import { tabId } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import type { TabId } from '../platform/types'
import { installStorageReloadFallback } from './fallback'
import type { SyncBus, SyncEvent } from './types'

export const syncChannelName = 'atelier'

const envelopeApp = 'atelier'

const knownEventTypes: ReadonlySet<string> = new Set<SyncEvent['type']>([
  'chat',
  'message',
  'message-deleted',
  'chat-purged',
  'preset',
  'preset-purged',
  'stream',
  'all-deleted',
])

interface SyncEnvelope {
  app: typeof envelopeApp
  from: TabId
  event: SyncEvent
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const readSyncEnvelope = (
  data: unknown,
  ownTab: TabId,
): SyncEvent | null => {
  if (!isRecord(data) || data.app !== envelopeApp) return null
  if (typeof data.from !== 'string' || data.from === ownTab) return null
  const event = data.event
  if (!isRecord(event) || typeof event.type !== 'string') return null
  if (!knownEventTypes.has(event.type)) return null
  return event as unknown as SyncEvent
}

export interface SyncChannel extends SyncBus {
  subscribe(listener: (event: SyncEvent) => void): () => void
  close(): void
}

export interface SyncChannelOptions {
  name?: string
  tabId?: () => TabId
}

export const createSyncChannel = (
  options: SyncChannelOptions = {},
): SyncChannel => {
  const name = options.name ?? syncChannelName
  const currentTab = options.tabId ?? (() => tabId)
  const supported = typeof BroadcastChannel !== 'undefined'
  const listeners = new Set<(event: SyncEvent) => void>()
  let channel: BroadcastChannel | null = null

  const deliver = (message: MessageEvent<unknown>) => {
    const event = readSyncEnvelope(message.data, currentTab())
    if (!event) return
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        console.error('A sync listener failed', error)
      }
    }
  }

  const open = () => {
    if (!supported) return null
    if (!channel) {
      channel = new BroadcastChannel(name)
      channel.addEventListener('message', deliver)
    }
    return channel
  }

  return {
    supported,
    publish(event) {
      const envelope: SyncEnvelope = { app: envelopeApp, from: currentTab(), event }
      try {
        open()?.postMessage(envelope)
      } catch (error) {
        console.warn(`Could not publish the "${event.type}" sync event`, error)
      }
    },
    subscribe(listener) {
      open()
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      listeners.clear()
      channel?.close()
      channel = null
    },
  }
}

let sharedChannel: SyncChannel | null = null

const getSharedChannel = (): SyncChannel => {
  const supported = typeof BroadcastChannel !== 'undefined'
  if (sharedChannel && sharedChannel.supported !== supported) {
    sharedChannel.close()
    sharedChannel = null
  }
  if (!sharedChannel) {
    const channel = createSyncChannel()
    sharedChannel = channel
    onRuntimeReset(() => {
      channel.close()
      if (sharedChannel === channel) sharedChannel = null
    })
  }
  return sharedChannel
}

export const syncBus: SyncBus = {
  get supported() {
    return typeof BroadcastChannel !== 'undefined'
  },
  publish(event) {
    getSharedChannel().publish(event)
  },
}

export const syncReceived = action((event: SyncEvent) => event, 'sync.received')

type ReceiveMode = 'channel' | 'storage-reload'

let installedReceiver: { mode: ReceiveMode; uninstall: () => void } | null =
  null

/**
 * The channel outlives `context.reset()` in tests, so incoming events call
 * `syncReceived` in whatever context is current instead of a wrapped frame.
 */
const installReceiver = (mode: ReceiveMode) =>
  mode === 'storage-reload'
    ? installStorageReloadFallback()
    : getSharedChannel().subscribe((event) => syncReceived(event))

export const initSync = action((): void => {
  const mode: ReceiveMode = syncBus.supported ? 'channel' : 'storage-reload'
  if (installedReceiver?.mode === mode) return
  installedReceiver?.uninstall()
  const receiver = { mode, uninstall: installReceiver(mode) }
  installedReceiver = receiver
  onRuntimeReset(() => {
    receiver.uninstall()
    if (installedReceiver === receiver) installedReceiver = null
  })
}, 'sync.init')
