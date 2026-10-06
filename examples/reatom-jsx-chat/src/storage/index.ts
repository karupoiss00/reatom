import { action, computed, withAsync, withAsyncData, wrap } from '@reatom/core'

import { storageEstimate, storagePersisted } from '../platform/storage-api'
import { lostConnectionEpoch } from './db'
import { dbHealth, writeFailure } from './health'
import { runMigrations } from './migrations'
import { persistDenied } from './prefs'
import {
  captureRecoverable,
  ensureIdbRepo,
  installBlockedRepo,
  installMemoryFallback,
  onRepoReset,
  prepareStorageAttempt,
  releaseMemoryFallback,
  repo,
  StorageReadError,
} from './repo'
import { purgeUnheldTombstones } from './tombstones'
import type { WriteFailure } from './types'

const isWriteFailure = (error: unknown): error is WriteFailure => {
  if (typeof error !== 'object' || error === null) return false
  const reason = (error as { reason?: unknown }).reason
  return reason === 'quota' || reason === 'blocked' || reason === 'unknown'
}

export type * from './types'
export { dbHealth, writeFailure } from './health'
export { createMemoryRepo } from './memoryRepo'
export {
  createChatRecord,
  createDefaultChatSettings,
  defaultGlobalPrivacy,
  mergeChatRecord,
} from './records'
export { repo, resetRepoBackend, setRepoBackend } from './repo'

let tombstoneHeld: (id: string) => Promise<boolean> = async () => false

onRepoReset(() => {
  tombstoneHeld = async () => false
})

const initStorageAction = action(async () => {
  const seenLoss = lostConnectionEpoch()
  dbHealth.set({ status: 'opening' })
  const recovered = await wrap(captureRecoverable())
  writeFailure.set(null)
  prepareStorageAttempt()
  const outcome = await wrap(runMigrations())
  if (lostConnectionEpoch() !== seenLoss) return
  if (outcome.status === 'memory') {
    installMemoryFallback()
    if (recovered) await wrap(repo.bulkImport(recovered))
    dbHealth.set({ status: 'memory', reason: 'open-failed' })
    return
  }
  if (outcome.status === 'blocked') {
    installBlockedRepo()
    dbHealth.set({ status: 'error', reason: 'blocked' })
    return
  }
  ensureIdbRepo(outcome.db)
  if (recovered) {
    try {
      await wrap(repo.bulkImport(recovered))
    } catch (error) {
      if (lostConnectionEpoch() !== seenLoss) return
      if (error instanceof StorageReadError) {
        dbHealth.set({ status: 'error', reason: 'read-failed' })
        throw error
      }
      if (!isWriteFailure(error)) throw error
    }
    if (lostConnectionEpoch() !== seenLoss) return
    if (writeFailure() === null) releaseMemoryFallback()
  }
  try {
    await wrap(purgeUnheldTombstones(repo, (id) => tombstoneHeld(id)))
  } catch (error) {
    if (lostConnectionEpoch() !== seenLoss) return
    if (isWriteFailure(error)) {
      dbHealth.set({ status: 'ok' })
      return
    }
    dbHealth.set({ status: 'error', reason: 'read-failed' })
    throw error
  }
  if (lostConnectionEpoch() !== seenLoss) return
  dbHealth.set({ status: 'ok' })
}, 'storage.init').extend(withAsync())

export const initStorage = Object.assign(
  (options?: { isTombstoneHeld?: (id: string) => Promise<boolean> }) => {
    if (options?.isTombstoneHeld) tombstoneHeld = options.isTombstoneHeld
    return initStorageAction()
  },
  initStorageAction,
)

export const retryOpenStorage = action(async () => {
  writeFailure.set(null)
  await wrap(initStorage())
}, 'storage.retryOpen').extend(withAsync())

export const storageInfo = computed(async () => {
  const [estimate, persisted] = await wrap(
    Promise.all([storageEstimate(), storagePersisted()]),
  )
  return { usageBytes: estimate?.usage ?? null, persisted }
}, 'storage.info').extend(withAsyncData())

export const requestPersistence = action(async () => {
  const granted = await wrap(
    navigator.storage?.persist?.().catch(() => false) ?? Promise.resolve(false),
  )
  persistDenied.set(!granted)
  storageInfo.retry()
  return granted
}, 'storage.requestPersistence').extend(withAsync())
