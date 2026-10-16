import { addChangeHook, atom, reatomBoolean } from '@reatom/core'
import { mount } from '@reatom/jsx'

import type { Admin } from '../../index'
import type { AdminOptions } from '../../index'
import { createAdmin } from '../../index'
import { ADMIN_FRAME } from '../../root'
import { adminThemeVars, radius, tokens } from '../design-system'
import { adminSettings, bindAdminPalette } from '../settings'
import { bindAdminStylesheet } from '../stylesheet'
import { focusVisible } from '../design-system/mixins'
import {
  capturePointer,
  resizePointerIsActive,
  sizeFromResizePointer,
  type ResizeOrigin,
} from '../resizeDrag'
import { AppShell } from './AppShell'

const MAX_Z = 2 ** 32 - 1
const MIN_PANEL_WIDTH = 360
const MIN_PANEL_HEIGHT = 320
const PANEL_MARGIN = 16
const DEFAULT_WIDTH = '700px'
const DEFAULT_HEIGHT = '760px'
let devtoolsCounter = 0

export interface AdminDevtoolsOptions extends AdminOptions {
  initVisibility?: boolean
  initialWidth?: string
  initialHeight?: string
}

export interface AdminDevtools {
  admin: Admin
  containerId: string
  show: () => void
  hide: () => void
}

