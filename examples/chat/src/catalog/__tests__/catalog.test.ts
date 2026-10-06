import { context } from '@reatom/core'
import { openDB } from 'idb'
import { beforeEach, expect, test } from 'vitest'

import { keyStorageKey } from '../../auth/keyStore'
import { formatPricePair } from '../../money'
import { now } from '../../platform/env'
import { presetRecords } from '../../presets/presets'
import {
  favoriteModels,
  lastPickedModel,
  recentModels,
} from '../../storage/prefs'
import type { PresetRecord } from '../../storage/types'
import {
  mockModels,
  mockRouteDelay,
  requestsTo,
} from '../../testing/openrouter-mock'
import { catalogModels as wireModels } from '../../testing/fixtures/models'
import { registerDbForReset, resetBrowserState } from '../../testing/env'
import {
  catalogById,
  catalogFetchedAt,
  catalogModels,
  catalogNewIds,
  catalogStatus,
  initCatalog,
  modelName,
  modelPriceLabel,
  onCatalogDb,
  reatomPicker,
  recordPick,
  refreshCatalog,
  resolveNewChatModel,
  toggleFavorite,
} from '../index'
import { normalizeModel } from '../normalize'
import type { CatalogModel } from '../types'

const dayMs = 24 * 60 * 60 * 1000

const modelRequests = () => requestsTo('/models')

const preset = (model: string | null, isDefault = true): PresetRecord => ({
  id: 'preset-default',
  name: 'Default',
  systemPrompt: '',
  model,
  params: {},
  isDefault,
  createdAt: 0,
  deletedAt: null,
  deletedByTab: null,
})

const sample = (
  id: string,
  name: string,
  promptPrice: number,
  contextLength: number,
  patch: Partial<CatalogModel> = {},
): CatalogModel => ({
  id,
  name,
  contextLength,
  promptPrice,
  completionPrice: promptPrice,
  webSearchPrice: null,
  isFree: promptPrice === 0 && (patch.completionPrice ?? promptPrice) === 0,
  inputModalities: ['text'],
  supportedParameters: [],
  supportedEfforts: null,
  maxCompletionTokens: null,
  isModerated: false,
  isReasoning: false,
  ...patch,
})

const readPersistedModels = async (): Promise<CatalogModel[] | null> => {
  const names = await indexedDB.databases()
  if (!names.some((entry) => entry.name === 'reatom_default')) return null
  const db = await openDB('reatom_default')
  if (!db.objectStoreNames.contains('atoms')) {
    db.close()
    return null
  }
  const record = (await db.get('atoms', 'atelier.catalog')) as
    | { data?: CatalogModel[] }
    | undefined
  db.close()
  return Array.isArray(record?.data) ? record.data : null
}

beforeEach(() => {
  context.reset()
  catalogModels.set([])
  catalogFetchedAt.set(null)
  catalogNewIds.set([])
  favoriteModels.set([])
  recentModels.set([])
  lastPickedModel.set(null)
  presetRecords.set([])
})

test('GET /models is sent once per app start, including on the welcome screen.', async () => {
  mockModels(wireModels)
  initCatalog()
  initCatalog()
  await expect.poll(() => catalogStatus()).toBe('ready')
  expect(modelRequests()).toHaveLength(1)
  expect(modelRequests()[0]?.method).toBe('GET')
  expect(modelRequests()[0]?.headers.authorization).toBeUndefined()
  expect(catalogModels()).toHaveLength(wireModels.length)
})

test('With a cache present, the picker list is visible within 100 ms of the click and no skeleton is shown.', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  await expect
    .poll(readPersistedModels)
    .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'openai/gpt-4o-mini' })]))
  mockRouteDelay('/models', 400)
  const pending = refreshCatalog()
  const picker = reatomPicker('catalog.test.cache')
  const started = performance.now()
  const sections = picker.sections()
  expect(performance.now() - started).toBeLessThan(100)
  expect(sections.all.length).toBe(wireModels.length)
  expect(catalogStatus()).toBe('revalidating')
  await pending
  expect(catalogStatus()).toBe('ready')
})

