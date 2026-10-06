import { action, computed, withAsync, withAsyncData, wrap } from '@reatom/core'

import { sha256Hex } from '../platform/crypto'
import { unlimitedAckHashes } from '../storage/prefs'
import { keyMeta } from './keyMeta'
import { apiKey } from './keyStore'

export const apiKeyHash = computed(async (): Promise<string | null> => {
  const key = apiKey()
  if (!key) return null
  return await wrap(sha256Hex(key))
}, 'auth.apiKeyHash').extend(withAsyncData({ initState: null }))

export const unlimitedAckNeeded = computed(() => {
  const meta = keyMeta.data()
  const hash = apiKeyHash.data()
  if (!meta || meta.limit !== null || !hash) return false
  return !unlimitedAckHashes().includes(hash)
}, 'auth.unlimitedAckNeeded')

export const rememberUnlimitedHash = (hash: string) => {
  const hashes = unlimitedAckHashes()
  if (hashes.includes(hash)) return
  unlimitedAckHashes.set([...hashes, hash])
}

export const acknowledgeUnlimited = action(async () => {
  const key = apiKey()
  if (!key) return
  const hash = await wrap(sha256Hex(key))
  unlimitedAckHashes.set((hashes) =>
    hashes.includes(hash) ? hashes : [...hashes, hash],
  )
}, 'auth.acknowledgeUnlimited').extend(withAsync())
