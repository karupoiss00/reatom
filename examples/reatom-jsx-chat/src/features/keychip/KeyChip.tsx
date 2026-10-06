import type { JSX } from '@reatom/jsx'

import { Badge, Icon, Popover, Skeleton } from '../../ui'
import { compactTarget, resetButton } from '../../ui/mixins'
import { KeyMenu } from './KeyMenu'
import {
  chipState,
  forgetArmed,
  keyMenuOpen,
  retryLimit,
  type ChipState,
} from './model'

const chipButtonStyles = `
  ${resetButton}
  ${compactTarget('var(--control-height-compact)')}
  --visual-bg: var(--bg-elevated);
  --visual-line: var(--line-strong);
  --visual-shadow: var(--shadow-1);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  max-width: 100%;
  padding: 0 var(--space-3);
  color: var(--text);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-none);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover:not(:disabled) {
    --visual-bg: var(--surface-hover);
  }

  &[data-tone='warning'] {
    --visual-bg: var(--warning-soft);
    --visual-line: var(--warning-line);
    color: var(--warning);
  }

  &[data-tone='warning']:hover:not(:disabled) {
    --visual-bg: var(--warning-soft);
  }

  &[data-badge='true'] {
    --visual-bg: transparent;
    --visual-line: transparent;
    --visual-shadow: none;
    overflow: visible;
    flex: none;
    min-width: max(var(--hit), max-content);
    max-width: none;
    padding-inline: 0;
    gap: 0;
  }

  &[data-badge='true']::before {
    height: 1.375rem;
  }

  &[data-badge='true']:hover:not(:disabled),
  &[data-badge='true']:active:not(:disabled) {
    --visual-bg: transparent;
    --visual-line: transparent;
    --visual-shadow: none;
  }

  &[data-badge='true']:hover:not(:disabled) [data-tone='warning'] {
    background: color-mix(in srgb, var(--warning-soft) 78%, var(--warning));
  }

  &:disabled {
    cursor: default;
  }

  & [data-label] {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`

const chipTone = (state: ChipState): 'warning' | null => {
  if (state.kind === 'capped' && state.low) return 'warning'
  if (state.kind === 'unlimited') return 'warning'
  return null
}

const chipLabel = (state: ChipState): string | null => {
  if (state.kind === 'capped') {
    return state.low ? `${state.label}, low` : state.label
  }
  if (state.kind === 'unlimited') return 'No limit'
  return null
}

const ReadyFace = ({ state }: { state: ChipState }) => {
  if (state.kind === 'unlimited' && state.acknowledged) {
    return (
      <span
        css={`
          display: inline-flex;
          align-items: center;
          gap: var(--space-1);
        `}
      >
        <Badge tone="warning" icon="warning">
          No limit
          <Icon name="chevron-down" size="0.75rem" />
        </Badge>
      </span>
    )
  }
  if (state.kind === 'unlimited') {
    return (
      <>
        <Icon name="warning" size="1rem" />
        <span data-label="">No limit</span>
        <Icon name="chevron-down" size="0.875rem" />
      </>
    )
  }
  if (state.kind === 'capped') {
    return (
      <>
        <Icon name={state.low ? 'warning' : 'key'} size="1rem" />
        <span data-label="">{state.label}</span>
        <Icon name="chevron-down" size="0.875rem" />
      </>
    )
  }
  return null
}

const ReadyChip = () => (
  <Popover
    label="API key"
    role="dialog"
    placement="bottom-end"
    open={keyMenuOpen}
    width="22rem"
    maxHeight="none"
    trigger={(props) =>
      (
        <button
          {...props}
          type="button"
          data-slot="KeyChip"
          data-tone={() => chipTone(chipState())}
          data-badge={() => {
            const state = chipState()
            return state.kind === 'unlimited' && state.acknowledged
              ? 'true'
              : 'false'
          }}
          attr:aria-label={() => chipLabel(chipState())}
          css={chipButtonStyles}
        >
          {() => <ReadyFace state={chipState()} />}
        </button>
      ) as HTMLElement
    }
  >
    {() => <KeyMenu />}
  </Popover>
)

const LoadingChip = () => (
  <button
    type="button"
    data-slot="KeyChip"
    aria-busy="true"
    aria-label="Loading key limit"
    disabled
    css={`
      ${chipButtonStyles}
      cursor: default;
    `}
  >
    <Skeleton width="5.75rem" height="0.875rem" radius="var(--radius-pill)" />
  </button>
)

const UnavailableChip = () => (
  <button
    type="button"
    data-slot="KeyChip"
    aria-label="Limit unavailable"
    on:click={() => retryLimit()}
    css={chipButtonStyles}
  >
    <Icon name="regenerate" size="1rem" />
    <span data-label="">Limit unavailable</span>
  </button>
)

const ChipBody = (): JSX.Element => {
  const state = chipState()
  if (state.kind === 'loading') return <LoadingChip />
  if (state.kind === 'unavailable') return <UnavailableChip />
  return <ReadyChip />
}

export const KeyChip = () => (
  <span
    css="display: contents;"
    ref={() =>
      keyMenuOpen.subscribe((open) => {
        if (!open) forgetArmed.set(false)
      })
    }
  >
    {() => (chipState().kind === 'hidden' ? null : <ChipBody />)}
  </span>
)