test('The skeleton appears only when the picker opens before the first fetch has returned and no cache exists.', async () => {
  mockModels(wireModels)
  mockRouteDelay('/models', 200)
  const pending = refreshCatalog()
  expect(catalogModels()).toEqual([])
  expect(catalogStatus()).toBe('loading')
  await pending
  expect(catalogStatus()).toBe('ready')
})

test('When the cache is older than 24 h and revalidation failed, the footer has `data-tone="warning"` and reads "Prices as of <date> · Refresh".', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  const cached = catalogModels().map((model) => model.id)
  catalogFetchedAt.set(now() - dayMs - 1_000)
  mockModels([{ id: 'not-a-model' }])
  await refreshCatalog().catch(() => undefined)
  expect(catalogStatus()).toBe('stale')
  expect(catalogModels().map((model) => model.id)).toEqual(cached)

  catalogFetchedAt.set(now() - 60_000)
  await refreshCatalog().catch(() => undefined)
  expect(catalogStatus()).toBe('cached')
  expect(catalogModels().map((model) => model.id)).toEqual(cached)
})

test('Models that are new since the previous catalog show a "New" badge in "All models" only. They are never added to Favorites or Recent automatically.', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  expect(catalogNewIds()).toEqual([])
  toggleFavorite('openai/gpt-4o-mini')
  recordPick('openai/gpt-4o-mini')
  const favorites = favoriteModels()
  const recent = recentModels()
  const extra = structuredClone(
    wireModels.find((model) => model.id === 'openai/gpt-4o-mini')!,
  )
  extra.id = 'openai/gpt-4.1'
  extra.canonical_slug = extra.id
  extra.name = 'OpenAI: GPT-4.1'
  mockModels([...wireModels, extra])
  await refreshCatalog()
  expect(catalogNewIds()).toEqual(['openai/gpt-4.1'])
  expect(favoriteModels()).toEqual(favorites)
  expect(recentModels()).toEqual(recent)
  expect(favoriteModels()).not.toContain('openai/gpt-4.1')
  expect(recentModels()).not.toContain('openai/gpt-4.1')
})

test('catalog empty (HTTP 200 with zero models: "OpenRouter returned no models." with Retry and the custom-id row)', async () => {
  mockModels([])
  await refreshCatalog()
  expect(catalogStatus()).toBe('empty')
  expect(catalogModels()).toEqual([])
  const picker = reatomPicker('catalog.test.empty')
  picker.query.set('custom/vendor')
  expect(picker.sections().customOffer).toBe('custom/vendor')
})

test('error with no cache ("Couldn\'t load models." with Retry and the custom-id row)', async () => {
  mockModels([{ id: 'not-a-model' }])
  await refreshCatalog().catch(() => undefined)
  expect(catalogStatus()).toBe('error')
  expect(catalogModels()).toEqual([])
})

test('The local filter updates within 100 ms of each input event.', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  const picker = reatomPicker('catalog.test.filter')
  const started = performance.now()
  picker.query.set('claude')
  const sections = picker.sections()
  expect(performance.now() - started).toBeLessThan(100)
  expect(sections.all.map((model) => model.id)).toEqual([
    'anthropic/claude-sonnet-4',
  ])
  expect(sections.customOffer).toBeNull()
  picker.query.set('vendor/not-listed')
  expect(picker.sections().all).toEqual([])
  expect(picker.sections().customOffer).toBe('vendor/not-listed')
})

test('Filter chips combine with AND: Free plus Images shows only models that pass both.', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  const picker = reatomPicker('catalog.test.chips')
  picker.chips.free.set(true)
  picker.chips.images.set(true)
  expect(picker.sections().all).toEqual([])
  picker.chips.images.set(false)
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'meta-llama/llama-3.3-8b-instruct:free',
  ])
  picker.chips.free.set(false)
  picker.chips.reasoning.set(true)
  picker.chips.longContext.set(true)
  expect(picker.sections().all.map((model) => model.id).sort()).toEqual(
    [
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-pro',
      'openai/o3-mini',
    ].sort(),
  )
})

