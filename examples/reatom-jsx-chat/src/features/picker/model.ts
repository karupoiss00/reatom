import { action, atom, computed, isAbort, withLocalStorage } from '@reatom/core'

import { ui } from '../../app/ui'
import {
  catalogById,
  catalogFetchedAt,
  catalogModels,
  catalogStatus,
  refreshCatalog,
  reatomPicker,
} from '../../catalog'
import type { CatalogModel, CatalogStatus } from '../../catalog'
import {
  armCompareModels,
  compareSession,
  sameModelNote,
  syncCompareEstimate,
} from '../../chat/compare'
import { activeChat } from '../../chat/chatModel'
import { now } from '../../platform/env'
import { favoriteModels, recentModels } from '../../storage/prefs'

export const picker = reatomPicker('features.picker')

export const pickerOpen = atom(false, 'features.picker.open')

export const cursor = atom(0, 'features.picker.cursor')

const readCustomIds = (snapshot: unknown) =>
  Array.isArray(snapshot) && snapshot.every((item) => typeof item === 'string')
    ? snapshot
    : []

export const customModelIds = atom<string[]>(
  [],
  'features.picker.customModelIds',
).extend(
  withLocalStorage({
    key: 'atelier.customModelIds',
    fromSnapshot: readCustomIds,
  }),
)

export type PickerRow =
  | {
      key: string
      kind: 'model'
      section: 'favorites' | 'recent' | 'all'
      model: CatalogModel
    }
  | { key: string; kind: 'custom'; id: string }

const minute = 60
const hour = 60 * minute
const day = 24 * hour

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export const catalogDate = (at: number): string =>
  new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: deviceTimeZone(),
  }).format(new Date(at))

export const catalogRelativeTime = (at: number, nowAt = now()): string => {
  const seconds = Math.round((nowAt - at) / 1000)
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  if (Math.abs(seconds) < 45) return 'just now'
  const minutes = Math.round(seconds / minute)
  if (Math.abs(minutes) < 60) return format.format(-minutes, 'minute')
  const hours = Math.round(seconds / hour)
  if (Math.abs(hours) < 24) return format.format(-hours, 'hour')
  const days = Math.round(seconds / day)
  if (Math.abs(days) < 30) return format.format(-days, 'day')
  return catalogDate(at)
}

export const catalogFooterLead = (
  status: CatalogStatus,
  fetchedAt: number | null,
  nowAt = now(),
): { tone: 'warning' | 'neutral'; lead: string } => {
  if (status === 'stale' && fetchedAt !== null) {
    return {
      tone: 'warning',
      lead: `Prices as of ${catalogDate(fetchedAt)}`,
    }
  }
  if (fetchedAt === null) return { tone: 'neutral', lead: 'Catalog updated' }
  return {
    tone: 'neutral',
    lead: `Catalog updated ${catalogRelativeTime(fetchedAt, nowAt)}`,
  }
}

export const compareMode = atom(false, 'features.picker.compareMode')

export const comparePicks = atom<string[]>([], 'features.picker.comparePicks')

const clearArmedCompare = () => {
  const session = compareSession()
  if (session?.phase !== 'armed' || session.chatId !== activeChat().id) return
  compareSession.set(null)
  syncCompareEstimate(false)
}

export const syncCompareChrome = () => {
  const session = compareSession()
  const chatId = activeChat().id
  if (session && session.chatId === chatId && session.phase === 'armed') {
    comparePicks.set([session.models[0], session.models[1]])
    compareMode.set(true)
    return
  }
  comparePicks.set([])
  if (session?.phase !== 'pending' || session.chatId !== chatId) {
    compareMode.set(false)
  }
}

export const toggleCompareModel = (modelId: string) => {
  const trimmed = modelId.trim()
  if (!trimmed || compareSession()?.phase === 'pending') return
  const current = comparePicks()
  if (current.includes(trimmed)) {
    if (current.length < 2) {
      sameModelNote.set(true)
      return
    }
    comparePicks.set(current.filter((id) => id !== trimmed))
    sameModelNote.set(false)
    clearArmedCompare()
    return
  }
  if (current.length >= 2) return
  sameModelNote.set(false)
  const next = [...current, trimmed]
  comparePicks.set(next)
  if (next.length === 2) armCompareModels([next[0]!, next[1]!])
}

export const modelReleaseLabel = (created: number | null | undefined): string | null => {
  if (typeof created !== 'number' || !Number.isFinite(created) || created <= 0) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(created))
}

export const filtering = computed(() => {
  const typed = picker.query().trim()
  return (
    typed.length > 0 ||
    picker.chips.free() ||
    picker.chips.reasoning() ||
    picker.chips.images() ||
    picker.chips.longContext()
  )
}, 'features.picker.filtering')

