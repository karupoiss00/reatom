import type { TabId } from '../platform/types'
import { once, sleep, type HeldLock, type LockBackend } from './lockBackend'

export const lockChannelName = 'atelier.locks'

export const channelLockTimings = {
  claimWaitMs: 120,
  queryWaitMs: 120,
  heartbeatMs: 200,
  expiryMs: 700,
  freePollMs: 50,
}

type LockMessage =
  | { kind: 'claim'; name: string; tabId: TabId; nonce: string; tie: number }
  | { kind: 'held'; name: string; tabId: TabId }
  | { kind: 'query'; name: string; tabId: TabId }
  | { kind: 'released'; name: string; tabId: TabId }

interface PendingClaim {
  nonce: string
  tie: number
  lose: () => void
}

let nextClaimTie = 0

const createNonce = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

const createClaimTie = () => ++nextClaimTie + Math.random()

/**
 * Web Locks fallback: a tab claims a name, waits for objections, then
 * heartbeats while it holds it. A silent holder expires, which covers a closed
 * or crashed tab. Concurrent claims resolve to the lowest nonce, then the lower
 * tab id, then the lower claim tie.
 */
export const createChannelLockBackend = (options: {
  channelName?: string
  tabId: () => TabId
}): LockBackend => {
  const channel =
    typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(options.channelName ?? lockChannelName)
  const ownExclusive = new Map<string, string>()
  const ownShared = new Map<string, number>()
  const remoteHolders = new Map<string, Map<TabId, number>>()
  const pendingClaims = new Map<string, PendingClaim>()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const post = (message: LockMessage) => {
    try {
      channel?.postMessage(message)
    } catch (error) {
      console.warn('Could not post a lock message', error)
    }
  }

  const ownsName = (name: string) =>
    ownExclusive.has(name) || (ownShared.get(name) ?? 0) > 0

  const ownNames = () => new Set([...ownExclusive.keys(), ...ownShared.keys()])

  const heldRemotely = (name: string) => {
    const holders = remoteHolders.get(name)
    if (!holders) return false
    const freshAfter = performance.now() - channelLockTimings.expiryMs
    for (const [holder, seenAt] of holders) {
      if (seenAt < freshAfter) holders.delete(holder)
    }
    if (holders.size === 0) remoteHolders.delete(name)
    return holders.size > 0
  }

  const announceHeld = (name: string) =>
    post({ kind: 'held', name, tabId: options.tabId() })

  const syncHeartbeat = () => {
    const owning = ownNames().size > 0
    if (owning && !heartbeat) {
      heartbeat = setInterval(() => {
        for (const name of ownNames()) announceHeld(name)
      }, channelLockTimings.heartbeatMs)
    } else if (!owning && heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  const announceReleasedIfFree = (name: string) => {
    if (ownsName(name)) return
    post({ kind: 'released', name, tabId: options.tabId() })
    syncHeartbeat()
  }

  const receive = (message: LockMessage) => {
    if (message.tabId === options.tabId() && message.kind !== 'claim') return
    if (message.kind === 'claim') {
      if (ownsName(message.name)) announceHeld(message.name)
      const pending = pendingClaims.get(message.name)
      if (!pending) return
      const sameClaim =
        message.nonce === pending.nonce &&
        message.tabId === options.tabId() &&
        message.tie === pending.tie
      if (sameClaim) return
      const incomingWins =
        message.nonce < pending.nonce ||
        (message.nonce === pending.nonce && message.tabId < options.tabId()) ||
        (message.nonce === pending.nonce &&
          message.tabId === options.tabId() &&
          message.tie < pending.tie)
      if (incomingWins) pending.lose()
      else {
        post({
          kind: 'claim',
          name: message.name,
          tabId: options.tabId(),
          nonce: pending.nonce,
          tie: pending.tie,
        })
      }
    } else if (message.kind === 'held') {
      const holders = remoteHolders.get(message.name) ?? new Map()
      holders.set(message.tabId, performance.now())
      remoteHolders.set(message.name, holders)
      pendingClaims.get(message.name)?.lose()
    } else if (message.kind === 'query') {
      if (ownsName(message.name)) announceHeld(message.name)
    } else if (message.kind === 'released') {
      remoteHolders.get(message.name)?.delete(message.tabId)
    }
  }

  const onMessage = (event: MessageEvent<unknown>) => {
    const message = event.data as Partial<LockMessage> | null
    if (!message || typeof message.name !== 'string') return
    if (typeof message.tabId !== 'string') return
    receive(message as LockMessage)
  }

  const dropExclusiveClaims = () => {
    for (const name of [...ownExclusive.keys()]) {
      ownExclusive.delete(name)
      announceReleasedIfFree(name)
    }
  }

  const onPageHide = (event: Event) => {
    if (event instanceof PageTransitionEvent && event.persisted) return
    for (const pending of [...pendingClaims.values()]) pending.lose()
    dropExclusiveClaims()
  }

  channel?.addEventListener('message', onMessage)
  if (channel) window.addEventListener('pagehide', onPageHide)

  const claim = (name: string, nonce: string) =>
    new Promise<boolean>((resolve) => {
      const tie = createClaimTie()
      const finish = (won: boolean) => {
        clearTimeout(timer)
        if (pendingClaims.get(name)?.nonce === nonce) pendingClaims.delete(name)
        resolve(won)
      }
      const timer = setTimeout(
        () => finish(true),
        channelLockTimings.claimWaitMs,
      )
      pendingClaims.set(name, { nonce, tie, lose: () => finish(false) })
      post({ kind: 'claim', name, tabId: options.tabId(), nonce, tie })
    })

  return {
    async acquireExclusive(name) {
      if (ownsName(name) || heldRemotely(name) || pendingClaims.has(name)) {
        return null
      }
      const nonce = createNonce()
      if (channel && !(await claim(name, nonce))) return null
      if (ownsName(name) || heldRemotely(name)) return null
      ownExclusive.set(name, nonce)
      announceHeld(name)
      syncHeartbeat()
      return {
        release: once(() => {
          if (ownExclusive.get(name) === nonce) {
            ownExclusive.delete(name)
            announceReleasedIfFree(name)
          }
          return Promise.resolve()
        }),
      }
    },
    hold(name): HeldLock {
      ownShared.set(name, (ownShared.get(name) ?? 0) + 1)
      announceHeld(name)
      syncHeartbeat()
      return {
        release: once(() => {
          const remaining = (ownShared.get(name) ?? 1) - 1
          if (remaining > 0) ownShared.set(name, remaining)
          else ownShared.delete(name)
          announceReleasedIfFree(name)
          return Promise.resolve()
        }),
      }
    },
    async isHeld(name) {
      if (ownsName(name) || heldRemotely(name)) return true
      if (!channel) return false
      post({ kind: 'query', name, tabId: options.tabId() })
      await sleep(channelLockTimings.queryWaitMs)
      return ownsName(name) || heldRemotely(name)
    },
    async waitUntilFree(name, signal) {
      while (heldRemotely(name)) {
        await sleep(channelLockTimings.freePollMs, signal)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      for (const pending of [...pendingClaims.values()]) pending.lose()
      const names = [...ownNames()]
      ownExclusive.clear()
      ownShared.clear()
      for (const name of names) {
        post({ kind: 'released', name, tabId: options.tabId() })
      }
      channel?.removeEventListener('message', onMessage)
      if (channel) window.removeEventListener('pagehide', onPageHide)
      channel?.close()
      remoteHolders.clear()
    },
  }
}
