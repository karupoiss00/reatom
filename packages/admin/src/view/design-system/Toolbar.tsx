import { size, tokens } from './tokens'

export interface ToolbarProps {
  height?: string
  children?: Element | Array<Element | false | null>
}

export const Toolbar = ({
  height = size.toolbar,
  children,
}: ToolbarProps) => {
  return (
    <div
      css={`
        display: flex;
        align-items: center;
        flex-wrap: nowrap;
        gap: var(--admin-space-6);
        min-height: ${height};
        height: ${height};
        padding-inline: var(--admin-space-8);
        background: ${tokens.surface1};
        border-bottom: 1px solid ${tokens.border1};
        min-width: 0;
      `}
    >
      {children}
    </div>
  )
}

export const ToolbarGroup = ({
  children,
}: {
  children?: Element | Array<Element | false | null>
}) => (
  <div
    css={`
      display: flex;
      align-items: center;
      gap: var(--admin-space-4);
      min-width: 0;
    `}
  >
    {children}
  </div>
)

export const ToolbarSpacer = () => (
  <div
    css={`
      flex: 1 1 auto;
      min-width: 0;
    `}
  />
)
