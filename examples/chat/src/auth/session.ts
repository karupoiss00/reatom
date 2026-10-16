import {
  action,
  addCallHook,
  atom,
  computed,
  isAbort,
  withAsync,
  wrap,
} from '@reatom/core'

import { streamLifecycle } from '../chat/engine'
import { library } from '../chat/library'
import { onRuntimeReset } from '../platform/runtime'
import {
  dismissRevocation,
  finishIfRevokedAndIdle,
  noteStreamsInFlight,
  refreshKeyMeta,
} from './keyMeta'
import {
  apiKey,
  clearStoredKey,
  keyStorageFailed,
  readStoredKey,
  rememberKey,
} from './keyStore'
import {
  captureOAuthCallback,
  completeOAuthFromUrl,
  hasOAuthCallback,
  oauthOutcome,
  takeOAuthCallbackUrl,
} from './oauth'
import type { SessionMode } from './types'

export const authReady = atom(false, 'auth.ready')

export const sessionMode = computed((): SessionMode => {
  if (!authReady()) return 'booting'
  const libraryStatus = library.status()
  if (libraryStatus === 'loading') return 'booting'
  if (apiKey()) return 'connected'
  if (libraryStatus === 'error') return 'archive'
  return library.hasChats() ? 'archive' : 'welcome'
}, 'auth.sessionMode')

let activeStreams = new Set<string>()
let streamWatchInstalled = false
let unsubscribeStreamWatch: (() => void) | null = null

const resetStreamTracking = () => {
  unsubscribeStreamWatch?.()
  unsubscribeStreamWatch = null
  streamWatchInstalled = false
  activeStreams = new Set()
  noteStreamsInFlight(0)
  onRuntimeReset(resetStreamTracking)
}

const terminalStream = (type: string) =>
  type === 'completed' || type === 'failed' || type === 'stopped'

export const ensureStreamWatch = () => {
  if (streamWatchInstalled) return
  streamWatchInstalled = true
  unsubscribeStreamWatch = addCallHook(streamLifecycle, (event) => {
    const id = `${event.chatId}:${event.messageId}`
    if (event.type === 'started') activeStreams.add(id)
    if (terminalStream(event.type)) activeStreams.delete(id)
    noteStreamsInFlight(activeStreams.size)
    const cleared = finishIfRevokedAndIdle()
    if (!cleared && (event.type === 'completed' || event.type === 'failed')) {
      refreshKeyMeta({ force: true })
    }
  })
}

onRuntimeReset(resetStreamTracking)

export const forgetKey = action((): void => {
  dismissRevocation()
  clearStoredKey()
  apiKey.set(null)
  keyStorageFailed.set(false)
  if (!rememberKey()) rememberKey.set(true)
}, 'auth.forgetKey')

export const initAuth = action(async () => {
  captureOAuthCallback()
  ensureStreamWatch()
  try {
    const stored = readStoredKey()
    apiKey.set(stored?.key ?? null)
    const remembered = stored?.remembered ?? true
    if (rememberKey() !== remembered) rememberKey.set(remembered)
    const stashed = takeOAuthCallbackUrl()
    const callback = stashed ?? new URL(location.href)
    if (stashed || hasOAuthCallback(callback)) {
      try {
        await wrap(completeOAuthFromUrl(callback))
      } catch (error) {
        if (!isAbort(error)) {
          oauthOutcome.set({ status: 'error', reason: 'exchange-failed' })
        }
      }
    }
  } finally {
    authReady.set(true)
  }
}, 'auth.init').extend(withAsync())
