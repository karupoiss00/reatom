import type { IDBPDatabase } from 'idb'

import {
  type AtelierSchema,
  configureUpgrade,
  openAtelier,
  storeNames,
} from './db'

const migrateToVersion1 = (database: IDBPDatabase<AtelierSchema>) => {
  database.createObjectStore(storeNames.chats, { keyPath: 'id' })
  const messages = database.createObjectStore(storeNames.messages, {
    keyPath: 'id',
  })
  messages.createIndex('chatId', 'chatId')
  messages.createIndex('parentId', 'parentId')
  const drafts = database.createObjectStore(storeNames.drafts, {
    keyPath: ['chatId', 'tabId'],
  })
  drafts.createIndex('chatId', 'chatId')
  database.createObjectStore(storeNames.attachments, { keyPath: 'id' })
  database.createObjectStore(storeNames.presets, { keyPath: 'id' })
}

export const upgradeAtelierSchema = (
  database: IDBPDatabase<AtelierSchema>,
  oldVersion: number,
) => {
  if (oldVersion < 1) migrateToVersion1(database)
}

export const runMigrations = () => {
  configureUpgrade(upgradeAtelierSchema)
  return openAtelier()
}
