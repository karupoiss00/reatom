import { action, atom, reatomLinkedList, wrap, type Atom } from '@reatom/core'

import type { Tone } from '../styles/tokens'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import { read, resetButton, transition } from './mixins'

export type ToastTone = Exclude<Tone, 'accent'>

export type ToastAction = {
  label: string
  onClick: () => void
}

export type ToastOptions = {
  key: string
  text: string | (() => string)
  action?: ToastAction
  durationMs?: number | null
  tone?: ToastTone
}

type ToastContent = {
  text: string | (() => string)
  action: ToastAction | undefined
  tone: ToastTone
}

type ToastNode = {
  key: string
  content: Atom<ToastContent>
}

export const defaultToastDurationMs = 5000

const toastIcons: Record<ToastTone, IconName | null> = {
  neutral: null,
  success: 'success',
  warning: 'warning',
  danger: 'danger',
}

const toContent = (options: ToastOptions): ToastContent => ({
  text: options.text,
  action: options.action,
  tone: options.tone ?? 'neutral',
})

const toastList = reatomLinkedList(
  {
    create: (options: ToastOptions): ToastNode => ({
      key: options.key,
      content: atom(toContent(options), `ui.toast#${options.key}.content`),
    }),
    key: 'key',
  },
  'ui.toast.list',
)

const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

const clearTimer = (key: string) => {
  const timer = dismissTimers.get(key)
  if (timer !== undefined) clearTimeout(timer)
  dismissTimers.delete(key)
}

const dismiss = action((key: string) => {
  clearTimer(key)
  const node = toastList.map().get(key)
  if (node) toastList.remove(node)
}, 'ui.toast.dismiss')

const show = action((options: ToastOptions) => {
  const existing = toastList.map().get(options.key)
  if (existing) existing.content.set(toContent(options))
  else toastList.create(options)

  clearTimer(options.key)
  const durationMs =
    options.durationMs === undefined ? defaultToastDurationMs : options.durationMs
  if (durationMs !== null && Number.isFinite(durationMs)) {
    dismissTimers.set(
      options.key,
      setTimeout(
        wrap(() => dismiss(options.key)),
        durationMs,
      ),
    )
  }
}, 'ui.toast.show')

const clear = action(() => {
  for (const key of dismissTimers.keys()) clearTimer(key)
  toastList.clear()
}, 'ui.toast.clear')

export const toast = {
  show,
  dismiss,
  clear,
  keys: () => toastList.array().map((node) => node.key),
}

const ToastView = ({ node }: { node: ToastNode }) => (
  <li
    data-toast-key={node.key}
    data-tone={() => node.content().tone}
    css={`
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 3.25rem;
      max-width: 100%;
      padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
      border: 1px solid var(--inverse-line);
      border-radius: var(--radius-md);
      background: var(--inverse-bg);
      box-shadow: var(--shadow-3);
      color: var(--inverse-text);
      font-size: var(--text-sm);
      line-height: var(--leading-snug);
      pointer-events: auto;
      animation: ui-rise var(--duration-base) var(--ease-emphasized);

      & [data-toast-icon] {
        display: grid;
        color: var(--inverse-accent);
      }

      &[data-tone='success'] [data-toast-icon] {
        color: var(--inverse-success);
      }

      &[data-tone='warning'] [data-toast-icon] {
        color: var(--inverse-warning);
      }

      &[data-tone='danger'] [data-toast-icon] {
        color: var(--inverse-danger);
      }

      & [data-toast-text] {
        flex: 1;
        min-width: 0;
        padding-block: var(--space-2);
        font-variant-numeric: tabular-nums;
      }

      & [data-toast-action] {
        ${resetButton}
        flex: none;
        min-height: var(--hit);
        min-width: var(--hit);
        padding: 0 var(--space-3);
        border-radius: var(--radius-sm);
        color: var(--inverse-accent);
        font-weight: var(--weight-semibold);
        ${transition('background-color')}
      }

      & [data-toast-action]:hover {
        background: rgba(255, 255, 255, 0.08);
      }

      & [data-toast-close] button {
        --btn-fg: var(--inverse-muted);
        --btn-fg-hover: var(--inverse-text);
        --btn-bg-hover: rgba(255, 255, 255, 0.08);
        --btn-bg-active: rgba(255, 255, 255, 0.12);
      }
    `}
  >
    {() => {
      const icon = toastIcons[node.content().tone]
      return icon ? (
        <span data-toast-icon="">
          <Icon name={icon} size="1.125rem" />
        </span>
      ) : null
    }}
    <span data-toast-text="">{() => read(node.content().text)}</span>
    {() => {
      const toastAction = node.content().action
      return toastAction ? (
        <button
          type="button"
          data-toast-action=""
          on:click={() => {
            dismiss(node.key)
            toastAction.onClick()
          }}
        >
          {toastAction.label}
        </button>
      ) : null
    }}
    <span data-toast-close="" css="display: contents;">
      <IconButton
        icon="close"
        label="Dismiss notification"
        size="sm"
        on:click={() => dismiss(node.key)}
      />
    </span>
  </li>
)

export const Toaster = () => (
  <section
    attr:aria-label="Notifications"
    ref={() => () => clear()}
    css={`
      position: fixed;
      z-index: var(--z-toast);
      left: 50%;
      bottom: calc(var(--space-5) + env(safe-area-inset-bottom));
      width: min(28rem, calc(100vw - var(--space-4) * 2));
      transform: translateX(-50%);
      pointer-events: none;

      & ol {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
    `}
  >
    <ol>{toastList.reatomMap((node) => <ToastView node={node} />)}</ol>
  </section>
)
