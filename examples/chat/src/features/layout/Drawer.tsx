import { ui } from '../../app/ui'
import { activeChatId } from '../../routes'
import { IconButton, registerOpenLayer } from '../../ui'
import type { LayoutSlotProps } from '../slots'
import { compactLayout } from './media'

const focusableSelector = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const swipeEngageDistance = 10
const swipeCloseDistance = 72
const swipeCloseVelocity = 0.45

const isOutside = (element: HTMLElement, x: number, y: number) => {
  const rect = element.getBoundingClientRect()
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}

const currentChatRow = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null
  const row = target.closest<HTMLElement>('[aria-current="page"]')
  if (!row) return null
  const control = target.closest<HTMLElement>('button, a, [role="button"], [role="link"]')
  if (control && control !== row && row.contains(control)) return null
  return row
}

const focusableIn = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.getClientRects().length > 0,
  )

export const Drawer = ({ sidebar }: LayoutSlotProps) => {
  let menuButton: HTMLButtonElement | null = null
  let releaseLayer: (() => void) | null = null
  let pointerStartedOnScrim = false
  let swipe: {
    pointerId: number
    startX: number
    startY: number
    startTime: number
    offset: number
    engaged: boolean
  } | null = null

  const close = () => ui.drawer.set(false)

  const show = (dialog: HTMLDialogElement) => {
    if (dialog.open) return
    dialog.showModal()
    releaseLayer ??= registerOpenLayer()
  }

  const hide = (dialog: HTMLDialogElement) => {
    swipe = null
    dialog.style.removeProperty('transform')
    dialog.style.removeProperty('transition')
    dialog.removeAttribute('data-dragging')
    const wasOpen = dialog.open
    if (wasOpen) dialog.close()
    releaseLayer?.()
    releaseLayer = null
    if (wasOpen && menuButton?.isConnected) menuButton.focus()
  }

  const endSwipe = (dialog: HTMLDialogElement, event: PointerEvent) => {
    const current = swipe
    swipe = null
    if (!current?.engaged) return
    const elapsed = Math.max(1, event.timeStamp - current.startTime)
    const velocity = -current.offset / elapsed
    dialog.removeAttribute('data-dragging')
    dialog.style.removeProperty('transform')
    const shouldClose =
      event.type === 'pointerup' &&
      (-current.offset > swipeCloseDistance || velocity > swipeCloseVelocity)
    if (shouldClose) close()
  }

  return (
    <div data-slot="Drawer" css="display: contents;">
      <span
        css={`
          position: absolute;
          z-index: var(--z-sticky);
          top: calc(env(safe-area-inset-top) + var(--space-1-5));
          left: calc(env(safe-area-inset-left) + var(--space-1));

          @media (min-width: 761px) {
            display: none;
          }
        `}
      >
        <IconButton
          data-testid="drawer-menu"
          icon="menu"
          label="Open sidebar"
          attr:aria-haspopup="dialog"
          attr:aria-expanded={() => (ui.drawer() ? 'true' : 'false')}
          ref={(button: HTMLButtonElement) => {
            menuButton = button
          }}
          on:click={() => ui.drawer.set(true)}
        />
      </span>
      <dialog
        data-testid="drawer"
        aria-label="Chats"
        ref={(dialog: HTMLDialogElement) => {
          const stopOpenSync = ui.drawer.subscribe(() => {
            if (ui.drawer()) show(dialog)
            else hide(dialog)
          })
          let lastChatId = activeChatId()
          const stopChatSync = activeChatId.subscribe((chatId) => {
            if (chatId === lastChatId) return
            lastChatId = chatId
            close()
          })
          const stopLayoutSync = compactLayout.subscribe((compact) => {
            if (!compact) close()
          })
          return () => {
            stopOpenSync()
            stopChatSync()
            stopLayoutSync()
            hide(dialog)
          }
        }}
        on:cancel={(event) => {
          event.preventDefault()
          close()
        }}
        on:close={() => {
          if (ui.drawer()) close()
        }}
        on:keydown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            return
          }
          if ((event.key === 'Enter' || event.key === ' ') && currentChatRow(event.target)) {
            event.preventDefault()
            close()
            return
          }
          if (event.key !== 'Tab') return
          const dialog = event.currentTarget
          const focusable = focusableIn(dialog)
          if (focusable.length === 0) {
            event.preventDefault()
            return
          }
          const first = focusable[0]!
          const last = focusable[focusable.length - 1]!
          const active = document.activeElement
          if (event.shiftKey && (active === first || !dialog.contains(active))) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
            event.preventDefault()
            first.focus()
          }
        }}
        on:click={(event) => {
          const dialog = event.currentTarget
          const tappedScrim =
            pointerStartedOnScrim &&
            event.target === dialog &&
            isOutside(dialog, event.clientX, event.clientY)
          pointerStartedOnScrim = false
          if (tappedScrim) {
            close()
            return
          }
          if (event.target instanceof Element && event.target.closest('a[href]')) {
            close()
            return
          }
          if (currentChatRow(event.target)) close()
        }}
        on:pointerdown={(event) => {
          const dialog = event.currentTarget
          pointerStartedOnScrim =
            event.target === dialog && isOutside(dialog, event.clientX, event.clientY)
          if (pointerStartedOnScrim || !event.isPrimary) return
          swipe = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startTime: event.timeStamp,
            offset: 0,
            engaged: false,
          }
        }}
        on:pointermove={(event) => {
          const dialog = event.currentTarget
          if (!swipe || swipe.pointerId !== event.pointerId) return
          const deltaX = event.clientX - swipe.startX
          const deltaY = event.clientY - swipe.startY
          if (!swipe.engaged) {
            if (Math.abs(deltaY) > swipeEngageDistance && Math.abs(deltaY) > Math.abs(deltaX)) {
              swipe = null
              return
            }
            if (deltaX > -swipeEngageDistance) return
            swipe.engaged = true
            swipe.startX = event.clientX
            swipe.startTime = event.timeStamp
            dialog.setPointerCapture(event.pointerId)
            dialog.setAttribute('data-dragging', '')
          }
          swipe.offset = Math.min(0, event.clientX - swipe.startX)
          dialog.style.transform = `translateX(${swipe.offset}px)`
        }}
        on:pointerup={(event) => endSwipe(event.currentTarget, event)}
        on:pointercancel={(event) => endSwipe(event.currentTarget, event)}
        on:lostpointercapture={(event) => {
          if (swipe?.engaged) endSwipe(event.currentTarget, event)
        }}
        css={`
          position: fixed;
          inset: 0 auto 0 0;
          width: min(21rem, calc(100vw - 3.5rem));
          max-width: none;
          height: var(--shell-height, 100dvh);
          max-height: none;
          margin: 0;
          padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom)
            env(safe-area-inset-left);
          border: 0;
          border-right: 1px solid var(--line);
          border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
          background: var(--sidebar);
          color: var(--text);
          box-shadow: var(--shadow-4);
          overflow: hidden;
          overscroll-behavior: contain;
          touch-action: pan-y;
          transform: translateX(-100%);
          transition:
            transform var(--duration-base) var(--ease-exit),
            display var(--duration-base) allow-discrete,
            overlay var(--duration-base) allow-discrete;

          &[open] {
            display: flex;
            flex-direction: column;
            transform: none;
            transition:
              transform var(--duration-slow) var(--ease-enter),
              display var(--duration-slow) allow-discrete,
              overlay var(--duration-slow) allow-discrete;

            @starting-style {
              transform: translateX(-100%);
            }
          }

          &[data-dragging] {
            transition: none;
            user-select: none;
          }

          &::backdrop {
            background: transparent;
            transition:
              background-color var(--duration-slow) var(--ease-standard),
              display var(--duration-slow) allow-discrete,
              overlay var(--duration-slow) allow-discrete;
          }

          &[open]::backdrop {
            background-color: var(--bg);
            background-image: linear-gradient(var(--backdrop), var(--backdrop));

            @starting-style {
              background-color: transparent;
              background-image: none;
            }
          }

          & [data-drawer-close] {
            position: absolute;
            z-index: 1;
            top: calc(env(safe-area-inset-top) + var(--space-3));
            right: var(--space-2);
          }

          & [data-drawer-body] {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: auto;
          }
        `}
      >
        <span data-drawer-close="">
          <IconButton icon="close" label="Close sidebar" on:click={close} />
        </span>
        <div data-drawer-body="">{() => (compactLayout() ? sidebar() : null)}</div>
      </dialog>
    </div>
  )
}
