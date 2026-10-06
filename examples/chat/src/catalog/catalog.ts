import type { Model } from '@openrouter/sdk/models'
import {
  abortVar,
  action,
  atom,
  computed,
  isAbort,
  throwAbort,
  withAbort,
  withAsync,
  withIndexedDb,
  wrap,
} from '@reatom/core'
import { openDB } from 'idb'

import { createOpenRouterClient } from '../api/client'
import { now } from '../platform/env'
import { catalogModelsFromSnapshot, normalizeModel } from './normalize'
import type { CatalogModel, CatalogStatus } from './types'

const staleAfterMs = 24 * 60 * 60 * 1000

const publicApiKey = atom('', 'catalog.publicApiKey')
const catalogClient = createOpenRouterClient(publicApiKey)

const catalogConfirmed = atom(false, 'catalog.confirmed')

const fetchedAtFromSnapshot = (snapshot: unknown): number | null =>
  typeof snapshot === 'number' && Number.isFinite(snapshot) ? snapshot : null

export const catalogModels = atom<CatalogModel[]>([], 'catalog.models').extend(
  withIndexedDb({
    key: 'atelier.catalog',
    fromSnapshot: catalogModelsFromSnapshot,
  }),
)

export const catalogById = computed(
  () => new Map(catalogModels().map((model) => [model.id, model])),
  'catalog.byId',
)

export const catalogFetchedAt = atom<number | null>(
  null,
  'catalog.fetchedAt',
).extend(
  withIndexedDb({
    key: 'atelier.catalog.fetchedAt',
    fromSnapshot: fetchedAtFromSnapshot,
  }),
)

export const catalogNewIds = atom<string[]>([], 'catalog.newIds')

const catalogDatabase = 'reatom_default'
const catalogStore = 'atoms'

const catalogDbListeners = new Set<(db: IDBDatabase) => void>()

export const onCatalogDb = (listener: (db: IDBDatabase) => void) => {
  catalogDbListeners.add(listener)
  return () => {
    catalogDbListeners.delete(listener)
  }
}

const notifyCatalogDb = (db: IDBDatabase) => {
  for (const listener of catalogDbListeners) listener(db)
}

const readPersisted = async (key: string): Promise<unknown> => {
  try {
    if (!globalThis.indexedDB?.databases) return undefined
    const names = await indexedDB.databases()
    if (!names.some((entry) => entry.name === catalogDatabase)) return undefined
    const db = await openDB(catalogDatabase)
    try {
      notifyCatalogDb(db as unknown as IDBDatabase)
      if (!db.objectStoreNames.contains(catalogStore)) return undefined
      const record = (await db.get(catalogStore, key)) as
        | { data?: unknown }
        | undefined
      return record?.data
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

const loadWireModels = async (signal: AbortSignal): Promise<Model[]> => {
  const iterator = await catalogClient.models.list(
    {},
    { signal, retries: { strategy: 'none' } },
  )
  const models: Model[] = []
  for await (const page of iterator) {
    models.push(...page.result.data)
  }
  return models
}

const cacheIsStale = (fetchedAt: number | null) =>
  fetchedAt !== null && now() - fetchedAt > staleAfterMs

export const refreshCatalog = action(async (): Promise<void> => {
  const signal = abortVar.require().signal
  const modelsMissing = catalogModels().length === 0
  const fetchedAtMissing = catalogFetchedAt() === null
  let cachedModels: CatalogModel[] = []
  let cachedFetchedAt: number | null = null
  if (modelsMissing || fetchedAtMissing) {
    try {
      const [modelsSnapshot, fetchedAtSnapshot] = await wrap(
        Promise.all([
          modelsMissing
            ? readPersisted('atelier.catalog')
            : Promise.resolve(undefined),
          fetchedAtMissing
            ? readPersisted('atelier.catalog.fetchedAt')
            : Promise.resolve(undefined),
        ]),
      )
      cachedModels = catalogModelsFromSnapshot(modelsSnapshot)
      cachedFetchedAt = fetchedAtFromSnapshot(fetchedAtSnapshot)
    } catch (error) {
      if (isAbort(error) || signal.aborted) throwAbort('catalog.refresh')
      throw error
    }
  }
  if (signal.aborted) throwAbort('catalog.refresh')
  if (catalogModels().length === 0 && cachedModels.length > 0) {
    catalogModels.set(cachedModels)
  }
  if (catalogFetchedAt() === null && cachedFetchedAt !== null) {
    catalogFetchedAt.set(cachedFetchedAt)
  }
  let wire: Model[]
  try {
    wire = await wrap(loadWireModels(signal))
  } catch (error) {
    if (isAbort(error) || signal.aborted) throwAbort('catalog.refresh')
    throw error
  }
  if (signal.aborted) throwAbort('catalog.refresh')

  const next = wire.flatMap((model) => {
    const normalized = normalizeModel(model)
    return normalized ? [normalized] : []
  })
  const previous = catalogModels()
  const previousIds = new Set(previous.map((model) => model.id))
  catalogNewIds.set(
    previous.length === 0
      ? []
      : next.flatMap((model) => (previousIds.has(model.id) ? [] : [model.id])),
  )
  catalogModels.set(next)
  catalogFetchedAt.set(now())
  catalogConfirmed.set(true)
}, 'catalog.refresh').extend(withAsync(), withAbort())

export const catalogStatus = computed((): CatalogStatus => {
  const hasModels = catalogModels().length > 0
  if (!refreshCatalog.ready()) return hasModels ? 'revalidating' : 'loading'
  if (refreshCatalog.error()) {
    if (!hasModels) return 'error'
    if (cacheIsStale(catalogFetchedAt())) return 'stale'
    return 'cached'
  }
  if (!catalogConfirmed() || catalogFetchedAt() === null) {
    return hasModels ? 'cached' : 'loading'
  }
  return hasModels ? 'ready' : 'empty'
}, 'catalog.status')

const catalogInitStarted = atom(false, 'catalog.initStarted')

export const initCatalog = action((): void => {
  if (catalogInitStarted()) return
  catalogInitStarted.set(true)
  refreshCatalog().catch(() => {})
}, 'catalog.init')
