import { context } from '@reatom/core'

import { onCatalogDb } from '../catalog/catalog'
import { closeAllConnections } from '../storage/db'
import { resetRepoBackend } from '../storage/repo'

const builtinDatabaseNames = ['atelier', 'atelier.catalog', 'reatom_default']
const extraDatabaseNames = new Set<string>()
const liveDatabases = new Set<IDBDatabase>()

export const registerDbNameForReset = (name: string) => {
  extraDatabaseNames.add(name)
}

export const registerDbForReset = (db: IDBDatabase) => {
  liveDatabases.add(db)
  db.addEventListener('close', () => {
    liveDatabases.delete(db)
  })
}

onCatalogDb(registerDbForReset)

const closeRegisteredDatabases = () => {
  for (const db of liveDatabases) {
    try {
      db.close()
    } catch (error) {
      console.warn('Failed to close a registered database', error)
    }
  }
  liveDatabases.clear()
}

const databaseNamesForReset = () => [
  ...builtinDatabaseNames,
  ...extraDatabaseNames,
]

const listedDatabaseNames = async () => {
  const listed = await indexedDB.databases()
  return new Set(listed.flatMap((info) => (info.name ? [info.name] : [])))
}

const clearDatabase = (name: string) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: DOMException | null) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    const request = indexedDB.open(name)
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) return
      request.transaction?.abort()
      request.result.close()
    }
    request.onerror = () => {
      if (request.error?.name === 'AbortError') finish()
      else finish(request.error)
    }
    request.onsuccess = () => {
      const db = request.result
      const storeNames = [...db.objectStoreNames]
      if (storeNames.length === 0) {
        db.close()
        finish()
        return
      }
      const transaction = db.transaction(storeNames, 'readwrite')
      for (const storeName of storeNames) {
        transaction.objectStore(storeName).clear()
      }
      transaction.oncomplete = () => {
        db.close()
        finish()
      }
      transaction.onabort = () => {
        db.close()
        finish(transaction.error)
      }
      transaction.onerror = () => {
        db.close()
        finish(transaction.error)
      }
    }
  })

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(name)
    deletion.onsuccess = () => resolve()
    deletion.onerror = () =>
      reject(deletion.error ?? new Error(`Couldn't delete ${name}`))
    deletion.onblocked = () => resolve()
  })

const databaseMissesStore = (name: string, storeName: string) =>
  new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onerror = () =>
      reject(request.error ?? new Error(`Couldn't open ${name}`))
    request.onsuccess = () => {
      const database = request.result
      const missing = !database.objectStoreNames.contains(storeName)
      database.close()
      resolve(missing)
    }
  })

export const restoreDatabaseVersion = async (name: string, version: number) => {
  const listed = await indexedDB.databases()
  const current = listed.find((info) => info.name === name)?.version ?? 0
  if (current === 0) return
  if (current > version || (await databaseMissesStore(name, 'chats'))) {
    await deleteDatabase(name)
  }
}

export const resetBrowserState = async () => {
  closeAllConnections()
  resetRepoBackend()
  closeRegisteredDatabases()
  const present = await listedDatabaseNames()
  for (const name of databaseNamesForReset()) {
    if (!present.has(name)) continue
    await clearDatabase(name)
  }
  localStorage.clear()
  sessionStorage.clear()
  context.reset()
}
