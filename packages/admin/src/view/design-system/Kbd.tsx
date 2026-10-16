import { tokens, type } from './tokens'

export interface KbdProps {
  /** Visible keycaps, in chord order. Example: `['Alt', 'Left']`. */
  keys: Array<string>
  /**
   * Accessible name of the whole chord. Defaults to the keycaps joined by
   * spaces.
   */
  label?: string
}

/** A keyboard chord. Not a control. */
export const Kbd = ({ keys, label }: KbdProps) => {
  return (
    <kbd
      data-reatom-name="Kbd"
      aria-label={label ?? keys.join(' ')}
      css={`
        ${type.meta}
        display: inline-flex;
        align-items: center;
        gap: var(--admin-space-2);
        padding-inline: var(--admin-space-4);
        color: ${tokens.text1};
        background: ${tokens.surface2};
        border: 1px solid ${tokens.border1};
        border-radius: var(--admin-radius-4);
        white-space: nowrap;
      `}
    >
      {keys.map((key) => (
        <span>{key}</span>
      ))}
    </kbd>
  )
}
