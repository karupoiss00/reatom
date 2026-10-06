import { atom, wrap, type Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { registerOpenLayer } from './layers'
import { uniqueId } from './mixins'

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

export type PopoverTriggerProps = {
  'attr:aria-haspopup': 'menu' | 'dialog'
  'attr:aria-expanded': () => 'true' | 'false'
  'attr:aria-controls': string
  'on:click': () => void
}

export type PopoverControls = {
  open: Atom<boolean>
  close: (options?: { restoreFocus?: boolean }) => void
}

export type PopoverProps = {
  label: string
  trigger: (props: PopoverTriggerProps) => JSX.Element
  children: (controls: PopoverControls) => JSX.ElementChildren
  open?: Atom<boolean>
  placement?: PopoverPlacement
  role?: 'dialog' | 'menu'
  onOpen?: (panel: HTMLElement) => void
  onPanelKeyDown?: (event: KeyboardEvent, controls: PopoverControls) => void
  width?: string
  maxHeight?: string
}

type OpenPanel = { element: HTMLElement; forceClose: () => void }

const openPanels: OpenPanel[] = []

const topPanel = () => openPanels[openPanels.length - 1]?.element

export const closeAllPopovers = () => {
  for (const panel of [...openPanels].reverse()) panel.forceClose()
  openPanels.length = 0
}

const viewportMargin = 8
const anchorGap = 4

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

const placePanel = (
  panel: HTMLElement,
  anchor: HTMLElement,
  placement: PopoverPlacement,
) => {
  const anchorRect = anchor.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const [side, align] = placement.split('-') as ['bottom' | 'top', 'start' | 'end']
  const below = anchorRect.bottom + anchorGap
  const above = anchorRect.top - anchorGap - panelRect.height
  const fitsBelow = below + panelRect.height <= innerHeight - viewportMargin
  const fitsAbove = above >= viewportMargin
  const top =
    side === 'bottom'
      ? fitsBelow || !fitsAbove
        ? below
        : above
      : fitsAbove || !fitsBelow
        ? above
        : below
  const left =
    align === 'start' ? anchorRect.left : anchorRect.right - panelRect.width
  panel.style.top = `${clamp(top, viewportMargin, innerHeight - viewportMargin - panelRect.height)}px`
  panel.style.left = `${clamp(left, viewportMargin, innerWidth - viewportMargin - panelRect.width)}px`
}

export const popoverPanelStyles = `
  position: fixed;
  inset: auto;
  margin: 0;
  min-width: var(--popover-width, 14rem);
  max-width: min(22rem, calc(100vw - 16px));
  max-height: var(--popover-max-height, min(28rem, calc(100dvh - 16px)));
  overflow: auto;
  padding: var(--space-1-5);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-3), var(--edge-highlight);
  color: var(--text);
  font-size: var(--text-sm);

  &:popover-open {
    animation: ui-pop var(--duration-fast) var(--ease-enter);
  }
`

export const Popover = ({
  label,
  trigger,
  children,
  open = atom(false, `${uniqueId('ui.popover')}.open`),
  placement = 'bottom-start',
  role = 'dialog',
  onOpen,
  onPanelKeyDown,
  width,
  maxHeight,
}: PopoverProps) => {
  const panelId = uniqueId('popover')
  const renderContent: PopoverProps['children'] = Array.isArray(children)
    ? children[0]
    : children
  let restoreFocusOnClose = false

  const controls: PopoverControls = {
    open,
    close: ({ restoreFocus = true } = {}) => {
      restoreFocusOnClose = restoreFocus
      open.set(false)
    },
  }

  const triggerElement = trigger({
    'attr:aria-haspopup': role,
    'attr:aria-expanded': () => (open() ? 'true' : 'false'),
    'attr:aria-controls': panelId,
    'on:click': () => open.set(!open()),
  }) as HTMLElement

  const panel = (
    <div
      id={panelId}
      attr:popover="manual"
      attr:role={role}
      attr:aria-label={label}
      attr:tabindex="-1"
      css:popover-width={width ?? null}
      css:popover-max-height={maxHeight ?? null}
      css={popoverPanelStyles}
      on:keydown={(event) => onPanelKeyDown?.(event, controls)}
      on:focusout={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node)) return
        if (panel.contains(next) || triggerElement.contains(next)) return
        controls.close({ restoreFocus: false })
      }}
      ref={(element: HTMLElement) => {
        let cleanupOpen: (() => void) | null = null

        const showPanel = () => {
          if (cleanupOpen) return
          element.showPopover()
          placePanel(element, triggerElement, placement)
          openPanels.push({
            element,
            forceClose: () => {
              restoreFocusOnClose = false
              hidePanel({ restoreFocus: false })
              open.set(false)
            },
          })
          const releaseLayer = registerOpenLayer()

          const onPointerDown = wrap((event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (element.contains(target) || triggerElement.contains(target)) return
            controls.close({ restoreFocus: false })
          })
          const onKeyDown = wrap((event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (topPanel() !== element) return
            event.preventDefault()
            event.stopImmediatePropagation()
            controls.close({ restoreFocus: true })
          })
          const onViewportChange = () =>
            placePanel(element, triggerElement, placement)

          window.addEventListener('pointerdown', onPointerDown, true)
          window.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('resize', onViewportChange)
          window.addEventListener('scroll', onViewportChange, true)

          cleanupOpen = () => {
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('resize', onViewportChange)
            window.removeEventListener('scroll', onViewportChange, true)
            const stackIndex = openPanels.findIndex(
              (panel) => panel.element === element,
            )
            if (stackIndex !== -1) openPanels.splice(stackIndex, 1)
            releaseLayer()
          }
          onOpen?.(element)
        }

        const hidePanel = ({ restoreFocus = true } = {}) => {
          if (!cleanupOpen) return
          const focusWasInside =
            restoreFocus && element.contains(document.activeElement)
          cleanupOpen()
          cleanupOpen = null
          if (element.matches(':popover-open')) element.hidePopover()
          if ((restoreFocusOnClose || focusWasInside) && triggerElement.isConnected) {
            triggerElement.focus()
          }
          restoreFocusOnClose = false
        }

        const unsubscribe = open.subscribe((isOpen) => {
          if (isOpen) showPanel()
          else hidePanel()
        })
        return () => {
          unsubscribe()
          hidePanel()
        }
      }}
    >
      {renderContent(controls)}
    </div>
  ) as HTMLElement

  return (
    <span data-popover-root="" css="display: contents;">
      {triggerElement}
      {panel}
    </span>
  )
}
