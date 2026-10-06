import {
  addCallHook,
  atom,
  computed,
  withConnectHook,
  type Atom,
  type Computed,
} from '@reatom/core'

import { tabId } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import type { TabId } from '../platform/types'
import type { ChatId } from '../storage/types'
import { syncReceived } from './bus'
import { createChannelLockBackend } from './channelLocks'
import type { HeldLock, LockBackend } from './lockBackend'
import type { StreamLock } from './types'
import { createWebLockBackend } from './webLocks'

export const streamLockName = (chatId: ChatId) => `chat-stream:${chatId}`
export const tombstoneLockName = (id: string) => `tombstone:${id}`

export interface RemoteStreamNotice {
  chatId: ChatId
  tabId: TabId
  active: boolean
}

export interface SyncLocksOptions {
  tabId?: () => TabId
  /** BroadcastChannel used for claims when Web Locks are missing. */
  channelName?: string
  lockManager?: () => LockManager | undefined
  onRemoteReleased?: (chatId: ChatId, holderTab: TabId) => void
}

export interface SyncLocks {
  acquireStreamLock(chatId: ChatId): Promise<StreamLock | null>
  streamHeldElsewhere(chatId: ChatId): Computed<boolean>
  noteRemoteStream(notice: RemoteStreamNotice): void
  holdTombstone(id: string, ms: number): { release(): void }
  isTombstoneHeld(id: string): Promise<boolean>
  dispose(): void
}

const browserLockManager = () =>
  typeof navigator === 'undefined' ? undefined : navigator.locks

