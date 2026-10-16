import { tokens, type } from './tokens'

export interface EmptyStateProps {
  title: string
  description: string
  action?: Element | null
}

export const EmptyState = ({
  title,
  description,
  action = null,
}: EmptyStateProps) => {
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-8);
        align-content: start;
        padding: var(--admin-space-16);
        color: ${tokens.text1};
      `}
    >
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
          ${type.body}
          margin: 0;
          color: ${tokens.text2};
        `}
      >
        {description}
      </p>
      {action}
    </div>
  )
}
