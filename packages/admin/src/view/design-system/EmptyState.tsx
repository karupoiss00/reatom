import { Icon, type IconName } from './Icon'
import { focusVisible } from './mixins'
import { kindTokens, tokens, type } from './tokens'

export interface EmptyStateProps {
  title: string
  description: string
  action?: Element | null
  icon?: IconName
  iconKind?: keyof typeof kindTokens
  docsHref?: string
  docsLabel?: string
  detail?: Element | null
  testId?: string
}

export const EmptyState = ({
  title,
  description,
  action = null,
  icon,
  iconKind = 'action',
  docsHref,
  docsLabel = 'Docs',
  detail = null,
  testId,
}: EmptyStateProps) => {
  return (
    <div
      data-testid={testId}
      css={`
        display: grid;
        justify-items: start;
        gap: var(--admin-space-8);
        align-content: start;
        max-width: 360px;
        padding: var(--admin-space-16);
        color: ${tokens.text1};
      `}
    >
      {icon === undefined ? null : (
        <span
          css={`
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            border-radius: var(--admin-radius-6);
            border: 1px solid ${tokens.border1};
            color: ${kindTokens[iconKind]};
          `}
        >
          <Icon name={icon} />
        </span>
      )}
      <h3
        css={`
          ${type.title}
          margin: 0;
        `}
      >
        {title}
      </h3>
      <p
        css={`
          ${type.ui}
          margin: 0;
          color: ${tokens.text2};
        `}
      >
        {description}
      </p>
      {detail}
      {action}
      {docsHref === undefined ? null : (
        <a
          href={docsHref}
          css={`
            ${type.ui}
            ${focusVisible}
            color: ${tokens.text2};
            text-decoration: none;
            border: 1px solid ${tokens.border1};
            border-radius: var(--admin-radius-4);
            padding: var(--admin-space-4) var(--admin-space-8);
          `}
        >
          {docsLabel}
        </a>
      )}
    </div>
  )
}