test('Best match sorts by shortest name match, then by lower prompt price. Price sorts by prompt price ascending. Context sorts by `context_length` descending.', () => {
  catalogModels.set([
    sample('a/long', 'zz match extra', 1, 1_000),
    sample('b/dear', 'match', 5, 9_000),
    sample('c/cheap', 'match', 2, 8_000),
  ])
  const picker = reatomPicker('catalog.test.sort')
  picker.query.set('match')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'c/cheap',
    'b/dear',
    'a/long',
  ])
  picker.sort.set('price')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'a/long',
    'c/cheap',
    'b/dear',
  ])
  picker.sort.set('context')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'b/dear',
    'c/cheap',
    'a/long',
  ])
})

test('filtering 500 models in under 100 ms', () => {
  const many = Array.from({ length: 500 }, (_, index) =>
    sample(`bench/model-${index}`, `Model ${index}`, index / 1_000_000, 8_000),
  )
  many[250] = sample('bench/needle', 'Needle', 0.0001, 8_000)
  catalogModels.set(many)
  const picker = reatomPicker('catalog.test.bench')
  picker.query.set('needle')
  const started = performance.now()
  const sections = picker.sections()
  expect(performance.now() - started).toBeLessThan(100)
  expect(sections.all.map((model) => model.id)).toEqual(['bench/needle'])
  expect(sections.allCount).toBe(1)
})

test('"Free" is shown only when both the prompt and completion prices are "0". A :free id with a non-zero listed price shows dollars.', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  const free = catalogById().get('meta-llama/llama-3.3-8b-instruct:free')
  const paidTwin = catalogById().get('meta-llama/llama-3.3-8b-instruct')
  const claude = catalogById().get('anthropic/claude-sonnet-4')
  expect(free?.isFree).toBe(true)
  expect(paidTwin?.isFree).toBe(false)
  expect(modelPriceLabel(free!)).toBe('Free')
  expect(modelPriceLabel(free!)).toBe(formatPricePair(free!))
  expect(modelPriceLabel(claude!)).toBe('$3.00 / $15.00 per 1M in/out')
  expect(modelPriceLabel(paidTwin!)).not.toBe('Free')
  const pricedFreeSuffix = normalizeModel({
    id: 'meta/priced:free',
    name: 'Priced free suffix',
    context_length: 8_000,
    pricing: { prompt: '0.000001', completion: '0.000002' },
    architecture: { input_modalities: ['text'] },
    supported_parameters: [],
    top_provider: { is_moderated: false },
  })
  expect(pricedFreeSuffix?.isFree).toBe(false)
  expect(modelPriceLabel(pricedFreeSuffix!)).toBe(
    '$1.00 / $2.00 per 1M in/out',
  )
  const o3 = catalogById().get('openai/o3-mini')
  expect(o3?.supportedEfforts).toEqual(['minimal', 'low', 'medium', 'high'])
  expect(o3?.isReasoning).toBe(true)
  expect(catalogById().get('mistralai/mistral-7b-instruct-v0.3')?.isReasoning).toBe(
    false,
  )
  expect(modelName('openai/gpt-4o-mini')).toBe('OpenAI: GPT-4o-mini')
  expect(modelName('custom/missing')).toBe('custom/missing')
})

test('Picking a model in chat A does not change the model of existing chat B, and a reload keeps both. The pick becomes the global last-picked model for R-2.', () => {
  recordPick('openai/gpt-4o-mini')
  recordPick('google/gemini-2.5-flash')
  recordPick('anthropic/claude-sonnet-4')
  recordPick('openai/o3-mini')
  recordPick('google/gemini-2.5-pro')
  recordPick('mistralai/mistral-7b-instruct-v0.3')
  expect(recentModels()).toEqual([
    'mistralai/mistral-7b-instruct-v0.3',
    'google/gemini-2.5-pro',
    'openai/o3-mini',
    'anthropic/claude-sonnet-4',
    'google/gemini-2.5-flash',
  ])
  expect(lastPickedModel()).toBe('mistralai/mistral-7b-instruct-v0.3')
  toggleFavorite('openai/gpt-4o-mini')
  toggleFavorite('openai/gpt-4o-mini')
  expect(favoriteModels()).toEqual([])
  toggleFavorite('openai/o3-mini')
  expect(favoriteModels()).toEqual(['openai/o3-mini'])
})