export const listed = computed((): PickerRow[] => {
  const data = picker.sections()
  const rows: PickerRow[] = []
  for (const model of data.favorites) {
    rows.push({
      key: `favorites:${model.id}`,
      kind: 'model',
      section: 'favorites',
      model,
    })
  }
  for (const model of data.recent) {
    rows.push({
      key: `recent:${model.id}`,
      kind: 'model',
      section: 'recent',
      model,
    })
  }
  for (const model of data.all) {
    rows.push({
      key: `all:${model.id}`,
      kind: 'model',
      section: 'all',
      model,
    })
  }
  if (data.customOffer) {
    rows.push({
      key: `custom:${data.customOffer}`,
      kind: 'custom',
      id: data.customOffer,
    })
  }
  return rows
}, 'features.picker.listed')

export const activeIndex = computed(() => {
  const count = listed().length
  if (count === 0) return -1
  return Math.min(cursor(), count - 1)
}, 'features.picker.activeIndex')

export const optionDomId = (key: string) =>
  `model-option-${key.replace(/[^a-z0-9]+/gi, '-')}`

export const noteCustomModel = action((modelId: string): void => {
  const id = modelId.trim()
  if (!id || catalogById().has(id)) return
  customModelIds.set((ids) => (ids.includes(id) ? ids : [...ids, id]))
}, 'features.picker.noteCustomModel')

const shortcutsEmpty = () =>
  favoriteModels().length === 0 && recentModels().length === 0

const resetPicker = () => {
  picker.query.set('')
  picker.chips.free.set(false)
  picker.chips.reasoning.set(false)
  picker.chips.images.set(false)
  picker.chips.longContext.set(false)
  picker.sort.set('match')
  picker.allExpanded.set(shortcutsEmpty())
  cursor.set(0)
}

export const refreshFailedNote = atom<string | null>(
  null,
  'features.picker.refreshFailedNote',
)

let closeRequested = false
let dismissGeneration = 0

export const closePicker = () => {
  dismissGeneration += 1
  closeRequested = true
  ui.picker.set(null)
  queueMicrotask(() => {
    document.querySelector<HTMLElement>('[data-slot="ModelChip"]')?.focus()
  })
}

export const pickerEpoch = atom(0, 'features.picker.epoch')

export const finishPickerDismiss = () => {
  if (closeRequested || ui.picker() === null) {
    closeRequested = false
    return
  }
  const generation = ++dismissGeneration
  queueMicrotask(() => {
    if (
      generation !== dismissGeneration ||
      closeRequested ||
      ui.picker() === null
    ) {
      return
    }
    pickerEpoch.set((epoch) => epoch + 1)
    pickerOpen.set(false)
    pickerOpen.set(true)
  })
}

const showRefreshFailed = () => {
  const error = refreshCatalog.error()
  if (!error) {
    refreshFailedNote.set(null)
    return
  }
  if (isAbort(error)) return
  if (catalogModels().length === 0 || catalogStatus() === 'stale') {
    refreshFailedNote.set(null)
    return
  }
  const fetchedAt = catalogFetchedAt()
  const when = fetchedAt === null ? 'earlier' : catalogRelativeTime(fetchedAt)
  refreshFailedNote.set(
    `Couldn't refresh models; showing list from ${when}`,
  )
}

export const bindPickerLifecycle = () => {
  let wasOpen = ui.picker() !== null
  let skipCompareMode = true
  const stopCompareMode = compareMode.subscribe((on) => {
    if (skipCompareMode || on) return
    comparePicks.set([])
    sameModelNote.set(false)
    clearArmedCompare()
  })
  skipCompareMode = false
  const stopOpen = ui.picker.subscribe((request) => {
    const isOpen = request !== null
    pickerOpen.set(isOpen)
    if (isOpen && !wasOpen) {
      resetPicker()
      if (request?.purpose === 'chat') syncCompareChrome()
    }
    wasOpen = isOpen
  })
  const onEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || ui.picker() === null) return
    event.preventDefault()
    closePicker()
  }
  window.addEventListener('keydown', onEscape, true)
  const stopQuery = picker.query.subscribe(() => cursor.set(0))
  const stopSort = picker.sort.subscribe(() => cursor.set(0))
  const stopFree = picker.chips.free.subscribe(() => cursor.set(0))
  const stopReasoning = picker.chips.reasoning.subscribe(() => cursor.set(0))
  const stopImages = picker.chips.images.subscribe(() => cursor.set(0))
  const stopLong = picker.chips.longContext.subscribe(() => cursor.set(0))
  const stopError = refreshCatalog.error.subscribe(showRefreshFailed)
  return () => {
    stopCompareMode()
    stopOpen()
    stopQuery()
    window.removeEventListener('keydown', onEscape, true)
    stopSort()
    stopFree()
    stopReasoning()
    stopImages()
    stopLong()
    stopError()
  }
}
