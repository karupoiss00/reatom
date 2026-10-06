import {
  action,
  type Atom,
  onEvent,
  onLineAtom,
  reatomMediaQuery,
  reatomObservable,
  wrap,
} from '@reatom/core'

import { onRuntimeReset } from './runtime'
import type { TabId } from './types'

const tabStorageKey = 'atelier.tab'

const createTabId = (): TabId =>
  globalThis.crypto?.randomUUID?.() ??
  `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const storeTabId = (id: TabId) => {
  try {
    sessionStorage.setItem(tabStorageKey, id)
  } catch {}
}

const readOrCreateTabId = (): TabId => {
  try {
    const stored = sessionStorage.getItem(tabStorageKey)
    if (stored) return stored
  } catch {}
  const created = createTabId()
  storeTabId(created)
  return created
}

/**
 * Live binding: `claimTabId` may replace it during boot, so read it at use time
 * instead of copying it into module-level constants.
 */
export let tabId: TabId = readOrCreateTabId()

const tabChannelName = 'atelier.tabs'
const tabClaimWaitMs = 120

type TabClaimMessage =
  | { type: 'claim'; tabId: TabId; nonce: string }
  | { type: 'taken'; tabId: TabId; nonce: string }

let tabChannel: BroadcastChannel | null = null
let tabClaim: Promise<TabId> | null = null

const answerClaims = (channel: BroadcastChannel, ownNonce: string) => {
  channel.addEventListener(
    'message',
    (event: MessageEvent<TabClaimMessage>) => {
      const message = event.data
      if (message?.type !== 'claim') return
      if (message.nonce === ownNonce || message.tabId !== tabId) return
      channel.postMessage({
        type: 'taken',
        tabId: message.tabId,
        nonce: message.nonce,
      } satisfies TabClaimMessage)
    },
  )
}

const isClaimContested = (channel: BroadcastChannel, nonce: string) =>
  new Promise<boolean>((resolve) => {
    const onMessage = (event: MessageEvent<TabClaimMessage>) => {
      const message = event.data
      if (message?.type !== 'taken' || message.nonce !== nonce) return
      if (message.tabId !== tabId) return
      finish(true)
    }
    const timer = setTimeout(() => finish(false), tabClaimWaitMs)
    const finish = (contested: boolean) => {
      clearTimeout(timer)
      channel.removeEventListener('message', onMessage)
      resolve(contested)
    }
    channel.addEventListener('message', onMessage)
    channel.postMessage({
      type: 'claim',
      tabId,
      nonce,
    } satisfies TabClaimMessage)
  })

/**
 * "Duplicate tab" copies sessionStorage, so two live tabs can start with the
 * same id. Announce ours and take a fresh one when another tab already owns
 * it.
 */
export const claimTabId = (): Promise<TabId> => {
  if (tabClaim) return tabClaim
  if (typeof BroadcastChannel === 'undefined') {
    tabClaim = Promise.resolve(tabId)
    return tabClaim
  }
  const channel = new BroadcastChannel(tabChannelName)
  const nonce = createTabId()
  tabChannel = channel
  onRuntimeReset(() => {
    channel.close()
    if (tabChannel === channel) tabChannel = null
    tabClaim = null
  })
  answerClaims(channel, nonce)
  tabClaim = isClaimContested(channel, nonce).then((contested) => {
    if (contested && tabChannel === channel) {
      tabId = createTabId()
      storeTabId(tabId)
    }
    return tabId
  })
  return tabClaim
}

export const isOnline: Atom<boolean> = onLineAtom

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible'

export const isVisible: Atom<boolean> = reatomObservable(
  () => ({
    getState: isDocumentVisible,
    subscribe: (update) => {
      onEvent(document, 'visibilitychange', () => update(isDocumentVisible()))
      onEvent(window, 'pageshow', () => update(isDocumentVisible()))
      onEvent(window, 'pagehide', () => update(false))
    },
  }),
  'platform.isVisible',
)

export const pageRestored = action(
  (event: { persisted: boolean }) => event,
  'platform.pageRestored',
)

export const prefersReducedMotion: Atom<boolean> = reatomMediaQuery(
  '(prefers-reduced-motion: reduce)',
  'platform.prefersReducedMotion',
)

export const systemDark: Atom<boolean> = reatomMediaQuery(
  '(prefers-color-scheme: dark)',
  'platform.systemDark',
)

export const now = (): number => Date.now()

let platformListeners: AbortController | null = null

export const initPlatform = action(() => {
  if (platformListeners) return
  platformListeners = new AbortController()
  window.addEventListener(
    'pageshow',
    wrap((event: PageTransitionEvent) => {
      pageRestored({ persisted: event.persisted })
    }),
    { signal: platformListeners.signal },
  )
  onRuntimeReset(() => {
    platformListeners?.abort()
    platformListeners = null
  })
}, 'platform.init')
