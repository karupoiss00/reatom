import { addChangeHook, type Atom } from '@reatom/core'
import { mount } from '@reatom/jsx'

import { adminThemeVars, radius, tokens } from '../design-system'
import { focusVisible } from '../design-system/mixins'
import { ADMIN_HOST_Z_INDEX } from '../hostBox'
import {
  capturePointer,
  panelCornerAnchors,
  readPanelCorner,
  resizePointerIsActive,
  sizeFromResizePointer,
  type ResizeOrigin,
} from '../resizeDrag'
import { adminSettings, bindAdminPalette, isAdminPanelCorner } from '../settings'

const FLOATING_MARGIN = 16
const MIN_FLOATING_WIDTH = 360
const MIN_FLOATING_HEIGHT = 320
const MINIMIZED_WIDTH = 280
const CLOSED_SIZE = 44
const KEYBOARD_RESIZE_STEP = 48
const WIDTH_PROPERTY = '--admin-floating-width'
const HEIGHT_PROPERTY = '--admin-floating-height'

export const DEFAULT_FLOATING_WIDTH = 700
export const DEFAULT_FLOATING_HEIGHT = 760

export interface FloatingWindowOptions {
  /** Initial width in pixels. Clamped to the viewport. */
  width?: number
  /** Initial height in pixels. Clamped to the viewport. */
  height?: number
}

/**
 * The host rule follows `ADMIN_HOST_RESET`, so it wins over `all: initial`.
 * Inline styles on the host still win over both.
 */
const FLOATING_HOST_STYLE = `
  :host {
    ${adminThemeVars}
    position: fixed;
    z-index: ${ADMIN_HOST_Z_INDEX};
    box-sizing: border-box;
    width: var(${WIDTH_PROPERTY});
    height: var(${HEIGHT_PROPERTY});
    max-width: calc(100vw - ${FLOATING_MARGIN * 2}px);
    max-height: calc(100vh - ${FLOATING_MARGIN * 2}px);
    overflow: hidden;
    background: ${tokens.canvas};
    border: 1px solid ${tokens.border2};
    border-radius: ${radius[6]};
    box-shadow: 0 24px 48px -24px ${tokens.shadowStrong};
  }
  :host([data-corner='top-left']) {
    top: ${FLOATING_MARGIN}px;
    left: ${FLOATING_MARGIN}px;
    right: auto;
    bottom: auto;
  }
  :host([data-corner='top-right']) {
    top: ${FLOATING_MARGIN}px;
    right: ${FLOATING_MARGIN}px;
    left: auto;
    bottom: auto;
  }
  :host([data-corner='bottom-left']) {
    bottom: ${FLOATING_MARGIN}px;
    left: ${FLOATING_MARGIN}px;
    top: auto;
    right: auto;
  }
  :host([data-corner='bottom-right']),
  :host(:not([data-corner])) {
    bottom: ${FLOATING_MARGIN}px;
    right: ${FLOATING_MARGIN}px;
    top: auto;
    left: auto;
  }
  :host([data-minimized]) {
    width: ${MINIMIZED_WIDTH}px;
    height: auto;
  }
  :host([data-closed]) {
    width: ${CLOSED_SIZE}px;
    height: ${CLOSED_SIZE}px;
    background: transparent;
    border: 0;
    border-radius: 999px;
    box-shadow: none;
  }
  :host([data-minimized]) [data-floating-resize],
  :host([data-closed]) [data-floating-resize] {
    display: none;
  }
  :host([data-corner='bottom-right']) [data-floating-resize],
  :host(:not([data-corner])) [data-floating-resize] {
    top: 0;
    left: 0;
    right: auto;
    bottom: auto;
    cursor: nwse-resize;
  }
  :host([data-corner='bottom-left']) [data-floating-resize] {
    top: 0;
    right: 0;
    left: auto;
    bottom: auto;
    cursor: nesw-resize;
  }
  :host([data-corner='top-right']) [data-floating-resize] {
    bottom: 0;
    left: 0;
    top: auto;
    right: auto;
    cursor: nesw-resize;
  }
  :host([data-corner='top-left']) [data-floating-resize] {
    bottom: 0;
    right: 0;
    top: auto;
    left: auto;
    cursor: nwse-resize;
  }
  [data-floating-resize]::after {
    content: '';
    position: absolute;
    width: 6px;
    height: 6px;
    border-top: 1px solid ${tokens.border2};
    border-left: 1px solid ${tokens.border2};
  }
  :host([data-corner='bottom-right']) [data-floating-resize]::after,
  :host(:not([data-corner])) [data-floating-resize]::after {
    top: 3px;
    left: 3px;
  }
  :host([data-corner='bottom-left']) [data-floating-resize]::after {
    top: 3px;
    right: 3px;
    border-left: 0;
    border-right: 1px solid ${tokens.border2};
  }
  :host([data-corner='top-right']) [data-floating-resize]::after {
    bottom: 3px;
    left: 3px;
    border-top: 0;
    border-bottom: 1px solid ${tokens.border2};
  }
  :host([data-corner='top-left']) [data-floating-resize]::after {
    bottom: 3px;
    right: 3px;
    border-top: 0;
    border-left: 0;
    border-right: 1px solid ${tokens.border2};
    border-bottom: 1px solid ${tokens.border2};
  }
`

