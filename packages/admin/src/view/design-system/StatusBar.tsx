import { size, tokens, type } from './tokens'

export interface StatusBarProps {
  children?: Element | Array<Element | false | null> | (() => Element)
}

export const StatusBar = ({ children }: StatusBarProps) => {
  return (
    <footer
      css={`
        display: flex;
        align-items: center;
        gap: var(--admin-space-12);
        min-height: ${size.status};
        height: ${size.status};
        padding-inline: var(--admin-space-8);
        background: ${tokens.surface1};
        border-top: 1px solid ${tokens.border1};
        color: ${tokens.text2};
        ${type.meta}
        min-width: 0;
      `}
    >
      {children}
    </footer>
  )
}

export const StatusDot = ({
  tone,
  label,
}: {
  tone: 'success' | 'warning' | 'error' | 'info' | (() => 'success' | 'warning' | 'error' | 'info')
  label: string | (() => string)
}) => {
  const resolveTone = () => (typeof tone === 'function' ? tone() : tone)
  const color = () => {
    const current = resolveTone()
    if (current === 'success') return tokens.success
    if (current === 'warning') return tokens.warning
    if (current === 'error') return tokens.error
    return tokens.info
  }

  return (
    <span
      css={`
        display: inline-flex;
        align-items: center;
        gap: var(--admin-space-6);
        color: ${color};
      `}
    >
      <span
        aria-hidden="true"
        css={`
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: ${color};
        `}
      />
      {label}
    </span>
  )
}
