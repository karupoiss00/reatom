import {
  isAdminPanelCorner,
  type AdminPanelCorner,
} from './settings'

export interface ResizeOrigin {
  anchorRight: boolean
  anchorBottom: boolean
  left: number
  top: number
  right: number
  bottom: number
  originX: number
  originY: number
}

export function panelCornerAnchors(corner: AdminPanelCorner): {
  anchorRight: boolean
  anchorBottom: boolean
} {
  return {
    anchorRight: corner.endsWith('right'),
    anchorBottom: corner.startsWith('bottom'),
  }
}

export function readPanelCorner(value: string | undefined): AdminPanelCorner {
  return isAdminPanelCorner(value) ? value : 'bottom-right'
}

/**
 * Size of a corner-anchored panel after a drag.
 *
 * The pointer keeps the same offset from the free corner that it had on
 * pointerdown, so a grip grabbed inside the handle does not jump.
 */
export function sizeFromResizePointer(
  origin: ResizeOrigin,
  clientX: number,
  clientY: number,
): { width: number; height: number } {
  const grabOffsetX = origin.anchorRight
    ? origin.originX - origin.left
    : origin.right - origin.originX
  const grabOffsetY = origin.anchorBottom
    ? origin.originY - origin.top
    : origin.bottom - origin.originY
  const width = origin.anchorRight
    ? origin.right - clientX + grabOffsetX
    : clientX - origin.left + grabOffsetX
  const height = origin.anchorBottom
    ? origin.bottom - clientY + grabOffsetY
    : clientY - origin.top + grabOffsetY
  return { width: Math.round(width), height: Math.round(height) }
}

export function capturePointer(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // A pointer id that is already gone cannot be captured. The drag still
    // tracks while the primary button is held.
  }
}

export function resizePointerIsActive(
  captured: boolean,
  buttons: number,
): boolean {
  return captured || (buttons & 1) === 1
}
