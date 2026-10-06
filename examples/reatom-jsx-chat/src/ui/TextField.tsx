import { atom, type Atom } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { Icon, type IconName } from './Icon'
import { read, transition, uniqueId, visuallyHidden, type Reactive } from './mixins'

export const fieldBoxStyles = `
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--line-input);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: inset 0 1px 1px rgba(40, 36, 28, 0.03);
  color: var(--text);
  ${transition('border-color, box-shadow, background-color')}

  &:hover {
    border-color: var(--control-off);
  }

  &:focus-within {
    border-color: var(--focus);
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 0;
  }

  &[data-invalid='true'] {
    border-color: var(--danger);
  }

  &[data-invalid='true']:focus-within {
    outline-color: var(--danger);
  }

  &[data-disabled='true'] {
    background: var(--bg-sunken);
    border-color: var(--line);
    color: var(--text-disabled);
    cursor: not-allowed;
  }

  &[data-has-trailing='true'] {
    padding-inline-end: var(--space-1);
  }

  & [data-field-icon] {
    display: grid;
    color: var(--text-muted);
  }
`

export const fieldMessageStyles = `
  & [data-field-label] {
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-snug);
  }

  & [data-field-hint] {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
  }

  & [data-field-error] {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1);
    margin: 0;
    color: var(--danger);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: var(--leading-snug);
  }

  & [data-field-error]:empty {
    display: none;
  }
`

export type TextFieldProps = Omit<
  JSX.IntrinsicElements['input'],
  'value' | 'disabled'
> & {
  label: string
  value?: Atom<string>
  hint?: JSX.ElementChildren
  error?: Reactive<string | null | undefined>
  labelHidden?: boolean
  leadingIcon?: IconName
  trailing?: JSX.ElementChildren
  disabled?: Reactive<boolean | undefined>
}

export const TextField = ({
  label,
  value = atom('', `${uniqueId('ui.textField')}.value`),
  hint,
  error = null,
  labelHidden = false,
  leadingIcon,
  trailing,
  disabled = false,
  type = 'text',
  ...rest
}: TextFieldProps) => {
  const inputId = uniqueId('field')
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const errorText = () => read(error) || null
  const isInvalid = () => (errorText() ? 'true' : 'false')
  const isDisabled = () => (read(disabled) ? 'true' : 'false')

  return (
    <div
      data-field=""
      css={`
        ${fieldMessageStyles}
        display: grid;
        gap: var(--space-1-5);
        min-width: 0;

        & input {
          flex: 1;
          min-width: 0;
          height: calc(var(--control-height) - 2px);
          padding: 0;
          border: 0;
          background: transparent;
          font-size: var(--text-base);
          outline: none;
        }

        & input:disabled {
          cursor: not-allowed;
        }

        & [data-label-hidden='true'] {
          ${visuallyHidden}
        }
      `}
    >
      <label
        for={inputId}
        data-field-label=""
        data-label-hidden={labelHidden ? 'true' : 'false'}
      >
        {label}
      </label>
      <div
        data-field-box=""
        data-invalid={isInvalid}
        data-disabled={isDisabled}
        data-has-trailing={trailing === undefined ? 'false' : 'true'}
        css={fieldBoxStyles}
      >
        {leadingIcon ? (
          <span data-field-icon="">
            <Icon name={leadingIcon} size="1.125rem" />
          </span>
        ) : null}
        <input
          {...rest}
          id={inputId}
          type={type}
          model:value={value}
          disabled={() => Boolean(read(disabled))}
          attr:aria-invalid={isInvalid}
          attr:aria-describedby={() =>
            [hint === undefined ? null : hintId, errorText() ? errorId : null]
              .filter(Boolean)
              .join(' ') || null
          }
        />
        {trailing ?? null}
      </div>
      {hint === undefined ? null : (
        <p data-field-hint="" id={hintId}>
          {hint}
        </p>
      )}
      <p data-field-error="" id={errorId}>
        {() => {
          const message = errorText()
          return message
            ? [<Icon name="danger" size="0.875rem" />, <span>{message}</span>]
            : null
        }}
      </p>
    </div>
  )
}
