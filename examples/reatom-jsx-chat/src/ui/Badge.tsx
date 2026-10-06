import type { JSX } from '@reatom/jsx'

import type { Tone } from '../styles/tokens'
import { Icon, type IconName } from './Icon'
import { toneVars, type Reactive } from './mixins'

export type BadgeProps = Omit<JSX.IntrinsicElements['span'], 'children'> & {
  children?: JSX.ElementChildren
  tone?: Reactive<Tone>
  icon?: IconName
}

export const Badge = ({
  tone = 'neutral',
  icon,
  children,
  ...rest
}: BadgeProps) => (
  <span
    {...rest}
    data-tone={tone}
    css={`
      ${toneVars}
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      min-height: 1.375rem;
      padding: 0 var(--space-2);
      border: 1px solid var(--tone-line);
      border-radius: var(--radius-pill);
      background: var(--tone-soft);
      color: var(--tone-fg);
      font-size: var(--text-xs);
      font-weight: var(--weight-medium);
      line-height: var(--leading-none);
      letter-spacing: 0.01em;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    `}
  >
    {icon ? <Icon name={icon} size="0.875rem" /> : null}
    {children}
  </span>
)
