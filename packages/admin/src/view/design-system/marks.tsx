import { hairline } from './mixins'
import { tokens, type } from './tokens'

export type KpiTone = 'default' | 'muted' | 'warning' | 'error'

export const Eyebrow = ({
  children,
  summary,
  heading = false,
}: {
  children: string | (() => string)
  summary?: string | (() => string)
  heading?: boolean
}) => {
  const Title = heading ? 'h2' : 'p'
  return (
    <div
      css={`
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--admin-space-8);
      `}
    >
      <Title
        css={`
          ${type.eyebrow}
          margin: 0;
          color: ${tokens.text3};
        `}
      >
        {children}
      </Title>
      {summary === undefined ? null : (
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
          `}
        >
          {summary}
        </span>
      )}
    </div>
  )
}

export const CodeChip = ({ children }: { children: string }) => (
  <code
    css={`
      display: inline-flex;
      align-items: center;
      padding: 0 var(--admin-space-4);
      border-radius: var(--admin-radius-4);
      background: ${tokens.surface3};
      color: ${tokens.text1};
      font-family: ${tokens.fontData};
      font-size: 11px;
      line-height: 18px;
    `}
  >
    {children}
  </code>
)

export const KpiCell = ({
  id,
  label,
  value,
  caption,
  delta,
  tone = 'default',
  onClick,
}: {
  id: string
  label: string
  value: string | (() => string)
  caption?: string | (() => string)
  delta?: string
  tone?: KpiTone | (() => KpiTone)
  onClick?: () => void
}) => (
  <div
    data-testid={`analytics-kpi-${id}`}
    data-clickable={onClick ? 'true' : undefined}
    role={onClick ? 'button' : undefined}
    tabindex={onClick ? 0 : undefined}
    on:click={onClick}
    on:keydown={
      onClick
        ? (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onClick()
          }
        : undefined
    }
    css={`
      display: grid;
      gap: var(--admin-space-4);
      min-width: 7rem;
      padding-inline: var(--admin-space-12);
      border-inline-end: ${hairline};
      &:last-child {
        border-inline-end: 0;
      }
      &[data-clickable='true'] {
        cursor: pointer;
      }
    `}
  >
    <span
      css={`
        ${type.eyebrow}
        color: ${tokens.text3};
      `}
    >
      {label}
    </span>
    <span
      data-tone={() => (typeof tone === 'function' ? tone() : tone)}
      css={`
        ${type.kpi}
        color: ${tokens.text1};
        &[data-tone='muted'] {
          color: ${tokens.text2};
        }
        &[data-tone='warning'] {
          color: ${tokens.warning};
        }
        &[data-tone='error'] {
          color: ${tokens.error};
        }
      `}
    >
      {value}
      {delta === undefined ? null : (
        <span
          css={`
            ${type.meta}
            margin-inline-start: var(--admin-space-6);
            color: ${tokens.text3};
            font-weight: 500;
          `}
        >
          {delta}
        </span>
      )}
    </span>
    {caption === undefined ? null : (
      <span
        css={`
          ${type.meta}
          color: ${tokens.text2};
        `}
      >
        {caption}
      </span>
    )}
  </div>
)

export const FunnelTrack = ({
  label,
  meta,
  fill,
  color = tokens.accent,
  onClick,
}: {
  label: string
  meta: string
  fill: number
  color?: string
  onClick?: () => void
}) => {
  const width = `${Math.max(0, Math.min(1, fill)) * 100}%`
  return (
    <div
      data-clickable={onClick ? 'true' : undefined}
      role={onClick ? 'button' : undefined}
      tabindex={onClick ? 0 : undefined}
      on:click={onClick}
      on:keydown={
        onClick
          ? (event: KeyboardEvent) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onClick()
            }
          : undefined
      }
      css={`
        display: grid;
        gap: var(--admin-space-4);
        min-width: 0;
        &[data-clickable='true'] {
          cursor: pointer;
        }
      `}
    >
      <div
        css={`
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--admin-space-8);
          min-width: 0;
        `}
      >
        <span
          css={`
            ${type.ui}
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: ${tokens.text1};
          `}
        >
          {label}
        </span>
        <span
          css={`
            ${type.meta}
            flex: none;
            color: ${tokens.text3};
            font-variant-numeric: tabular-nums;
          `}
        >
          {meta}
        </span>
      </div>
      <span
        css={`
          display: block;
          height: 6px;
          border-radius: var(--admin-radius-2);
          background: ${tokens.surface2};
          overflow: hidden;
        `}
      >
        <span
          style:width={width}
          css={`
            display: block;
            height: 100%;
            border-radius: var(--admin-radius-2);
            background: ${color};
          `}
        />
      </span>
    </div>
  )
}