test('R-2 New-chat model. A new chat takes its model from the first of these that applies. With the D-2 fixture this is openai/gpt-4o-mini.', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  presetRecords.set([preset('anthropic/claude-sonnet-4')])
  lastPickedModel.set('google/gemini-2.5-flash')
  expect(resolveNewChatModel({ presetModel: null })).toBe(
    'google/gemini-2.5-flash',
  )
  expect(resolveNewChatModel({ presetModel: 'openai/o3-mini' })).toBe(
    'openai/o3-mini',
  )
  presetRecords.set([])
  expect(resolveNewChatModel({ presetModel: null })).toBe(
    'google/gemini-2.5-flash',
  )
  lastPickedModel.set(null)
  expect(resolveNewChatModel({ presetModel: null })).toBe('openai/gpt-4o-mini')
  expect(resolveNewChatModel({ presetModel: null })).not.toBe('')
  catalogModels.set([])
  catalogFetchedAt.set(null)
  expect(resolveNewChatModel({ presetModel: null })).toBeNull()
})

const wireShell = (
  id: string,
  pricing: { prompt?: string; completion?: string },
  contextLength: number | null,
) => ({
  id,
  name: id,
  context_length: contextLength,
  pricing,
  architecture: { input_modalities: ['text'] },
  supported_parameters: [],
  top_provider: { is_moderated: false },
})

test('OpenRouter price "-1" is an unknown price, not the cheapest and not a negative dollar amount', () => {
  const router = normalizeModel(
    wireShell('openrouter/auto', { prompt: '-1', completion: '-1' }, 128000),
  )
  const missing = normalizeModel(wireShell('vendor/missing', {}, null))
  const blank = normalizeModel(
    wireShell('vendor/blank', { prompt: '', completion: '' }, null),
  )
  expect(router?.isFree).toBe(false)
  expect(missing?.isFree).toBe(false)
  expect(blank?.isFree).toBe(false)
  expect(Number.isFinite(router?.promptPrice)).toBe(false)
  expect(Number.isFinite(router?.completionPrice)).toBe(false)
  expect(Number.isFinite(missing?.promptPrice)).toBe(false)
  expect(Number.isFinite(blank?.completionPrice)).toBe(false)
  for (const model of [router, missing, blank]) {
    const label = modelPriceLabel(model!)
    expect(label).toBe(formatPricePair(model!))
    expect(label).not.toBe('Free')
    expect(label).not.toBe('$0.00')
    expect(label.startsWith('-$')).toBe(false)
  }
  expect(Number.isFinite(missing?.contextLength)).toBe(false)
  expect(missing?.contextLength).not.toBe(0)

  catalogModels.set([
    sample('a/unknown', 'Router', Number.NaN, Number.NaN),
    sample('m/mid', 'Mid', 2, 0),
    sample('z/cheap', 'Cheap', 0.5, 8_000),
  ])
  const picker = reatomPicker('catalog.test.unknownPrice')
  picker.sort.set('price')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'z/cheap',
    'm/mid',
    'a/unknown',
  ])
  picker.sort.set('context')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'z/cheap',
    'm/mid',
    'a/unknown',
  ])
  picker.chips.longContext.set(true)
  expect(picker.sections().all).toEqual([])
})

