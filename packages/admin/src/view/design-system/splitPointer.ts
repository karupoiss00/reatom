import { wrap, type Atom } from '@reatom/core'

export interface SplitPointerTarget {
  hasPointerCapture(pointerId: number): boolean
  getBoundingClientRect(): { left: number; width: number }
}

export interface SplitPointerEvent {
  pointerId: number
  clientX: number
}

export function splitPanePointerMove(
  element: SplitPointerTarget,
  ratio: Atom<number>,
  minLeft: number,
  minRight: number,
) {
  return wrap((event: SplitPointerEvent) => {
    if (!element.hasPointerCapture(event.pointerId)) return
    const bounds = element.getBoundingClientRect()
    if (bounds.width <= minLeft + minRight) return
    const minLeftRatio = minLeft / bounds.width
    const maxLeftRatio = 1 - minRight / bounds.width
    const next = (event.clientX - bounds.left) / bounds.width
    ratio.set(Math.min(maxLeftRatio, Math.max(minLeftRatio, next)))
  })
}
