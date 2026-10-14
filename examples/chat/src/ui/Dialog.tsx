import type { Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { IconButton } from './IconButton'
import { registerOpenLayer } from './layers'
import { uniqueId } from './mixins'

export type DialogSize = 'sm' | 'md' | 'lg'

export type DialogProps = {
  open: Atom<boolean>
  title: JSX.ElementChildren
  description?: JSX.ElementChildren
  dismissible?: boolean
  onClose?: () => void
  size?: DialogSize
  actions?: JSX.ElementChildren
  footer?: JSX.ElementChildren
  children?: JSX.ElementChildren
  'data-testid'?: string
}

const focusableSelector = [
  '[autofocus]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const tabbable = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => {
    if (element.tabIndex < 0 || element.hasAttribute('disabled')) return false
    if (element.closest('[hidden]')) return false
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })

const isOutside = (element: HTMLElement, event: MouseEvent) => {
  const rect = element.getBoundingClientRect()
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
}

export const dialogSurfaceStyles = `
  flex-direction: column;
  width: min(var(--dialog-width), calc(100vw - var(--space-5) * 2));
  max-height: min(48rem, calc(100dvh - var(--space-6) * 2));
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-4), var(--edge-highlight);
  color: var(--text);
  overflow: hidden;

  --dialog-width: 32rem;

  &[open] {
    display: flex;
  }

  &[data-size='sm'] {
    --dialog-width: 24rem;
  }

  &[data-size='lg'] {
    --dialog-width: 48rem;
  }

  & [data-dialog-header] {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: start;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-5) var(--space-3) var(--space-3) var(--space-5);
  }

  & [data-dialog-title] {
    margin: 0;
    padding-top: var(--space-2);
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-medium);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-display);
  }

  & [data-dialog-description] {
    grid-column: 1;
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }

  & [data-dialog-actions] {
    grid-column: 2;
    grid-row: 1;
    display: inline-flex;
    align-items: center;
    align-self: center;
    justify-content: flex-end;
  }

  & [data-dialog-close] {
    grid-column: -2 / -1;
    grid-row: 1;
  }

  & [data-dialog-body] {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--space-2) var(--space-5) var(--space-5);
    font-size: var(--text-base);
  }

  & [data-dialog-body]:has([data-tabs-panes]) {
    overflow: hidden;
  }

  & [data-dialog-footer] {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5) var(--space-5);
  }
`

export const Dialog = ({
  open,
  title,
  description,
  dismissible = true,
  onClose,
  size = 'md',
  actions,
  footer,
  children,
  ...rest
}: DialogProps) => {
  const titleId = uniqueId('dialog-title')
  const descriptionId = uniqueId('dialog-description')
  let restoreTarget: HTMLElement | null = null
  let releaseLayer: (() => void) | null = null
  let pointerStartedOutside = false

  const dismiss = () => {
    if (!dismissible) return
    if (onClose) onClose()
    else open.set(false)
  }

  const focusInitial = (dialog: HTMLDialogElement) => {
    if (dialog.contains(document.activeElement) && document.activeElement !== dialog) return
    const body = dialog.querySelector('[data-dialog-body]')
    const preferred =
      dialog.querySelector<HTMLElement>('[autofocus]') ??
      body?.querySelector<HTMLElement>(focusableSelector) ??
      dialog.querySelector<HTMLElement>(focusableSelector)
    ;(preferred ?? dialog).focus()
  }

  const show = (dialog: HTMLDialogElement) => {
    if (dialog.open || !dialog.isConnected) return
    const active = document.activeElement
    restoreTarget =
      active instanceof HTMLElement &&
      active !== document.body &&
      !dialog.contains(active)
        ? active
        : null
    dialog.showModal()
    releaseLayer ??= registerOpenLayer()
    focusInitial(dialog)
    queueMicrotask(() => focusInitial(dialog))
  }

  const hide = (dialog: HTMLDialogElement) => {
    const active = document.activeElement
    if (active instanceof HTMLElement && dialog.contains(active)) active.blur()
    if (dialog.open) dialog.close()
    releaseLayer?.()
    releaseLayer = null
    const target = restoreTarget
    restoreTarget = null
    if (target?.isConnected && !dialog.contains(target)) target.focus()
  }

  return (
    <dialog
      {...rest}
      data-size={size}
      attr:aria-labelledby={titleId}
      attr:aria-describedby={description === undefined ? null : descriptionId}
      ref={(dialog: HTMLDialogElement) => {
        const unsubscribe = open.subscribe((isOpen) => {
          if (isOpen) show(dialog)
          else hide(dialog)
        })
        return () => {
          unsubscribe()
          hide(dialog)
        }
      }}
      on:cancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
      on:keydown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (!dismissible) event.preventDefault()
          return
        }
        if (event.key !== 'Tab') return
        const dialog = event.currentTarget
        const items = tabbable(dialog)
        event.preventDefault()
        if (items.length === 0) {
          dialog.focus()
          return
        }
        const index = items.indexOf(document.activeElement as HTMLElement)
        const nextIndex =
          index === -1
            ? event.shiftKey
              ? items.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length
        items[nextIndex]?.focus()
      }}
      on:close={(event) => {
        const dialog = event.currentTarget
        if (!open()) return
        if (dismissible) dismiss()
        else dialog.showModal()
      }}
      on:pointerdown={(event) => {
        const dialog = event.currentTarget
        pointerStartedOutside =
          event.target === dialog && isOutside(dialog, event)
      }}
      on:click={(event) => {
        const dialog = event.currentTarget
        const clickedBackdrop =
          pointerStartedOutside &&
          event.target === dialog &&
          isOutside(dialog, event)
        pointerStartedOutside = false
        if (clickedBackdrop) dismiss()
      }}
      css={`
        ${dialogSurfaceStyles}
        position: fixed;
        inset: 0;
        margin: auto;

        &:not([open]) {
          display: none;
        }

        &[open] {
          animation: ui-rise var(--duration-base) var(--ease-enter);
        }

        &::backdrop {
          background: var(--backdrop);
          backdrop-filter: blur(2px);
          animation: ui-fade var(--duration-base) var(--ease-enter);
        }

        @media (max-width: 560px) {
          width: 100vw;
          max-width: 100vw;
          max-height: calc(100dvh - var(--space-6));
          margin: auto 0 0;
          border-bottom: 0;
          border-radius: var(--radius-xl) var(--radius-xl) 0 0;
          padding-bottom: env(safe-area-inset-bottom);
        }
      `}
    >
      <header data-dialog-header="">
        <h2 data-dialog-title="" id={titleId}>
          {title}
        </h2>
        {actions === undefined ? null : (
          <span data-dialog-actions="">{actions}</span>
        )}
        {dismissible ? (
          <span data-dialog-close="">
            <IconButton icon="close" label="Close" on:click={dismiss} />
          </span>
        ) : null}
        {description === undefined ? null : (
          <p data-dialog-description="" id={descriptionId}>
            {description}
          </p>
        )}
      </header>
      <div data-dialog-body="">{children}</div>
      {footer === undefined ? null : <footer data-dialog-footer="">{footer}</footer>}
    </dialog>
  )
}
