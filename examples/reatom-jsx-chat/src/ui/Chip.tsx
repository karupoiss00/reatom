import type { JSX } from '@reatom/jsx'

import { Icon, type IconName } from './Icon'
import { compactTarget, read, resetButton, type Reactive } from './mixins'

export type ChipProps = Omit<JSX.IntrinsicElements['button'], 'disabled'> & {
  icon?: IconName
  selected?: Reactive<boolean>
  caret?: boolean
  disabled?: Reactive<boolean | undefined>
}

export const Chip = ({
  icon,
  selected,
  caret = false,
  disabled = false,
  type = 'button',
  children,
  ...rest
}: ChipProps) => (
  <button
    {...rest}
    type={type}
    attr:aria-pressed={
      selected === undefined ? null : () => (read(selected) ? 'true' : 'false')
    }
    disabled={() => Boolean(read(disabled))}
    css={`
      ${resetButton}
      ${compactTarget('var(--control-height-compact)')}
      --visual-bg: var(--bg-elevated);
      --visual-line: var(--line-strong);
      --visual-shadow: var(--shadow-1);
      display: inline-flex;
      align-items: center;
      gap: var(--space-1-5);
      max-width: 100%;
      padding: 0 var(--space-3);
      color: var(--text);
      font-size: var(--text-sm);
      font-weight: var(--weight-medium);
      line-height: var(--leading-none);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;

      & [data-chip-icon] {
        color: var(--text-muted);
      }

      &:hover:not(:disabled) {
        --visual-bg: var(--surface-hover);
      }

      &:active:not(:disabled) {
        --visual-bg: var(--surface-active);
      }

      &[aria-pressed='true'] {
        --visual-bg: var(--accent-soft);
        --visual-line: var(--accent-soft-hover);
        --visual-shadow: none;
        color: var(--accent-text);

        & [data-chip-icon] {
          color: var(--accent-text);
        }
      }

      &[aria-pressed='true']:hover:not(:disabled) {
        --visual-bg: var(--accent-soft-hover);
      }

      &:disabled {
        opacity: 0.45;
        --visual-shadow: none;
      }

      & [data-label] {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `}
  >
    {icon ? (
      <span data-chip-icon="" css="display: contents;">
        <Icon name={icon} size="1rem" />
      </span>
    ) : null}
    <span data-label="">{children}</span>
    {caret ? (
      <span data-chip-icon="" css="display: contents;">
        <Icon name="chevron-down" size="0.875rem" />
      </span>
    ) : null}
  </button>
)
