import type { JSX } from '@reatom/jsx'

import type { Tone } from '../styles/tokens'
import { Icon, type IconName } from './Icon'
import { IconButton } from './IconButton'
import { toneVars } from './mixins'

const toneIcons: Record<Tone, IconName> = {
  neutral: 'info',
  accent: 'sparkle',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
}

export type BannerProps = Omit<JSX.IntrinsicElements['div'], 'title'> & {
  tone?: Tone
  title: JSX.ElementChildren
  icon?: IconName
  actions?: JSX.ElementChildren
  onDismiss?: () => void
  dismissLabel?: string
}

export const Banner = ({
  tone = 'neutral',
  title,
  icon,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  children,
  ...rest
}: BannerProps) => (
  <div
    {...rest}
    data-tone={tone}
    css={`
      ${toneVars}
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: start;
      gap: var(--space-1) var(--space-3);
      padding: var(--space-3) var(--space-2) var(--space-3) var(--space-4);
      border: 1px solid var(--tone-line);
      border-radius: var(--radius-md);
      background: var(--tone-soft);
      color: var(--text);
      font-size: var(--text-sm);
      line-height: var(--leading-snug);

      & [data-banner-icon] {
        display: grid;
        place-items: center;
        height: 1.5rem;
        color: var(--tone-fg);
      }

      & [data-banner-body] {
        display: grid;
        gap: var(--space-0-5);
        min-width: 0;
        padding-block: var(--space-0-5);
        padding-inline-end: var(--space-2);
      }

      & [data-banner-title] {
        color: var(--tone-fg);
        font-weight: var(--weight-semibold);
      }

      & [data-banner-text] {
        color: var(--text);
      }

      & [data-banner-actions] {
        grid-column: 2 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        margin-top: var(--space-1);
      }

      & [data-banner-dismiss] {
        margin: calc(var(--space-3) * -1) 0;
      }
    `}
  >
    <span data-banner-icon="">
      <Icon name={icon ?? toneIcons[tone]} size="1.125rem" />
    </span>
    <div data-banner-body="">
      <strong data-banner-title="">{title}</strong>
      {children === undefined ? null : (
        <span data-banner-text="">{children}</span>
      )}
    </div>
    {onDismiss ? (
      <span data-banner-dismiss="">
        <IconButton
          icon="close"
          label={dismissLabel}
          size="sm"
          on:click={() => onDismiss()}
        />
      </span>
    ) : (
      <span />
    )}
    {actions === undefined ? null : <div data-banner-actions="">{actions}</div>}
  </div>
)
