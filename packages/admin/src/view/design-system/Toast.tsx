import { bind, type Atom } from '@reatom/core'

import { Button } from './Button'
import { reducedMotion } from './mixins'
import { tokens, type } from './tokens'

const DEFAULT_DURATION_MS = 8000

export interface ToastProps {
  /** Atom that is true while the toast is visible. */
  open: Atom<boolean>
  message: string
  /** When set with `onAction`, shows the undo (or other) control. */
  actionLabel?: string
  /**
   * Runs for the action control only. The toast then closes without
   * `onDismiss`. The owner applies the undo here.
   */
  onAction?: () => void
  /**
   * Runs when the toast expires or the user dismisses it. The owner drops the
   * undo snapshot here. Not called after `onAction`.
   */
  onDismiss: () => void
  /** How long the toast stays open. Defaults to 8000 ms. */
  durationMs?: number
}

/**
 * Transient status anchored to the nearest positioned shell. The node stays in
 * the mounted tree, including a shadow root.
 */
export const Toast = ({
  open,
  message,
  actionLabel,
  onAction,
  onDismiss,
  durationMs = DEFAULT_DURATION_MS,
}: ToastProps) => {
  const closeAfterAction = bind(() => {
    onAction?.()
    open.set(false)
  })
  const closeAfterDismiss = bind(() => {
    onDismiss()
    open.set(false)
  })

  return (
    <div data-reatom-name="Toast" css="display: contents;">
      {() =>
        open() ? (
          <div
            role="status"
            css={`
              ${reducedMotion}
              position: absolute;
              z-index: 4;
              inset-inline: var(--admin-space-8);
              inset-block-end: var(--admin-space-8);
              display: flex;
              align-items: center;
              gap: var(--admin-space-8);
              padding: var(--admin-space-8);
              background: ${tokens.surface2};
              color: ${tokens.text1};
              border: 1px solid ${tokens.border1};
              border-radius: var(--admin-radius-4);
              pointer-events: auto;
              transition: opacity var(--admin-motion-overlay) ease;
            `}
            ref={() => {
              const timer = window.setTimeout(closeAfterDismiss, durationMs)
              return () => window.clearTimeout(timer)
            }}
          >
            <p
              css={`
                ${type.body}
                margin: 0;
                flex: 1 1 auto;
              `}
            >
              {message}
            </p>
            {actionLabel && onAction ? (
              <Button
                variant="ghost"
                label={actionLabel}
                onClick={closeAfterAction}
              />
            ) : null}
            <Button
              variant="ghost"
              label="Dismiss"
              onClick={closeAfterDismiss}
            />
          </div>
        ) : null
      }
    </div>
  )
}
