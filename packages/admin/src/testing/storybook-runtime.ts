import type { AdminConnection } from '../otlp'
import type { createAdminDevtools } from '../view'
import { resetAdminSettings } from '../view/settings'

export type AdminDevtoolsInstance = ReturnType<typeof createAdminDevtools>

export let currentDevtools: AdminDevtoolsInstance | null = null
export let currentConnection: AdminConnection | null = null
let storyCleanups: Array<() => void> = []

export function setCurrentConnection(connection: AdminConnection | null): void {
  currentConnection = connection
}

export function setCurrentDevtools(
  devtools: AdminDevtoolsInstance | null,
): void {
  currentDevtools = devtools
}

export function clearCurrentDevtools(): void {
  currentDevtools = null
}

export function registerStoryCleanup(cleanup: () => void): void {
  storyCleanups.push(cleanup)
}

export function runStoryCleanups(): void {
  for (const cleanup of storyCleanups.splice(0)) {
    cleanup()
  }
}

export function clearAdminStorage(): void {
  if (typeof window === 'undefined') return

  const adminKeys = Object.keys(localStorage).filter(
    (key) => key.startsWith('_Admin.') || key.startsWith('_Admin'),
  )

  for (const key of adminKeys) {
    const oldValue = localStorage.getItem(key)
    localStorage.removeItem(key)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key,
        oldValue,
        newValue: null,
        storageArea: localStorage,
      }),
    )
  }
  resetAdminSettings()
}
