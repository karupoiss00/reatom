import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import { markDatabaseBlocked } from './health'
import { createChatRecord } from './records'
import type {
  AttachmentBlob,
  ChatRecord,
  DraftRecord,
  MessageRecord,
  PresetRecord,
} from './types'

export const dbName = 'atelier'
export const dbVersion = 1

export const storeNames = {
  chats: 'chats',
  messages: 'messages',
  drafts: 'drafts',
  attachments: 'attachments',
  presets: 'presets',
} as const

export interface AtelierSchema extends DBSchema {
  chats: { key: string; value: ChatRecord }
  messages: {
    key: string
    value: MessageRecord
    indexes: { chatId: string; parentId: string }
  }
  drafts: {
    key: [string, string]
    value: DraftRecord
    indexes: { chatId: string }
  }
  attachments: { key: string; value: AttachmentBlob }
  presets: { key: string; value: PresetRecord }
}

export type UpgradeAtelier = (
  database: IDBPDatabase<AtelierSchema>,
  oldVersion: number,
) => void

export type OpenOutcome =
  | { status: 'ok'; db: IDBPDatabase<AtelierSchema> }
  | { status: 'memory' }
  | { status: 'blocked' }

const allStoreNames = [
  storeNames.chats,
  storeNames.messages,
  storeNames.drafts,
  storeNames.attachments,
  storeNames.presets,
] as const

const probeChatId = '\u0000atelier-probe'
const connections = new Set<IDBPDatabase<AtelierSchema>>()

let upgradeAtelier: UpgradeAtelier = () => {}
let connection: IDBPDatabase<AtelierSchema> | null = null
let opening: Promise<OpenOutcome> | null = null
let lostEpoch = 0

export const configureUpgrade = (upgrade: UpgradeAtelier) => {
  upgradeAtelier = upgrade
}

export const getConnection = (): IDBPDatabase<AtelierSchema> | null => connection

export const lostConnectionEpoch = () => lostEpoch

const bumpLostConnection = () => {
  lostEpoch += 1
}

const closeDatabase = (db: IDBPDatabase<AtelierSchema>) => {
  try {
    db.close()
  } catch {
    return
  }
}

export const closeAllConnections = () => {
  opening = null
  const openDatabases = [...connections]
  connections.clear()
  connection = null
  for (const db of openDatabases) closeDatabase(db)
}

const loseConnection = (db: IDBPDatabase<AtelierSchema>) => {
  if (connection === db) connection = null
  bumpLostConnection()
  markDatabaseBlocked()
  closeDatabase(db)
}

const adoptConnection = (db: IDBPDatabase<AtelierSchema>) => {
  const nativeClose = db.close.bind(db)
  db.close = () => {
    connections.delete(db)
    if (connection === db) connection = null
    try {
      nativeClose()
    } catch {
      return
    }
  }
  connections.add(db)
  connection = db
}

const databaseAcceptsWrites = async (db: IDBPDatabase<AtelierSchema>) => {
  let storedChats = 0
  try {
    storedChats = await db.count(storeNames.chats)
  } catch {
    return false
  }
  try {
    const transaction = db.transaction(storeNames.chats, 'readwrite')
    await transaction.store.put(createChatRecord({ id: probeChatId, at: 0 }))
    await transaction.store.delete(probeChatId)
    await transaction.done
    return true
  } catch {
    return storedChats > 0
  }
}

const openErrorOutcome = (error: unknown): OpenOutcome => {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'VersionError' || name === 'AbortError') return { status: 'blocked' }
  return { status: 'memory' }
}

const openFresh = async (): Promise<OpenOutcome> => {
  if (!globalThis.indexedDB) return { status: 'memory' }
  let reportBlocked: (value: 'blocked') => void = () => {}
  const blockedOpen = new Promise<'blocked'>((resolve) => {
    reportBlocked = resolve
  })
  try {
    const openingDatabase = openDB<AtelierSchema>(dbName, dbVersion, {
      upgrade(database, oldVersion) {
        upgradeAtelier(database, oldVersion)
      },
      blocked() {
        reportBlocked('blocked')
      },
      blocking() {
        if (!connection) return
        loseConnection(connection)
      },
      terminated() {
        if (connection) connections.delete(connection)
        connection = null
        bumpLostConnection()
        markDatabaseBlocked()
      },
    })
    const opened = openingDatabase.then(
      (db) => ({ kind: 'db' as const, db }),
      () => ({ kind: 'failed' as const }),
    )
    const blockNotice = blockedOpen.then(() => ({ kind: 'blocked' as const }))
    let winner: { kind: 'db'; db: IDBPDatabase<AtelierSchema> } | { kind: 'failed' | 'blocked' | 'timeout' } =
      await Promise.race([opened, blockNotice])
    if (winner.kind === 'blocked') {
      const blockClearanceMs = 500
      winner = await Promise.race([
        opened,
        new Promise<{ kind: 'timeout' }>((resolve) => {
          setTimeout(() => resolve({ kind: 'timeout' }), blockClearanceMs)
        }),
      ])
    }
    if (winner.kind !== 'db') {
      void openingDatabase.then((db) => closeDatabase(db)).catch(() => undefined)
      return { status: 'blocked' }
    }
    adoptConnection(winner.db)
    if (!(await databaseAcceptsWrites(winner.db))) {
      closeDatabase(winner.db)
      return { status: 'memory' }
    }
    return { status: 'ok', db: winner.db }
  } catch (error) {
    return openErrorOutcome(error)
  }
}

export const openAtelier = (): Promise<OpenOutcome> => {
  if (connection) return Promise.resolve({ status: 'ok', db: connection })
  if (!opening) {
    opening = openFresh().finally(() => {
      opening = null
    })
  }
  return opening
}

export const atelierStoreNames = allStoreNames
