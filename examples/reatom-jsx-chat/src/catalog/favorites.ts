import { action } from '@reatom/core'

import { catalogById } from './catalog'
import {
  favoriteModels,
  lastPickedModel,
  pushRecentModel,
  recentModels,
} from '../storage/prefs'

const customModelIdPattern = /^[^\s/]+\/[^\s/:]+(?::[^\s/:]+)?$/

export const isCustomModelId = (modelId: string) =>
  customModelIdPattern.test(modelId.trim())

export const toggleFavorite = action((modelId: string): void => {
  favoriteModels.set((favorites) =>
    favorites.includes(modelId)
      ? favorites.filter((id) => id !== modelId)
      : [...favorites, modelId],
  )
}, 'catalog.toggleFavorite')

export const recordPick = action((modelId: string): void => {
  const id = modelId.trim()
  if (!isCustomModelId(id) && !catalogById().has(id)) return
  recentModels.set((recent) => pushRecentModel(recent, id))
  lastPickedModel.set(id)
}, 'catalog.recordPick')
