import { controlBase, interactive } from './mixins'
import { radius, size, soft, tokens } from './tokens'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'

export interface ButtonProps {
  variant?: ButtonVariant
  label: string
  type?: 'button' | 'submit'
  disabled?: boolean | (() => boolean)
  pressed?: boolean | (() => boolean)
  title?: string | (() => string)
  testId?: string
  onClick: () => void
  children?: Element | string | Array<Element | string> | (() => string)
}

function resolveFlag(value: boolean | (() => boolean) | undefined): boolean {
  if (typeof value === 'function') return value()
  return value === true
}

function variantCss(variant: ButtonVariant, pressed: boolean): string {
  if (variant === 'primary') {
    return `
      background: ${soft(tokens.accent, 18)};
      border-color: ${tokens.accent};
      color: ${tokens.text1};
    `
  }
  if (variant === 'danger') {
    return `
      background: ${pressed ? soft(tokens.error, 16) : 'transparent'};
      border-color: ${tokens.error};
      color: ${tokens.error};
    `
  }
  if (variant === 'icon') {
    return `
      width: ${size.control};
      padding: 0;
      justify-content: center;
      background: ${pressed ? soft(tokens.accent, 16) : 'transparent'};
      border-color: ${pressed ? tokens.accent : tokens.border1};
      color: ${pressed ? tokens.text1 : tokens.text2};
    `
  }
  if (variant === 'ghost') {
    return `
      background: ${pressed ? tokens.accent : 'transparent'};
      border-color: ${pressed ? tokens.accent : tokens.border1};
      color: ${pressed ? tokens.canvas : tokens.text2};
    `
  }
  return `
    background: ${pressed ? soft(tokens.accent, 16) : tokens.surface2};
    border-color: ${pressed ? tokens.accent : tokens.border1};
    color: ${tokens.text1};
  `
}

export const Button = ({
  variant = 'secondary',
  label,
  type = 'button',
  disabled,
  pressed,
  title,
  testId,
  onClick,
  children,
}: ButtonProps) => {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      data-testid={testId}
      data-variant={variant}
      prop:disabled={() => resolveFlag(disabled)}
      aria-pressed={() =>
        pressed === undefined ? undefined : resolveFlag(pressed)
      }
      css={`
        ${controlBase}
        ${interactive}
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--admin-space-6);
        padding-inline: ${variant === 'icon' ? '0' : 'var(--admin-space-8)'};
        white-space: nowrap;
        ${variantCss(variant, false)}
        &[aria-pressed='true'] {
          ${variantCss(variant, true)}
        }
        &:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        &:hover:not(:disabled) {
          background: ${soft(tokens.accent, 12)};
        }
        &[data-variant='ghost'][aria-pressed='true']:hover:not(:disabled) {
          background: ${tokens.accentStrong};
        }
      `}
      on:click={onClick}
    >
      {children ?? label}
    </button>
  )
}

export const ToolbarSeparator = () => (
  <span
    aria-hidden="true"
    css={`
      width: 1px;
      align-self: stretch;
      background: ${tokens.border1};
      border-radius: ${radius[2]};
    `}
  />
)
