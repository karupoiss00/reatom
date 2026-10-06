import type { ReasoningEffort } from '../storage/types'

export interface CatalogModel {
  id: string
  name: string
  contextLength: number
  promptPrice: number
  completionPrice: number
  webSearchPrice: number | null // USD per token
  isFree: boolean // both prices are exactly "0"
  inputModalities: string[]
  supportedParameters: string[]
  supportedEfforts: ReasoningEffort[] | null
  maxCompletionTokens: number | null
  isModerated: boolean
  isReasoning: boolean
  created?: number | null
}
export type CatalogStatus =
  | 'loading'
  | 'cached'
  | 'revalidating'
  | 'ready'
  | 'stale'
  | 'empty'
  | 'error'
export interface PickerSections {
  favorites: CatalogModel[]
  recent: CatalogModel[]
  all: CatalogModel[]
  allCount: number
  customOffer: string | null // "Use `<typed>` as model id"
}
export interface ProviderInfo {
  slug: string
  name: string
}
