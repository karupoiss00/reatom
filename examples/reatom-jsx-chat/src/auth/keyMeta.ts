import {
  abortVar,
  action,
  atom,
  computed,
  withAsyncData,
  withMiddleware,
  wrap,
} from '@reatom/core'
import { OpenRouterError } from '@openrouter/sdk/models/errors'

import { timings } from '../app/timings'
import { now } from '../platform/env'
import { onRuntimeReset } from '../platform/runtime'
import { apiKey, clearStoredKey } from './keyStore'
import type { KeyMeta, KeyStatus } from './types'
import { isRequestAbort, readKeyMeta } from './validate'

let streamsInFlight = 0

export const revokedDuringStream = atom(false, 'auth.revokedDuringStream')

const keyRevoked = atom(false, 'auth.keyRevoked')

const refreshedAt = atom(0, 'auth.refreshKeyMeta.at')

export const noteStreamsInFlight = (count: number) => {
  streamsInFlight = count
}

export const dismissRevocation = () => {
  keyRevoked.set(false)
  revokedDuringStream.set(false)
}

const finishRevokedStream = action(() => {
  keyRevoked.set(true)
  revokedDuringStream.set(false)
  clearStoredKey()
  apiKey.set(null)
}, 'auth.finishRevokedStream')

export const finishIfRevokedAndIdle = (): boolean => {
  if (streamsInFlight > 0 || !revokedDuringStream()) return false
  finishRevokedStream()
  return true
}

const rejectStoredManagementKey = action(() => {
  clearStoredKey()
  apiKey.set(null)
}, 'auth.rejectStoredManagementKey')

export const keyMeta = computed(async (): Promise<KeyMeta | null> => {
  const key = apiKey()
  if (!key) return null
  try {
    const meta = await wrap(readKeyMeta(key, abortVar.require().signal))
    if (apiKey() !== key) throw new Error('Unknown key limit')
    if (meta.isManagementKey) {
      rejectStoredManagementKey()
      return null
    }
    return meta
  } catch (error) {
    if (isRequestAbort(error)) throw error
    if (error instanceof OpenRouterError && error.statusCode === 401) {
      if (streamsInFlight > 0) {
        revokedDuringStream.set(true)
        clearResolvedKeyMeta()
        throw error
      }
      finishRevokedStream()
      return null
    }
    throw error
  }
}, 'auth.keyMeta').extend(withAsyncData({ initState: null }))

const clearResolvedKeyMeta = action(() => {
  keyMeta.data.reset()
}, 'auth.clearResolvedKeyMeta')

const noteApiKeyWritten = action((previous: string | null) => {
  const next = apiKey()
  if (next !== previous) clearResolvedKeyMeta()
  if (next) {
    keyRevoked.set(false)
    revokedDuringStream.set(false)
  }
}, 'auth.noteApiKeyWritten')

apiKey.extend(
  withMiddleware(() => (next, ...params) => {
    const previous = params.length > 0 ? apiKey() : null
    const state = next(...params)
    if (params.length > 0) noteApiKeyWritten(previous)
    return state
  }),
)

export const refreshKeyMeta = action((opts?: { force?: boolean }): void => {
  const last = refreshedAt()
  if (!opts?.force && last !== 0 && now() - last < timings.keyMetaThrottleMs) {
    return
  }
  refreshedAt.set(now())
  void keyMeta.retry().catch((error: unknown) => {
    if (isRequestAbort(error)) return
  })
}, 'auth.refreshKeyMeta')

export const keyStatus = computed((): KeyStatus => {
  if (keyRevoked() && !apiKey()) return 'revoked'
  if (!apiKey()) return 'none'
  keyMeta.data()
  if (keyMeta.error()) return 'unavailable'
  if (!keyMeta.ready()) return 'loading'
  return 'ok'
}, 'auth.keyStatus')

onRuntimeReset(() => {
  streamsInFlight = 0
})
