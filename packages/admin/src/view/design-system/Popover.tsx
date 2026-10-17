import { atom, bind, peek } from '@reatom/core'

import { controlBase, focusVisible, reducedMotion } from './mixins'
import { tokens, type } from './tokens'

let popoverCounter = 0

export interface PopoverProps {
  /** Accessible name of the trigger button. */
  triggerLabel: string | (() => string)
  /** Accessible name of the panel. */
  label: string
  placement?: 'top' | 'bottom'
  children?: Element | string | Array<Element | string>
}

/**
 * Non-modal note anchored to its trigger. The panel is a descendant of the
 * trigger's tree, so it stays inside a shadow root.
 */
export const Popover = ({
  triggerLabel,
  label,
  placement = 'bottom',
  children,
}: PopoverProps) => {
  const panelId = `_AdminPopover${++popoverCounter}`
  const titleId = `${panelId}Title`
  const isOpen = atom(false, `_Admin.popover.open.${popoverCounter}`)
  let trigger: HTMLElement | null = null
  let anchor: HTMLElement | null = null
  const setOpen = bind((next: boolean) => {
    if (!next) trigger?.focus()
    isOpen.set(next)
  })
  const closeIfOutside = bind((path: Array<EventTarget>) => {
    if (!isOpen() || !anchor) return
    if (path.includes(anchor)) return
    isOpen.set(false)
  })

  return (
    <div
      data-reatom-name="Popover"
      css={`
        position: relative;
        display: inline-flex;
      `}
      ref={(host) => {
        anchor = host
        trigger = host.querySelector('button')
        const root = host.getRootNode()
        const onPointerDown = (event: Event) => {
          closeIfOutside(event.composedPath())
        }
        root.addEventListener('pointerdown', onPointerDown, true)
        return () =>
          root.removeEventListener('pointerdown', onPointerDown, true)
      }}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={() => isOpen()}
        aria-controls={() => (isOpen() ? panelId : undefined)}
        css={`
          ${controlBase}
          ${focusVisible}
          padding-inline: var(--admin-space-8);
          background: ${tokens.surface2};
          color: ${tokens.text1};
          cursor: pointer;
        `}
        on:click={() => setOpen(!peek(isOpen))}
      >
        {triggerLabel}
      </button>
      {() =>
        isOpen() ? (
          <div
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabindex={-1}
            css={`
              ${type.body}
              ${reducedMotion}
              position: absolute;
              z-index: 3;
              inset-block-start: ${placement === 'top' ? 'auto' : 'calc(100% + var(--admin-space-4))'};
              inset-block-end: ${placement === 'top' ? 'calc(100% + var(--admin-space-4))' : 'auto'};
              inset-inline-start: 0;
              min-width: 12rem;
              max-width: ${placement === 'top' ? '28rem' : '18rem'};
              max-height: ${placement === 'top' ? '20rem' : 'none'};
              overflow: ${placement === 'top' ? 'auto' : 'visible'};
              padding: var(--admin-space-8);
              background: ${tokens.surface2};
              color: ${tokens.text1};
              border: 1px solid ${tokens.border1};
              border-radius: var(--admin-radius-4);
              transition: opacity var(--admin-motion-overlay) ease;
            `}
            ref={(panel) => {
              panel.focus()
              const onKeyDown = (event: Event) => {
                if (!(event instanceof KeyboardEvent)) return
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
              }
              panel.addEventListener('keydown', onKeyDown)
              return () => panel.removeEventListener('keydown', onKeyDown)
            }}
          >
            <p
              id={titleId}
              css={`
                ${type.meta}
                margin: 0 0 var(--admin-space-4);
                color: ${tokens.text2};
              `}
            >
              {label}
            </p>
            {children}
          </div>
        ) : null
      }
    </div>
  )
}
