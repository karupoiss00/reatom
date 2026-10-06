import { atom, wrap } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { uniqueId } from './mixins'
import type { PopoverPlacement } from './Popover'

export type TooltipProps = {
  label: JSX.ElementChildren
  children: JSX.ElementChildren
  placement?: PopoverPlacement
}

const viewportMargin = 8
const anchorGap = 6

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

const placeTooltip = (
  panel: HTMLElement,
  anchor: HTMLElement,
  placement: PopoverPlacement,
) => {
  const anchorRect = anchor.getBoundingClientRect()
  if (anchorRect.width === 0 && anchorRect.height === 0) return
  const panelRect = panel.getBoundingClientRect()
  const [side, align] = placement.split('-') as [
    'bottom' | 'top',
    'start' | 'end',
  ]
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

const tooltipStyles = `
  position: fixed;
  inset: auto;
  margin: 0;
  width: max-content;
  max-width: min(36rem, calc(100vw - 16px));
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-3), var(--edge-highlight);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  pointer-events: none;
  white-space: normal;

  &:popover-open {
    animation: ui-pop var(--duration-fast) var(--ease-enter);
  }
`

export const Tooltip = ({
  label,
  children,
  placement = 'top-start',
}: TooltipProps) => {
  const tipId = uniqueId('tooltip')
  const open = atom(false, `${tipId}.open`)
  const nodes = Array.isArray(children) ? children : [children]
  const trigger = nodes.find(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (!trigger) throw new Error('Tooltip trigger must be an element')
  trigger.setAttribute('aria-describedby', tipId)

  let hovered = false
  let focused = false
  const sync = () => open.set(hovered || focused)

  const onEnter = wrap(() => {
    hovered = true
    sync()
  })
  const onLeave = wrap(() => {
    hovered = false
    sync()
  })
  const onFocus = wrap(() => {
    focused = true
    sync()
  })
  const onBlur = wrap(() => {
    focused = false
    sync()
  })

  trigger.addEventListener('mouseenter', onEnter)
  trigger.addEventListener('mouseleave', onLeave)
  trigger.addEventListener('focus', onFocus)
  trigger.addEventListener('blur', onBlur)

  const panel = (
    <div
      id={tipId}
      data-tooltip=""
      attr:role="tooltip"
      attr:popover="manual"
      css={tooltipStyles}
      ref={(element: HTMLElement) => {
        let watchingViewport = false

        const onViewportChange = () =>
          placeTooltip(element, trigger, placement)

        const watchViewport = () => {
          if (watchingViewport) return
          watchingViewport = true
          window.addEventListener('resize', onViewportChange)
          window.addEventListener('scroll', onViewportChange, true)
        }

        const unwatchViewport = () => {
          if (!watchingViewport) return
          watchingViewport = false
          window.removeEventListener('resize', onViewportChange)
          window.removeEventListener('scroll', onViewportChange, true)
        }

        const showPanel = () => {
          if (!element.isConnected) return
          if (!element.matches(':popover-open')) element.showPopover()
          placeTooltip(element, trigger, placement)
          requestAnimationFrame(() => {
            if (element.matches(':popover-open')) {
              placeTooltip(element, trigger, placement)
            }
          })
          watchViewport()
        }

        const hidePanel = () => {
          unwatchViewport()
          if (element.matches(':popover-open')) element.hidePopover()
        }

        const unsubscribe = open.subscribe((isOpen) => {
          if (isOpen) showPanel()
          else hidePanel()
        })

        return () => {
          unsubscribe()
          hidePanel()
          trigger.removeEventListener('mouseenter', onEnter)
          trigger.removeEventListener('mouseleave', onLeave)
          trigger.removeEventListener('focus', onFocus)
          trigger.removeEventListener('blur', onBlur)
        }
      }}
    >
      {label}
    </div>
  ) as HTMLElement

  return (
    <span data-tooltip-root="" css="display: inline-flex; flex: none;">
      {children}
      {panel}
    </span>
  )
}
