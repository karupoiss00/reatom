import { action, atom } from '@reatom/core'

import { now } from '../platform/env'
import type { DbHealth, WriteFailure } from './types'

export const dbHealth = atom<DbHealth>({ status: 'ok' }, 'storage.dbHealth')

export const writeFailure = atom<WriteFailure | null>(
  null,
  'storage.writeFailure',
)

export const recordWriteFailure = action((reason: WriteFailure['reason']) => {
  if (writeFailure() !== null) return
  writeFailure.set({ reason, at: now() })
}, 'storage.recordWriteFailure')

export const markDatabaseBlocked = action(() => {
  dbHealth.set({ status: 'error', reason: 'blocked' })
}, 'storage.markBlocked')

export const markReadFailed = action(() => {
  const status = dbHealth().status
  if (status === 'ok' || status === 'opening') {
    dbHealth.set({ status: 'error', reason: 'read-failed' })
  }
}, 'storage.markReadFailed')