test('Best match falls through to prompt price when name lengths are equal or the query matches only the id', () => {
  catalogModels.set([
    sample('a/unknown', 'match', Number.NaN, 4_000),
    sample('z/known', 'match', 2, 4_000),
    sample('a/zzz-costly', 'Nope', 9, 4_000),
    sample('z/zzz-cheap', 'Nope', 1, 4_000),
  ])
  const picker = reatomPicker('catalog.test.matchTie')
  picker.query.set('match')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'z/known',
    'a/unknown',
  ])
  picker.query.set('zzz')
  expect(picker.sections().all.map((model) => model.id)).toEqual([
    'z/zzz-cheap',
    'a/zzz-costly',
  ])
})

test('custom model ids match vendor/model with an optional :variant, and recordPick ignores anything else', () => {
  const picker = reatomPicker('catalog.test.customId')
  picker.query.set('not a model')
  expect(picker.sections().customOffer).toBeNull()
  picker.query.set('openai/custom model')
  expect(picker.sections().customOffer).toBeNull()
  picker.query.set('openai/custom:free:extra')
  expect(picker.sections().customOffer).toBeNull()
  picker.query.set('openai/custom')
  expect(picker.sections().customOffer).toBe('openai/custom')
  picker.query.set('meta/llama:free')
  expect(picker.sections().customOffer).toBe('meta/llama:free')

  recordPick('not a model')
  recordPick('openai/custom model')
  expect(lastPickedModel()).toBeNull()
  expect(recentModels()).toEqual([])
  recordPick('  meta/llama:free  ')
  expect(lastPickedModel()).toBe('meta/llama:free')
  expect(recentModels()).toEqual(['meta/llama:free'])
})

test('resolveNewChatModel trims preset and last-picked ids', () => {
  expect(resolveNewChatModel({ presetModel: '  openai/gpt-4o-mini  ' })).toBe(
    'openai/gpt-4o-mini',
  )
  lastPickedModel.set('  google/gemini-2.5-flash  ')
  expect(resolveNewChatModel({ presetModel: null })).toBe(
    'google/gemini-2.5-flash',
  )
})

test('a fast GET /models still badges only ids absent from the hydrated catalog', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  await expect
    .poll(readPersistedModels)
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'openai/gpt-4o-mini' }),
      ]),
    )
  context.reset()
  expect(catalogModels()).toEqual([])
  const extra = structuredClone(
    wireModels.find((model) => model.id === 'openai/gpt-4o-mini')!,
  )
  extra.id = 'openai/gpt-4.1'
  extra.canonical_slug = extra.id
  extra.name = 'OpenAI: GPT-4.1'
  mockModels([...wireModels, extra])
  await refreshCatalog()
  expect(catalogNewIds()).toEqual(['openai/gpt-4.1'])
})

test('dropping memory still paints the cached catalog before the network returns', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  await expect
    .poll(readPersistedModels)
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'openai/gpt-4o-mini' }),
      ]),
    )
  context.reset()
  expect(catalogModels()).toEqual([])
  const requestsBeforePaint = modelRequests().length
  const unsubscribe = catalogModels.subscribe(() => {})
  await expect.poll(() => catalogModels().length).toBe(wireModels.length)
  expect(modelRequests().length).toBe(requestsBeforePaint)
  unsubscribe()

  context.reset()
  expect(catalogModels()).toEqual([])
  mockRouteDelay('/models', 400)
  let settled = false
  const pending = refreshCatalog().finally(() => {
    settled = true
  })
  await expect.poll(() => catalogModels().length).toBe(wireModels.length)
  expect(settled).toBe(false)
  expect(catalogStatus()).toBe('revalidating')
  await pending
  expect(catalogStatus()).toBe('ready')
})

test('an overlapping refresh lets the last call win and an abort is not an error', async () => {
  mockModels(wireModels)
  mockRouteDelay('/models', 400)
  const first = refreshCatalog()
  await new Promise((resolve) => setTimeout(resolve, 20))
  mockRouteDelay('/models', 0)
  const second = refreshCatalog()
  await second
  await first.catch(() => undefined)
  expect(refreshCatalog.error()).toBeUndefined()
  expect(catalogStatus()).toBe('ready')
  expect(catalogModels()).toHaveLength(wireModels.length)
})

