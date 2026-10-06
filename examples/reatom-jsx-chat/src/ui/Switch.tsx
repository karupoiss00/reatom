import { atom } from '@reatom/core'

import { ToggleText, toggleRowStyles, type ToggleProps } from './Checkbox'
import { read, uniqueId } from './mixins'

export const Switch = ({
  label,
  description,
  checked = atom(false, `${uniqueId('ui.switch')}.checked`),
  disabled = false,
  ...rest
}: ToggleProps) => (
  <label
    data-disabled={() => (read(disabled) ? 'true' : 'false')}
    css={`
      ${toggleRowStyles}

      & input {
        position: relative;
        width: 2.25rem;
        height: 1.375rem;
        border-radius: var(--radius-pill);
        background: var(--control-off);
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
      }

      & input::before {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: calc(1.375rem - 6px);
        height: calc(1.375rem - 6px);
        border-radius: 50%;
        background: #fffdf9;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 1px 1px rgba(0, 0, 0, 0.08);
        transition: transform var(--duration-base) var(--ease-emphasized);
      }

      & input:checked {
        background: var(--accent);
      }

      & input:checked::before {
        transform: translateX(0.875rem);
      }

      &:hover input:not(:disabled):not(:checked) {
        background: var(--text-muted);
      }

      & input:disabled {
        opacity: 0.45;
      }
    `}
  >
    <ToggleText label={label} description={description} />
    <input
      {...rest}
      type="checkbox"
      attr:role="switch"
      model:checked={checked}
      disabled={() => Boolean(read(disabled))}
    />
  </label>
)
