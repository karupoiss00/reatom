import type { JSX } from '@reatom/jsx'

import { Icon, type IconName } from './Icon'
import { compactTarget, read, resetButton, transition, type Reactive } from './mixins'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger'
export type ButtonSize = 'md' | 'sm'

export type ButtonProps = Omit<JSX.IntrinsicElements['button'], 'disabled'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  trailingIcon?: IconName
  loading?: Reactive<boolean>
  disabled?: Reactive<boolean | undefined>
  fullWidth?: boolean
}

export const buttonVariantStyles = `
  --btn-bg: var(--bg-elevated);
  --btn-bg-hover: var(--surface-hover);
  --btn-bg-active: var(--surface-active);
  --btn-bg-disabled: var(--bg-elevated);
  --btn-fg: var(--text);
  --btn-fg-hover: var(--text);
  --btn-fg-disabled: var(--text-disabled);
  --btn-line: var(--line-strong);
  --btn-line-disabled: var(--disabled-line);
  --btn-shadow: var(--shadow-1);

  &[data-variant='primary'] {
    --btn-bg: var(--accent);
    --btn-bg-hover: var(--accent-hover);
    --btn-bg-active: var(--accent-pressed);
    --btn-bg-disabled: var(--disabled-fill);
    --btn-fg: var(--accent-ink);
    --btn-fg-hover: var(--accent-ink);
    --btn-line: transparent;
    --btn-line-disabled: transparent;
    --btn-shadow: var(--shadow-1), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }

  &[data-variant='ghost'] {
    --btn-bg: transparent;
    --btn-bg-hover: var(--surface-hover);
    --btn-bg-active: var(--surface-active);
    --btn-bg-disabled: transparent;
    --btn-fg: var(--text-muted);
    --btn-fg-hover: var(--text);
    --btn-line: transparent;
    --btn-line-disabled: transparent;
    --btn-shadow: none;
  }

  &[data-variant='soft'] {
    --btn-bg: var(--accent-soft);
    --btn-bg-hover: var(--accent-soft-hover);
    --btn-bg-active: var(--accent-soft-hover);
    --btn-bg-disabled: var(--disabled-fill);
    --btn-fg: var(--accent-text);
    --btn-fg-hover: var(--accent-text);
    --btn-line: transparent;
    --btn-line-disabled: transparent;
    --btn-shadow: none;
  }

  &[data-variant='danger'] {
    --btn-bg: var(--danger-fill);
    --btn-bg-hover: var(--danger-fill-hover);
    --btn-bg-active: var(--danger-fill-pressed);
    --btn-bg-disabled: var(--disabled-fill);
    --btn-fg: var(--danger-ink);
    --btn-fg-hover: var(--danger-ink);
    --btn-line: transparent;
    --btn-line-disabled: transparent;
    --btn-shadow: var(--shadow-1), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  --btn-bg-now: var(--btn-bg);
  --btn-fg-now: var(--btn-fg);
  --btn-line-now: var(--btn-line);
  --btn-shadow-now: var(--btn-shadow);

  &:hover:not(:disabled) {
    --btn-bg-now: var(--btn-bg-hover);
    --btn-fg-now: var(--btn-fg-hover);
  }

  &:active:not(:disabled) {
    --btn-bg-now: var(--btn-bg-active);
    --btn-fg-now: var(--btn-fg-hover);
  }

  &:disabled:not([aria-busy='true']) {
    --btn-bg-now: var(--btn-bg-disabled);
    --btn-fg-now: var(--btn-fg-disabled);
    --btn-line-now: var(--btn-line-disabled);
    --btn-shadow-now: none;
  }
`

export const Button = ({
  variant = 'secondary',
  size = 'md',
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = 'button',
  children,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    type={type}
    data-variant={variant}
    data-size={size}
    data-full-width={fullWidth ? 'true' : 'false'}
    disabled={() => Boolean(read(disabled)) || read(loading)}
    attr:aria-busy={() => (read(loading) ? 'true' : null)}
    css={`
      ${resetButton}
      ${buttonVariantStyles}
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-width: var(--hit);
      min-height: var(--control-height);
      padding: 0 var(--space-4);
      border: 1px solid var(--btn-line-now);
      border-radius: var(--radius-pill);
      background: var(--btn-bg-now);
      box-shadow: var(--btn-shadow-now);
      color: var(--btn-fg-now);
      font-size: var(--text-base);
      font-weight: var(--weight-medium);
      line-height: var(--leading-none);
      letter-spacing: var(--tracking-tight);
      white-space: nowrap;
      user-select: none;
      ${transition('box-shadow, transform, opacity')}

      &:active:not(:disabled) {
        transform: translateY(0.5px) scale(0.99);
      }

      &[aria-busy='true'] {
        cursor: progress;
      }

      &[data-full-width='true'] {
        width: 100%;
      }

      &[data-size='sm'] {
        ${compactTarget('var(--control-height-compact)')}
        --visual-bg: var(--btn-bg-now);
        --visual-line: var(--btn-line-now);
        --visual-shadow: var(--btn-shadow-now);
        padding: 0 var(--space-3);
        font-size: var(--text-sm);
        box-shadow: none;
      }

      & [data-label] {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `}
  >
    {() =>
      read(loading) ? (
        <Spinner size="1rem" />
      ) : icon ? (
        <Icon name={icon} size="1.125rem" />
      ) : null
    }
    {children === undefined ? null : <span data-label="">{children}</span>}
    {trailingIcon ? <Icon name={trailingIcon} size="1rem" /> : null}
  </button>
)
