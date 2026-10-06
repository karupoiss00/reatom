import { onRuntimeReset } from './runtime'

let persistRequest: Promise<boolean> | null = null

const requestPersist = async (): Promise<boolean> => {
  try {
    if (!navigator.storage?.persist) return false
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export const requestPersistOnce = (): Promise<boolean> => {
  if (!persistRequest) {
    persistRequest = requestPersist()
    onRuntimeReset(resetPersistRequest)
  }
  return persistRequest
}

export const resetPersistRequest = (): void => {
  persistRequest = null
}

export const storageEstimate = async (): Promise<{ usage: number } | null> => {
  try {
    if (!navigator.storage?.estimate) return null
    const estimate = await navigator.storage.estimate()
    return typeof estimate.usage === 'number' ? { usage: estimate.usage } : null
  } catch {
    return null
  }
}

export const storagePersisted = async (): Promise<boolean> => {
  try {
    if (!navigator.storage?.persisted) return false
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}
