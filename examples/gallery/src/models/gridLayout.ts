import { atom, bind, computed, reatomObservable } from '@reatom/core'

import { quantizeThumbnailBucket } from '../image-engine/decodePolicy'
import { GRID_GAP_VALUES } from '../types'
import { gridColumns, gridGap } from './view'
import { devicePixelRatio } from './viewport'

const AUTO_COLUMN_MIN_SIZE = 200
export const MIN_GRID_ITEM_SIZE = 40
const UNMEASURED_MAX_COLUMNS = 100

export type GridDensity = 'comfortable' | 'compact' | 'tiny' | 'micro'

export const resolveAutoColumnCount = (width: number, gap: number): number =>
  Math.max(1, Math.floor((width + gap) / (AUTO_COLUMN_MIN_SIZE + gap)))

export const resolveMaxColumnCount = (width: number, gap: number): number => {
  if (width <= 0) return UNMEASURED_MAX_COLUMNS
  return Math.max(1, Math.floor((width + gap) / (MIN_GRID_ITEM_SIZE + gap)))
}

export const resolveRawCellSize = (
  width: number,
  columns: number,
  gap: number,
): number => (columns <= 0 ? 0 : (width - gap * (columns - 1)) / columns)

export const resolveEffectiveGap = (
  rawCellSize: number,
  configuredGap: number,
): number =>
  Math.min(configuredGap, Math.max(2, Math.round(rawCellSize * 0.15)))

export const resolveGridDensity = (itemSize: number): GridDensity => {
  if (itemSize <= 0) return 'comfortable'
  if (itemSize >= 160) return 'comfortable'
  if (itemSize >= 100) return 'compact'
  if (itemSize >= 64) return 'tiny'
  return 'micro'
}

export const imageGrid = atom<HTMLElement | null>(null, 'imageGrid').extend(
  (target) => {
    const width = reatomObservable(
      () => ({
        initState: 0,
        getState: () => {
          const element = target()
          return element ? Math.ceil(element.getBoundingClientRect().width) : 0
        },
        subscribe: (notify) => {
          let observer: ResizeObserver | undefined

          const readWidth = () => {
            const element = target()
            return element
              ? Math.ceil(element.getBoundingClientRect().width)
              : 0
          }

          // ResizeObserver fires outside any Reatom frame; bind restores it.
          const notifyWidth = bind(() => notify(readWidth()))

          const observeElement = () => {
            observer?.disconnect()
            observer = undefined

            const element = target()
            if (!element) return

            notifyWidth()
            observer = new ResizeObserver(notifyWidth)
            observer.observe(element)
          }

          observeElement()
          const stopElementSubscription = target.subscribe(observeElement)

          return () => {
            stopElementSubscription()
            observer?.disconnect()
          }
        },
      }),
      `${target.name}._width`,
    )

    const maxColumnCount = computed(() => {
      const gapAtMinimumCell = resolveEffectiveGap(
        MIN_GRID_ITEM_SIZE,
        GRID_GAP_VALUES[gridGap()],
      )
      return resolveMaxColumnCount(width(), gapAtMinimumCell)
    }, `${target.name}._maxColumnCount`)

    const columnCount = computed(() => {
      const configuredColumns = gridColumns()
      if (configuredColumns === 0) {
        return resolveAutoColumnCount(width(), GRID_GAP_VALUES[gridGap()])
      }

      return Math.min(configuredColumns, maxColumnCount())
    }, `${target.name}._columnCount`)

    const effectiveGap = computed(() => {
      const configuredGap = GRID_GAP_VALUES[gridGap()]
      const rawCell = resolveRawCellSize(width(), columnCount(), configuredGap)
      return resolveEffectiveGap(rawCell, configuredGap)
    }, `${target.name}._effectiveGap`)

    const itemSize = computed(() => {
      const gridWidth = width()
      const gap = effectiveGap()
      const columns = columnCount()

      return Math.max(0, Math.ceil((gridWidth - gap * (columns - 1)) / columns))
    }, `${target.name}._itemSize`)

    const density = computed(
      () => resolveGridDensity(itemSize()),
      `${target.name}._density`,
    )

    // 0 means "grid not measured yet" — the thumbnail pipeline waits for a
    // real target instead of wasting a decode on the smallest bucket.
    const thumbnailTarget = computed(() => {
      const size = itemSize()
      if (size === 0) return 0
      return quantizeThumbnailBucket(Math.ceil(size * devicePixelRatio()))
    }, `${target.name}._thumbnailTarget`)

    return {
      width,
      columnCount,
      itemSize,
      effectiveGap,
      density,
      maxColumnCount,
      thumbnailTarget,
      ref: (element: HTMLElement) => {
        target.set(element)
        return () =>
          target.set((current) => (current === element ? null : current))
      },
    }
  },
)