export const createSyncLocks = (options: SyncLocksOptions = {}): SyncLocks => {
  const currentTab = options.tabId ?? (() => tabId)
  const lockManager = options.lockManager ?? browserLockManager
  let webBackend: { manager: LockManager; backend: LockBackend } | null = null
  let channelBackend: LockBackend | null = null
  let disposed = false

  const backend = (): LockBackend => {
    const manager = lockManager()
    if (manager) {
      if (webBackend?.manager !== manager) {
        webBackend = { manager, backend: createWebLockBackend(manager) }
      }
      return webBackend.backend
    }
    channelBackend ??= createChannelLockBackend({
      channelName: options.channelName,
      tabId: currentTab,
    })
    return channelBackend
  }

  const localStreamHolds = new Set<ChatId>()
  const pendingReleases = new Map<ChatId, Promise<void>>()
  const localTombstoneHolds = new Map<string, number>()
  const remoteHolderTabs = new Map<ChatId, TabId>()
  const heldElsewhereNow = new Set<ChatId>()
  const watchers = new Map<ChatId, AbortController>()
  const heldElsewhereAtoms = new Map<
    ChatId,
    { state: Atom<boolean>; view: Computed<boolean> }
  >()

  const heldElsewhereEntry = (chatId: ChatId) => {
    let entry = heldElsewhereAtoms.get(chatId)
    if (!entry) {
      const state = atom(false, `sync.streamHeldElsewhere#${chatId}.state`)
      const view = computed(
        () => state(),
        `sync.streamHeldElsewhere#${chatId}`,
      ).extend(
        withConnectHook(() => {
          state.set(heldElsewhereNow.has(chatId))
          watch(chatId)
          return () => {
            stopWatching(chatId)
          }
        }),
      )
      entry = { state, view }
      heldElsewhereAtoms.set(chatId, entry)
    }
    return entry
  }

  const setHeldElsewhere = (chatId: ChatId, held: boolean) => {
    if (held) heldElsewhereNow.add(chatId)
    else heldElsewhereNow.delete(chatId)
    heldElsewhereEntry(chatId).state.set(held)
  }

  const settleReleased = (chatId: ChatId) => {
    setHeldElsewhere(chatId, false)
    const holderTab = remoteHolderTabs.get(chatId)
    remoteHolderTabs.delete(chatId)
    if (holderTab) options.onRemoteReleased?.(chatId, holderTab)
  }

  const watch = (chatId: ChatId) => {
    if (disposed || watchers.has(chatId) || localStreamHolds.has(chatId)) return
    const controller = new AbortController()
    watchers.set(chatId, controller)
    const name = streamLockName(chatId)
    const waitForRelease = async () => {
      const current = backend()
      if (!(await current.isHeld(name))) return
      if (controller.signal.aborted) return
      setHeldElsewhere(chatId, true)
      await current.waitUntilFree(name, controller.signal)
    }
    const forget = () => {
      if (watchers.get(chatId) === controller) watchers.delete(chatId)
    }
    waitForRelease().then(
      () => {
        forget()
        if (!controller.signal.aborted) settleReleased(chatId)
      },
      forget,
    )
  }

  const stopWatching = (chatId: ChatId) => {
    watchers.get(chatId)?.abort()
    watchers.delete(chatId)
  }

  return {
    async acquireStreamLock(chatId) {
      if (disposed) return null
      const pendingRelease = pendingReleases.get(chatId)
      if (pendingRelease) await pendingRelease
      if (disposed || localStreamHolds.has(chatId)) return null
      localStreamHolds.add(chatId)
      let held: HeldLock | null = null
      try {
        held = await backend().acquireExclusive(streamLockName(chatId))
      } catch (error) {
        console.warn('Could not request the stream lock', error)
      }
      if (!held || disposed) {
        if (held) await held.release()
        localStreamHolds.delete(chatId)
        watch(chatId)
        return null
      }
      stopWatching(chatId)
      remoteHolderTabs.delete(chatId)
      setHeldElsewhere(chatId, false)
      const heldLock = held
      let released = false
      return {
        release() {
          if (released) return pendingReleases.get(chatId) ?? Promise.resolve()
          released = true
          localStreamHolds.delete(chatId)
          let settled!: Promise<void>
          settled = Promise.resolve(heldLock.release()).finally(() => {
            if (pendingReleases.get(chatId) === settled) {
              pendingReleases.delete(chatId)
            }
          })
          pendingReleases.set(chatId, settled)
          return settled
        },
      }
    },

    streamHeldElsewhere: (chatId) => heldElsewhereEntry(chatId).view,

    noteRemoteStream({ chatId, tabId: holderTab, active }) {
      if (disposed || holderTab === currentTab()) return
      if (active) {
        remoteHolderTabs.set(chatId, holderTab)
        if (!localStreamHolds.has(chatId)) setHeldElsewhere(chatId, true)
      }
      watch(chatId)
    },

    holdTombstone(id, ms) {
      localTombstoneHolds.set(id, (localTombstoneHolds.get(id) ?? 0) + 1)
      const held = backend().hold(tombstoneLockName(id))
      let released = false
      const release = () => {
        if (released) return
        released = true
        clearTimeout(expiry)
        const remaining = (localTombstoneHolds.get(id) ?? 1) - 1
        if (remaining > 0) localTombstoneHolds.set(id, remaining)
        else localTombstoneHolds.delete(id)
        held.release()
      }
      const expiry = setTimeout(release, ms)
      return { release }
    },

    async isTombstoneHeld(id) {
      if (localTombstoneHolds.has(id)) return true
      try {
        return await backend().isHeld(tombstoneLockName(id))
      } catch {
        return false
      }
    },

    dispose() {
      disposed = true
      for (const controller of watchers.values()) controller.abort()
      watchers.clear()
      localStreamHolds.clear()
      localTombstoneHolds.clear()
      webBackend?.backend.dispose()
      channelBackend?.dispose()
    },
  }
}

let sharedLocks: SyncLocks | null = null

const getSharedLocks = (): SyncLocks => {
  if (!sharedLocks) {
    const locks = createSyncLocks({
      onRemoteReleased: (chatId, holderTab) =>
        syncReceived({ type: 'stream', chatId, tabId: holderTab, active: false }),
    })
    sharedLocks = locks
    onRuntimeReset(() => {
      locks.dispose()
      if (sharedLocks === locks) sharedLocks = null
    })
  }
  return sharedLocks
}

addCallHook(syncReceived, (event) => {
  if (event.type === 'stream') getSharedLocks().noteRemoteStream(event)
})

export const acquireStreamLock = (chatId: ChatId): Promise<StreamLock | null> =>
  getSharedLocks().acquireStreamLock(chatId)

export const streamHeldElsewhere = (chatId: ChatId): Computed<boolean> =>
  getSharedLocks().streamHeldElsewhere(chatId)

export const holdTombstone = (id: string, ms: number): { release(): void } =>
  getSharedLocks().holdTombstone(id, ms)

export const isTombstoneHeld = (id: string): Promise<boolean> =>
  getSharedLocks().isTombstoneHeld(id)
