import type { JSX } from '@reatom/jsx'

import { buttonVariantStyles, type ButtonSize, type ButtonVariant } from './Button'
import { Icon, type IconName } from './Icon'
import { compactTarget, read, resetButton, transition, type Reactive } from './mixins'
import { Spinner } from './Spinner'

export type NonEmptyLabel<Label extends string> = Label extends '' ? never : Label

export type IconButtonProps<Label extends string = string> = Omit<
  JSX.IntrinsicElements['button'],
  'disabled' | 'children'
> & {
  label: NonEmptyLabel<Label>
  icon: IconName
  variant?: ButtonVariant
  size?: ButtonSize
  pressed?: Reactive<boolean>
  loading?: Reactive<boolean>
  disabled?: Reactive<boolean | undefined>
}

export const IconButton = <Label extends string>({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  pressed,
  loading = false,
  disabled = false,
  type = 'button',
  ...rest
}: IconButtonProps<Label>) => {
  if (import.meta.env.DEV && !String(label ?? '').trim()) {
    throw new Error(`IconButton "${icon}" needs a non-empty accessible label`)
  }
  return (
  <button
    {...rest}
    type={type}
    attr:aria-label={label}
    attr:aria-pressed={
      pressed === undefined ? null : () => (read(pressed) ? 'true' : 'false')
    }
    attr:aria-busy={() => (read(loading) ? 'true' : null)}
    data-variant={variant}
    data-size={size}
    disabled={() => Boolean(read(disabled)) || read(loading)}
    css={`
      ${resetButton}
      ${buttonVariantStyles}
      display: inline-grid;
      place-items: center;
      flex: none;
      width: var(--hit);
      height: var(--hit);
      border: 1px solid var(--btn-line-now);
      border-radius: 12px;
      background: var(--btn-bg-now);
      box-shadow: var(--btn-shadow-now);
      color: var(--btn-fg-now);
      ${transition('box-shadow, transform, opacity')}

      &[aria-pressed='true'] {
        --btn-bg: var(--accent-soft);
        --btn-bg-hover: var(--accent-soft-hover);
        --btn-fg: var(--accent-text);
        --btn-fg-hover: var(--accent-text);
      }

      &:active:not(:disabled) {
        transform: scale(0.96);
      }

      &[data-size='sm'] {
        ${compactTarget('var(--control-height-compact)')}
        --visual-bg: var(--btn-bg-now);
        --visual-line: var(--btn-line-now);
        --visual-shadow: var(--btn-shadow-now);
        --visual-radius: 10px;
        box-shadow: none;

        &::before {
          inset-inline: calc((var(--hit) - var(--control-height-compact)) / 2);
        }
      }
    `}
  >
    {() =>
      read(loading) ? (
        <Spinner size="1.125rem" />
      ) : (
        <Icon name={icon} size={size === 'sm' ? '1.125rem' : '1.25rem'} />
      )
    }
  </button>
)
}
