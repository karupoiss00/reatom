import { formatPricePair } from '../money'
import type { ReasoningEffort } from '../storage/types'
import type { CatalogModel } from './types'

const efforts = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const readField = (
  record: Record<string, unknown>,
  ...keys: string[]
): unknown => {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const readFinite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const unknownPrice = Number.NaN

const priceText = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : String(value)

const parseUsd = (raw: string): number => {
  if (raw === '') return unknownPrice
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return unknownPrice
  return value
}

const knownNumber = (value: unknown): value is number =>
  typeof value === 'number'

const readEfforts = (
  reasoning: Record<string, unknown> | null,
): ReasoningEffort[] | null => {
  if (!reasoning) return null
  const raw = readField(reasoning, 'supportedEfforts', 'supported_efforts')
  if (!Array.isArray(raw)) return null
  return raw.filter((item): item is ReasoningEffort =>
    efforts.has(item as ReasoningEffort),
  )
}

export const isCatalogModel = (value: unknown): value is CatalogModel => {
  const model = asRecord(value)
  if (!model) return false
  return (
    readString(model.id) !== null &&
    typeof model.name === 'string' &&
    knownNumber(model.contextLength) &&
    knownNumber(model.promptPrice) &&
    knownNumber(model.completionPrice) &&
    (model.webSearchPrice === null ||
      (knownNumber(model.webSearchPrice) &&
        Number.isFinite(model.webSearchPrice))) &&
    typeof model.isFree === 'boolean' &&
    Array.isArray(model.inputModalities) &&
    Array.isArray(model.supportedParameters) &&
    (model.supportedEfforts === null || Array.isArray(model.supportedEfforts)) &&
    (model.maxCompletionTokens === null ||
      readFinite(model.maxCompletionTokens) !== null) &&
    typeof model.isModerated === 'boolean' &&
    typeof model.isReasoning === 'boolean' &&
    (model.created === undefined ||
      model.created === null ||
      (typeof model.created === 'number' && Number.isFinite(model.created)))
  )
}

const readCreatedMs = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const milliseconds = value < 1e11 ? value * 1000 : value
  return Math.round(milliseconds)
}

export const catalogModelsFromSnapshot = (snapshot: unknown): CatalogModel[] =>
  Array.isArray(snapshot) ? snapshot.filter(isCatalogModel) : []

export const normalizeModel = (wire: unknown): CatalogModel | null => {
  const record = asRecord(wire)
  if (!record) return null
  const id = readString(record.id)
  const name = readString(record.name)
  if (!id || !name) return null

  const pricing = asRecord(readField(record, 'pricing')) ?? {}
  const promptRaw = priceText(readField(pricing, 'prompt'))
  const completionRaw = priceText(readField(pricing, 'completion'))
  const webRaw = readField(pricing, 'webSearch', 'web_search')
  const webText = typeof webRaw === 'string' ? webRaw : ''
  const webValue = webText === '' ? Number.NaN : Number(webText)

  const architecture = asRecord(readField(record, 'architecture')) ?? {}
  const top =
    asRecord(readField(record, 'topProvider', 'top_provider')) ?? {}
  const reasoning = asRecord(readField(record, 'reasoning'))
  const supportedParameters = readStringList(
    readField(record, 'supportedParameters', 'supported_parameters'),
  )
  const supportedEfforts = readEfforts(reasoning)
  const contextRaw = readField(record, 'contextLength', 'context_length')
  const contextValue = readFinite(contextRaw)
  const contextLength =
    contextValue !== null && contextValue >= 0 ? contextValue : unknownPrice
  const maxRaw = readField(top, 'maxCompletionTokens', 'max_completion_tokens')

  return {
    id,
    name,
    contextLength,
    promptPrice: parseUsd(promptRaw),
    completionPrice: parseUsd(completionRaw),
    webSearchPrice:
      Number.isFinite(webValue) && webValue >= 0 ? webValue : null,
    isFree: promptRaw === '0' && completionRaw === '0',
    inputModalities: readStringList(
      readField(architecture, 'inputModalities', 'input_modalities'),
    ),
    supportedParameters,
    supportedEfforts,
    maxCompletionTokens: readFinite(maxRaw),
    isModerated:
      readField(top, 'isModerated', 'is_moderated') === true,
    isReasoning:
      reasoning !== null ||
      supportedParameters.includes('reasoning') ||
      supportedParameters.includes('reasoning_effort'),
    created: readCreatedMs(readField(record, 'created')),
  }
}

export const modelPriceLabel = (model: CatalogModel): string =>
  formatPricePair(model)