function clampWidth(value: number): number {
  const maxWidth = Math.max(
    MIN_FLOATING_WIDTH,
    window.innerWidth - FLOATING_MARGIN * 2,
  )
  return Math.round(Math.min(maxWidth, Math.max(MIN_FLOATING_WIDTH, value)))
}

function clampHeight(value: number): number {
  const maxHeight = Math.max(
    MIN_FLOATING_HEIGHT,
    window.innerHeight - FLOATING_MARGIN * 2,
  )
  return Math.round(Math.min(maxHeight, Math.max(MIN_FLOATING_HEIGHT, value)))
}

interface ActiveResize extends ResizeOrigin {
  pointerId: number
}

/**
 * Turns the admin shadow host into a window over the page. It docks to the
 * corner from Settings, resizes from the opposite grip, collapses to a status
 * strip while `minimized` is true, and shrinks to an icon while `closed` is
 * true. Call it inside `ADMIN_FRAME`.
 */
export function floatAdminHost(
  host: HTMLElement,
  shadow: ShadowRoot,
  minimized: Atom<boolean>,
  closed: Atom<boolean>,
  options: FloatingWindowOptions = {},
): () => void {
  const {
    width: initialWidth = DEFAULT_FLOATING_WIDTH,
    height: initialHeight = DEFAULT_FLOATING_HEIGHT,
  } = options
  let width = clampWidth(initialWidth)
  let height = clampHeight(initialHeight)
  const resizeTo = (nextWidth: number, nextHeight: number) => {
    width = clampWidth(nextWidth)
    height = clampHeight(nextHeight)
    host.style.setProperty(WIDTH_PROPERTY, `${width}px`)
    host.style.setProperty(HEIGHT_PROPERTY, `${height}px`)
  }
  resizeTo(width, height)

  const syncMinimized = (value: boolean) => {
    host.toggleAttribute('data-minimized', value)
  }
  syncMinimized(minimized())
  const removeMinimizedHook = addChangeHook(minimized, syncMinimized)

  const syncClosed = (value: boolean) => {
    host.toggleAttribute('data-closed', value)
  }
  syncClosed(closed())
  const removeClosedHook = addChangeHook(closed, syncClosed)

  const settings = adminSettings()
  const applyCorner = (value: unknown) => {
    host.dataset['corner'] = isAdminPanelCorner(value)
      ? value
      : 'bottom-right'
    resizeTo(width, height)
  }
  applyCorner(settings.corner())
  const removeCornerHook = addChangeHook(settings.corner, applyCorner)
  const unbindPalette = bindAdminPalette(host)

  const hostStyle = document.createElement('style')
  hostStyle.textContent = FLOATING_HOST_STYLE
  shadow.append(hostStyle)

  let drag: ActiveResize | null = null

  const resizeHandle = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Reatom Admin"
      tabindex={0}
      data-floating-resize=""
      css={`
        position: absolute;
        z-index: 1;
        width: 14px;
        height: 14px;
        touch-action: none;
        ${focusVisible}
      `}
      on:pointerdown={(event: PointerEvent) => {
        if (event.button !== 0) return
        if (!(event.currentTarget instanceof Element)) return
        event.preventDefault()
        const hostBox = host.getBoundingClientRect()
        const anchors = panelCornerAnchors(readPanelCorner(host.dataset['corner']))
        drag = {
          pointerId: event.pointerId,
          ...anchors,
          left: hostBox.left,
          top: hostBox.top,
          right: hostBox.right,
          bottom: hostBox.bottom,
          originX: event.clientX,
          originY: event.clientY,
        }
        capturePointer(event.currentTarget, event.pointerId)
      }}
      on:pointermove={(event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointerId) return
        const captured =
          event.currentTarget instanceof Element &&
          event.currentTarget.hasPointerCapture(event.pointerId)
        if (!resizePointerIsActive(captured, event.buttons)) return
        const next = sizeFromResizePointer(drag, event.clientX, event.clientY)
        resizeTo(next.width, next.height)
      }}
      on:pointerup={(event: PointerEvent) => {
        if (drag?.pointerId === event.pointerId) drag = null
      }}
      on:pointercancel={() => {
        drag = null
      }}
      on:keydown={(event: KeyboardEvent) => {
        const grow = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        const shrink = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        if (!grow && !shrink) return
        event.preventDefault()
        const delta = grow ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP
        resizeTo(width + delta, height + delta)
      }}
    />
  )
  const handleHost = document.createElement('div')
  const handleMountPoint = document.createElement('div')
  handleHost.append(handleMountPoint)
  shadow.append(handleHost)
  const handleMount = mount(handleMountPoint, resizeHandle)

  return () => {
    removeMinimizedHook()
    removeClosedHook()
    removeCornerHook()
    unbindPalette()
    handleMount.unmount()
    handleHost.remove()
    hostStyle.remove()
    host.style.removeProperty(WIDTH_PROPERTY)
    host.style.removeProperty(HEIGHT_PROPERTY)
    host.removeAttribute('data-minimized')
    host.removeAttribute('data-closed')
    delete host.dataset['corner']
  }
}