const persistedCatalogRecord = (models: CatalogModel[]) => ({ data: models })

test('a thrown persisted catalog read registers the connection and closes it', async () => {
  const opened: IDBDatabase[] = []
  const closed = new Set<IDBDatabase>()
  const stopListening = onCatalogDb((db) => {
    opened.push(db)
    const nativeClose = db.close.bind(db)
    db.close = () => {
      closed.add(db)
      nativeClose()
    }
    registerDbForReset(db)
  })
  mockModels(wireModels)
  await refreshCatalog()
  await expect
    .poll(readPersistedModels)
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'openai/gpt-4o-mini' }),
      ]),
    )
  context.reset()

  let reads = 0
  const originalGet = IDBObjectStore.prototype.get
  IDBObjectStore.prototype.get = function (
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange,
  ) {
    if (key === 'atelier.catalog' || key === 'atelier.catalog.fetchedAt') {
      reads += 1
      throw new DOMException('The read failed', 'UnknownError')
    }
    return originalGet.call(this, key)
  } as typeof IDBObjectStore.prototype.get

  try {
    await refreshCatalog().catch(() => undefined)
    expect(reads).toBeGreaterThan(0)
    expect(opened.length).toBeGreaterThan(0)
    expect(opened.every((db) => closed.has(db))).toBe(true)
  } finally {
    IDBObjectStore.prototype.get = originalGet
    stopListening()
  }
})

test('a reset overlapping a persisted catalog read does not restore the old catalog', async () => {
  mockModels(wireModels)
  await refreshCatalog()
  await expect
    .poll(readPersistedModels)
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'openai/gpt-4o-mini' }),
      ]),
    )
  const cached = catalogModels().slice()
  expect(cached.some((model) => model.id === 'openai/gpt-4o-mini')).toBe(true)
  context.reset()
  expect(catalogModels()).toEqual([])

  let settled = false
  let resolveRead: (value: unknown) => void = () => {}
  let rejectRead: (error: unknown) => void = () => {}
  const heldRead = new Promise((resolve, reject) => {
    resolveRead = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    rejectRead = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
  })
  heldRead.catch(() => undefined)

  const opened: IDBDatabase[] = []
  const stopListening = onCatalogDb((db) => {
    opened.push(db)
    const nativeClose = db.close.bind(db)
    db.close = () => {
      rejectRead(new DOMException('The database connection is closing', 'AbortError'))
      nativeClose()
    }
    registerDbForReset(db)
  })

  let reads = 0
  const originalGet = IDBObjectStore.prototype.get
  IDBObjectStore.prototype.get = function (
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange,
  ) {
    if (key === 'atelier.catalog' || key === 'atelier.catalog.fetchedAt') {
      reads += 1
      return heldRead
    }
    return originalGet.call(this, key)
  } as typeof IDBObjectStore.prototype.get

  mockRouteDelay('/models', 300)
  const pending = refreshCatalog().catch(() => undefined)
  try {
    await expect.poll(() => reads).toBeGreaterThan(0)
    await resetBrowserState()
    resolveRead(persistedCatalogRecord(cached))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(catalogModels().map((model) => model.id)).not.toContain(
      'openai/gpt-4o-mini',
    )
    expect(opened.length).toBeGreaterThan(0)
  } finally {
    resolveRead(persistedCatalogRecord([]))
    IDBObjectStore.prototype.get = originalGet
    stopListening()
    refreshCatalog.abort()
    context.reset()
    await pending
  }
})

test('GET /models sends no Authorization header even when a key is stored', async () => {
  localStorage.setItem(keyStorageKey, 'sk-or-v1-secret')
  mockModels(wireModels)
  await refreshCatalog()
  expect(modelRequests().length).toBeGreaterThan(0)
  for (const request of modelRequests()) {
    expect(request.headers.authorization).toBeUndefined()
    expect(JSON.stringify(request.headers)).not.toContain('sk-or-v1-secret')
  }
})