function parsePixelSize(value: string): number | null {
  if (!value.endsWith('px')) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampPanelWidth(value: string): string {
  const parsed = parsePixelSize(value)
  if (parsed === null) return value

  const maxWidth = Math.max(
    MIN_PANEL_WIDTH,
    window.innerWidth - PANEL_MARGIN * 2,
  )
  return `${Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, parsed))}px`
}

function clampPanelHeight(value: string): string {
  const parsed = parsePixelSize(value)
  if (parsed === null) return value

  const maxHeight = Math.max(
    MIN_PANEL_HEIGHT,
    window.innerHeight - PANEL_MARGIN * 2,
  )
  return `${Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, parsed))}px`
}

export function createAdminDevtools(
  options: AdminDevtoolsOptions = {},
): AdminDevtools {
  const {
    initVisibility = true,
    initialWidth = DEFAULT_WIDTH,
    initialHeight = DEFAULT_HEIGHT,
    ...adminOptions
  } = options

  const admin = createAdmin(adminOptions)

  return ADMIN_FRAME.run(() => {
    const id = `_ReatomAdminDevtools_${++devtoolsCounter}`
    const container = globalThis.document.createElement('div')
    container.id = id
    container.dataset['adminHost'] = ''
    const root = container.attachShadow({ mode: 'open' })
    const adminSheet = bindAdminStylesheet(root)

    const visible = reatomBoolean(initVisibility, '_Admin.devtools.visible')
    const minimized = reatomBoolean(false, '_Admin.devtools.minimized')
    const width = atom(clampPanelWidth(initialWidth), '_Admin.devtools.width')
    const height = atom(
      clampPanelHeight(initialHeight),
      '_Admin.devtools.height',
    )
    const restoredWidth = atom(
      clampPanelWidth(initialWidth),
      '_Admin.devtools.restoredWidth',
    )
    const restoredHeight = atom(
      clampPanelHeight(initialHeight),
      '_Admin.devtools.restoredHeight',
    )

    const getPointerEvent = (event: Event): PointerEvent | null => {
      return event instanceof PointerEvent ? event : null
    }

    const minimizePanel = () => {
      restoredWidth.set(width())
      restoredHeight.set(height())
      minimized.setTrue()
    }

    const expandPanel = () => {
      width.set(clampPanelWidth(restoredWidth()))
      height.set(clampPanelHeight(restoredHeight()))
      minimized.setFalse()
    }

    const resizeBy = (delta: number) => {
      const currentWidth = parsePixelSize(width()) ?? MIN_PANEL_WIDTH
      const currentHeight = parsePixelSize(height()) ?? MIN_PANEL_HEIGHT
      width.set(clampPanelWidth(`${currentWidth + delta}px`))
      height.set(clampPanelHeight(`${currentHeight + delta}px`))
    }

    let drag: (ResizeOrigin & { pointerId: number }) | null = null

    const resizeHandle = (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Reatom Admin devtools resize handle"
        tabindex={0}
        css={`
          position: absolute;
          top: 0;
          left: 0;
          width: 16px;
          height: 16px;
          background: transparent;
          cursor: nwse-resize;
          touch-action: none;
          z-index: ${MAX_Z};
          pointer-events: auto;
          &::after {
            content: '';
            position: absolute;
            inset: 0 auto auto 0;
            width: 6px;
            height: 6px;
            border-top: 1px solid ${tokens.border2};
            border-left: 1px solid ${tokens.border2};
            opacity: 0.7;
          }
          ${focusVisible}
        `}
        on:pointerdown={(event: Event) => {
          const pointerEvent = getPointerEvent(event)
          if (!pointerEvent || pointerEvent.button !== 0) return
          if (!(event.currentTarget instanceof Element)) return
          const panel = event.currentTarget.closest(
            '[data-reatom-name="DevtoolsPanel"]',
          )
          if (!(panel instanceof HTMLElement)) return
          pointerEvent.preventDefault()
          const box = panel.getBoundingClientRect()
          drag = {
            pointerId: pointerEvent.pointerId,
            anchorRight: true,
            anchorBottom: true,
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            originX: pointerEvent.clientX,
            originY: pointerEvent.clientY,
          }
          capturePointer(event.currentTarget, pointerEvent.pointerId)
        }}
        on:pointermove={(event: Event) => {
          const pointerEvent = getPointerEvent(event)
          if (!drag || !pointerEvent || pointerEvent.pointerId !== drag.pointerId) {
            return
          }
          const captured =
            event.currentTarget instanceof Element &&
            event.currentTarget.hasPointerCapture(pointerEvent.pointerId)
          if (!resizePointerIsActive(captured, pointerEvent.buttons)) return
          const next = sizeFromResizePointer(
            drag,
            pointerEvent.clientX,
            pointerEvent.clientY,
          )
          width.set(clampPanelWidth(`${next.width}px`))
          height.set(clampPanelHeight(`${next.height}px`))
        }}
        on:pointerup={(event: Event) => {
          const pointerEvent = getPointerEvent(event)
          if (pointerEvent && drag?.pointerId === pointerEvent.pointerId) {
            drag = null
          }
        }}
        on:pointercancel={() => {
          drag = null
        }}
        on:keydown={(event: KeyboardEvent) => {
          const grow = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          const shrink = event.key === 'ArrowRight' || event.key === 'ArrowDown'
          if (!grow && !shrink) return
          event.preventDefault()
          resizeBy(grow ? 48 : -48)
        }}
      />
    )

    const expandPill = (
      <button
        type="button"
        aria-label="Expand Reatom devtools"
        css={`
          all: unset;
          box-sizing: border-box;
          width: 44px;
          height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          border: 1px solid ${tokens.border2};
          background: ${tokens.surface2};
          color: ${tokens.accent};
          font-family: ${tokens.fontUi};
          font-size: 1rem;
          font-weight: 750;
          cursor: pointer;
          ${focusVisible}
        `}
        on:click={() => expandPanel()}
      >
        R
      </button>
    )

    const settings = adminSettings()
    const panel = (
      <div
        data-reatom-name="DevtoolsPanel"
        data-admin-scheme={() => settings.resolvedScheme()}
        ref={(panel) => bindAdminPalette(panel)}
        data-minimized={() => (minimized() ? 'true' : 'false')}
        css:width={() => (minimized() ? '44px' : width())}
        css:height={() => (minimized() ? '44px' : height())}
        css={`
          ${adminThemeVars}
          all: initial;
          position: fixed;
          inset-inline-end: 1rem;
          inset-block-end: 1rem;
          width: var(--width);
          height: var(--height);
          max-width: calc(100vw - 2rem);
          max-height: calc(100vh - 2rem);
          z-index: ${MAX_Z};
          background: ${tokens.canvas};
          border: 1px solid ${tokens.border1};
          border-radius: ${radius[6]};
          font-family: ${tokens.fontUi};
          font-size: 12px;
          box-sizing: border-box;
          overflow: hidden;
          &[data-minimized='true'] {
            background: transparent;
            border: 0;
            border-radius: 999px;
          }
          &[data-minimized='true'] > [data-panel-content] {
            display: none;
          }
        `}
      >
        {() => (minimized() ? expandPill : null)}
        {() => (minimized() ? null : resizeHandle)}
        <div
          data-panel-content=""
          css={`
            height: 100%;
            min-height: 0;
            overflow: hidden;
            border-radius: inherit;
            display: block;
          `}
        >
          <AppShell admin={admin} onMinimize={minimizePanel} />
        </div>
      </div>
    )

    const mountHost = document.createElement('div')
    root.append(mountHost)
    const mountPoint = document.createElement('div')
    mountHost.append(mountPoint)
    mount(mountPoint, panel)

    let bodyMount: { unmount: () => void } | null = null
    const mountContainer = () => {
      if (container.isConnected) return
      bodyMount = mount(document.body, container)
    }
    const unmountContainer = () => {
      if (!container.isConnected) {
        bodyMount = null
        return
      }
      bodyMount?.unmount()
      bodyMount = null
    }

    if (visible()) mountContainer()

    addChangeHook(visible, (state) => {
      if (state) mountContainer()
      else unmountContainer()
    })

    return {
      admin,
      containerId: id,
      show: () => {
        ADMIN_FRAME.run(() => {
          adminSheet.rebind()
          minimized.setFalse()
          visible.setTrue()
        })
        container.hidden = false
        mountContainer()
      },
      hide: () => {
        ADMIN_FRAME.run(() => visible.setFalse())
        unmountContainer()
        adminSheet.restore()
      },
    }
  })
}
