import { atom, type Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { read, uniqueId, transition, type Reactive } from './mixins'

export type ToggleProps = Omit<
  JSX.IntrinsicElements['input'],
  'checked' | 'disabled' | 'type'
> & {
  label: JSX.ElementChildren
  description?: JSX.ElementChildren
  checked?: Atom<boolean>
  disabled?: Reactive<boolean | undefined>
}

export const toggleRowStyles = `
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--hit);
  min-width: var(--hit);
  padding-block: var(--space-1);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &[data-disabled='true'] {
    cursor: not-allowed;
  }

  & [data-toggle-text] {
    display: grid;
    gap: var(--space-0-5);
    min-width: 0;
    flex: 1;
  }

  & [data-toggle-label] {
    color: var(--text);
    font-size: var(--text-base);
    line-height: var(--leading-snug);
  }

  & [data-toggle-description] {
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }

  &[data-disabled='true'] [data-toggle-label],
  &[data-disabled='true'] [data-toggle-description] {
    color: var(--text-disabled);
  }

  & input {
    flex: none;
    appearance: none;
    margin: 0;
    cursor: inherit;
    ${transition('background-color, border-color, box-shadow')}
  }
`

export const ToggleText = ({
  label,
  description,
}: Pick<ToggleProps, 'label' | 'description'>) => (
  <span data-toggle-text="">
    <span data-toggle-label="">{label}</span>
    {description === undefined ? null : (
      <span data-toggle-description="">{description}</span>
    )}
  </span>
)

export const Checkbox = ({
  label,
  description,
  checked = atom(false, `${uniqueId('ui.checkbox')}.checked`),
  disabled = false,
  ...rest
}: ToggleProps) => (
  <label
    data-disabled={() => (read(disabled) ? 'true' : 'false')}
    css={`
      ${toggleRowStyles}

      & input {
        position: relative;
        width: 1.125rem;
        height: 1.125rem;
        border: 1.5px solid var(--control-off);
        border-radius: 5px;
        background: var(--bg-elevated);
      }

      & input::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 45%;
        width: 0.3rem;
        height: 0.6rem;
        border: solid var(--accent-ink);
        border-width: 0 2px 2px 0;
        transform: translate(-50%, -50%) rotate(45deg) scale(0.6);
        opacity: 0;
        transition: opacity var(--duration-fast) var(--ease-standard),
          transform var(--duration-fast) var(--ease-emphasized);
      }

      & input:checked {
        border-color: var(--accent);
        background: var(--accent);
      }

      & input:checked::after {
        opacity: 1;
        transform: translate(-50%, -50%) rotate(45deg) scale(1);
      }

      &:hover input:not(:disabled):not(:checked) {
        border-color: var(--text-muted);
      }

      & input:disabled {
        opacity: 0.45;
      }
    `}
  >
    <input
      {...rest}
      type="checkbox"
      model:checked={checked}
      disabled={() => Boolean(read(disabled))}
    />
    <ToggleText label={label} description={description} />
  </label>
)
