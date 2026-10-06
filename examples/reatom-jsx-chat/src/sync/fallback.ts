import { action } from '@reatom/core'

export const reloadFromStorage = action(() => {}, 'sync.reloadFromStorage')

export const installStorageReloadFallback = (): (() => void) => {
  const listeners = new AbortController()
  const reloadWhenVisible = () => {
    if (document.visibilityState === 'visible') reloadFromStorage()
  }
  window.addEventListener('focus', () => reloadFromStorage(), {
    signal: listeners.signal,
  })
  document.addEventListener('visibilitychange', reloadWhenVisible, {
    signal: listeners.signal,
  })
  return () => listeners.abort()
}
