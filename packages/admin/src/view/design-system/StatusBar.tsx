import { capturingPulse } from './mixins'
import { size, tokens, type } from './tokens'

export interface StatusBarProps {
  children?:
    | Element
    | Array<Element | false | null | (() => Element | null)>
    | (() => Element | null)
}

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'accent'

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
  pulse,
}: {
  tone: StatusTone | (() => StatusTone)
  label: string | (() => string)
  pulse?: boolean | (() => boolean)
}) => {
  const resolveTone = () => (typeof tone === 'function' ? tone() : tone)
  const color = () => {
    const current = resolveTone()
    if (current === 'success') return tokens.success
    if (current === 'warning') return tokens.warning
    if (current === 'error') return tokens.error
    if (current === 'accent') return tokens.accent
    return tokens.info
  }
  const pulsing = () =>
    typeof pulse === 'function' ? pulse() : pulse === true

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
        data-pulse={() => (pulsing() ? 'true' : 'false')}
        css={`
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: ${color};
          &[data-pulse='true'] {
            ${capturingPulse}
          }
        `}
      />
      {label}
    </span>
  )
}
