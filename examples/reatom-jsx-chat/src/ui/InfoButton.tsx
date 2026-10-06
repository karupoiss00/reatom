import type { JSX } from '@reatom/jsx'

import { IconButton } from './IconButton'
import { Popover, type PopoverPlacement } from './Popover'
import { Tooltip } from './Tooltip'

export type InfoButtonMode = 'click' | 'hover'

export type InfoButtonProps = {
  label: string
  title?: string
  children: JSX.ElementChildren
  placement?: PopoverPlacement
  mode?: InfoButtonMode
}

const explanation = (title: string | undefined, children: JSX.ElementChildren) => (
  <div
    css={`
      display: grid;
      gap: var(--space-1);

      & strong {
        font-weight: var(--weight-semibold);
      }
    `}
  >
    {title ? <strong>{title}</strong> : null}
    <span>{children}</span>
  </div>
)

export const InfoButton = ({
  label,
  title,
  children,
  placement = 'bottom-start',
  mode = 'click',
}: InfoButtonProps) => {
  if (mode === 'hover') {
    return (
      <Tooltip placement={placement} label={explanation(title, children)}>
        <IconButton icon="info" label={label} size="sm" />
      </Tooltip>
    )
  }
  return (
    <Popover
      label={title ?? label}
      role="dialog"
      placement={placement}
      width="17rem"
      onOpen={(panel) => panel.focus()}
      trigger={(props) => (
        <IconButton icon="info" label={label} size="sm" {...props} />
      )}
    >
      {() => (
        <div
          css={`
            display: grid;
            gap: var(--space-1);
            padding: var(--space-2) var(--space-3);
            line-height: var(--leading-snug);

            & strong {
              font-weight: var(--weight-semibold);
            }

            & p {
              margin: 0;
              color: var(--text-muted);
            }
          `}
        >
          {title ? <strong>{title}</strong> : null}
          <p>{children}</p>
        </div>
      )}
    </Popover>
  )
}
