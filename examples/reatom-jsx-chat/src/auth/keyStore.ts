import { action, atom, withMiddleware } from '@reatom/core'

export const keyStorageKey = 'atelier.key'

export type StoredKey = { key: string; remembered: boolean }

const readFrom = (storage: () => Storage): string | null => {
  try {
    const value = storage().getItem(keyStorageKey)
    return value && value.trim().length > 0 ? value : null
  } catch {
    return null
  }
}

const removeFrom = (storage: () => Storage) => {
  try {
    storage().removeItem(keyStorageKey)
  } catch {}
}

const dropShadowedSessionKey = action(() => {
  removeFrom(() => sessionStorage)
}, 'auth.dropShadowedSessionKey')

export const readStoredKey = (): StoredKey | null => {
  const rememberedKey = readFrom(() => localStorage)
  if (rememberedKey) {
    if (readFrom(() => sessionStorage)) dropShadowedSessionKey()
    return { key: rememberedKey, remembered: true }
  }
  const sessionKey = readFrom(() => sessionStorage)
  if (sessionKey) return { key: sessionKey, remembered: false }
  return null
}

export const clearStoredKey = (): void => {
  removeFrom(() => localStorage)
  removeFrom(() => sessionStorage)
}

export const writeStoredKey = (key: string, remember: boolean): boolean => {
  try {
    const target = remember ? localStorage : sessionStorage
    target.setItem(keyStorageKey, key)
    removeFrom(() => (remember ? sessionStorage : localStorage))
    return true
  } catch {
    return false
  }
}

export const apiKey = atom<string | null>(
  () => readStoredKey()?.key ?? null,
  'auth.apiKey',
)

export const rememberKey = atom<boolean>(
  () => readStoredKey()?.remembered ?? true,
  'auth.rememberKey',
)

export const keyStorageFailed = atom(false, 'auth.keyStorageFailed')

const moveStoredKey = action((key: string, remember: boolean) => {
  keyStorageFailed.set(!writeStoredKey(key, remember))
}, 'auth.moveStoredKey')

const syncRememberedKey = action(() => {
  const key = apiKey()
  if (!key) return
  const remember = rememberKey()
  const stored = readStoredKey()
  if (stored?.key === key && stored.remembered === remember) return
  moveStoredKey(key, remember)
}, 'auth.syncRememberedKey')

export const placeKey = action((key: string, remember: boolean): boolean => {
  const wrote = writeStoredKey(key, remember)
  keyStorageFailed.set(!wrote)
  apiKey.set(key)
  if (rememberKey() !== remember) rememberKey.set(remember)
  return wrote
}, 'auth.placeKey')

rememberKey.extend(
  withMiddleware(() => (next, ...params) => {
    const state = next(...params)
    if (params.length > 0) syncRememberedKey()
    return state
  }),
)
