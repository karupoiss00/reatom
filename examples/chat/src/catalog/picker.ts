import { atom, computed } from '@reatom/core'

import { favoriteModels, recentModels } from '../storage/prefs'
import { catalogById, catalogModels } from './catalog'
import { isCustomModelId } from './favorites'
import type { CatalogModel, PickerSections } from './types'

export type PickerSort = 'match' | 'price' | 'context'

const longContextThreshold = 200_000
const recentLimit = 5

const pickModels = (ids: string[], byId: Map<string, CatalogModel>) =>
  ids.flatMap((id) => {
    const model = byId.get(id)
    return model ? [model] : []
  })

const matchLength = (model: CatalogModel, normalizedQuery: string) => {
  const name = model.name.toLowerCase()
  return name.includes(normalizedQuery) ? name.length : Number.POSITIVE_INFINITY
}

const compareModelId = (left: CatalogModel, right: CatalogModel) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0

const compareKnownAsc = (left: number, right: number) => {
  const leftKnown = Number.isFinite(left)
  const rightKnown = Number.isFinite(right)
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
  if (!leftKnown || left === right) return 0
  return left < right ? -1 : 1
}

const compareKnownDesc = (left: number, right: number) => {
  const leftKnown = Number.isFinite(left)
  const rightKnown = Number.isFinite(right)
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1
  if (!leftKnown || left === right) return 0
  return left > right ? -1 : 1
}

const comparePrice = (left: CatalogModel, right: CatalogModel) =>
  compareKnownAsc(left.promptPrice, right.promptPrice) ||
  compareModelId(left, right)

const sortModels = (
  models: CatalogModel[],
  sortMode: PickerSort,
  normalizedQuery: string,
) => {
  const sorted = [...models]
  if (sortMode === 'price') {
    sorted.sort(comparePrice)
  } else if (sortMode === 'context') {
    sorted.sort(
      (left, right) =>
        compareKnownDesc(left.contextLength, right.contextLength) ||
        comparePrice(left, right),
    )
  } else if (normalizedQuery) {
    sorted.sort((left, right) => {
      const leftLength = matchLength(left, normalizedQuery)
      const rightLength = matchLength(right, normalizedQuery)
      if (leftLength !== rightLength) {
        const lengthOrder = compareKnownAsc(leftLength, rightLength)
        if (lengthOrder !== 0) return lengthOrder
      }
      return comparePrice(left, right)
    })
  }
  return sorted
}

export const reatomPicker = (name: string) => {
  const query = atom('', `${name}.query`)
  const chips = {
    free: atom(false, `${name}.chips.free`),
    reasoning: atom(false, `${name}.chips.reasoning`),
    images: atom(false, `${name}.chips.images`),
    longContext: atom(false, `${name}.chips.longContext`),
  }
  const sort = atom<PickerSort>('match', `${name}.sort`)
  const allExpanded = atom(false, `${name}.allExpanded`)

  const sections = computed((): PickerSections => {
    const normalizedQuery = query().trim().toLowerCase()
    const isFreeOnly = chips.free()
    const isReasoningOnly = chips.reasoning()
    const isImagesOnly = chips.images()
    const isLongContextOnly = chips.longContext()
    const byId = catalogById()

    const matches = (model: CatalogModel) =>
      (normalizedQuery === '' ||
        model.name.toLowerCase().includes(normalizedQuery) ||
        model.id.toLowerCase().includes(normalizedQuery)) &&
      (!isFreeOnly || model.isFree) &&
      (!isReasoningOnly || model.isReasoning) &&
      (!isImagesOnly || model.inputModalities.includes('image')) &&
      (!isLongContextOnly ||
        (Number.isFinite(model.contextLength) &&
          model.contextLength >= longContextThreshold))

    const favorites = pickModels(favoriteModels(), byId).filter(matches)
    const recent = pickModels(recentModels(), byId)
      .filter(matches)
      .slice(0, recentLimit)
    const all = sortModels(
      catalogModels().filter(matches),
      sort(),
      normalizedQuery,
    )
    const typedId = query().trim()
    const customOffer =
      isCustomModelId(typedId) &&
      favorites.length === 0 &&
      recent.length === 0 &&
      all.length === 0 &&
      !byId.has(typedId)
        ? typedId
        : null

    return {
      favorites,
      recent,
      all,
      allCount: all.length,
      customOffer,
    }
  }, `${name}.sections`)

  return { query, chips, sort, sections, allExpanded }
}
