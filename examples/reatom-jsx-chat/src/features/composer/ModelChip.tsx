import { computed } from '@reatom/core'

import { ui } from '../../app/ui'
import { catalogById, catalogStatus } from '../../catalog'
import type { CatalogStatus } from '../../catalog'
import { Icon } from '../../ui'
import { Badge } from '../../ui'
import { compactTarget, resetButton } from '../../ui/mixins'
import type { ChatSlotProps } from '../slots'
import { customModelIds } from '../picker/model'

type ChipFace =
  | { kind: 'choose' }
  | { kind: 'known'; label: string }
  | { kind: 'custom'; id: string }
  | { kind: 'missing'; id: string }
  | { kind: 'pending'; id: string }

const catalogKnown = (status: CatalogStatus) =>
  status === 'ready' ||
  status === 'cached' ||
  status === 'stale' ||
  status === 'revalidating' ||
  status === 'empty'

const chipFace = (modelId: string | null, status: CatalogStatus): ChipFace => {
  if (!modelId) return { kind: 'choose' }
  const known = catalogById().get(modelId)
  if (known) return { kind: 'known', label: known.name }
  if (customModelIds().includes(modelId)) return { kind: 'custom', id: modelId }
  if (catalogKnown(status)) return { kind: 'missing', id: modelId }
  return { kind: 'pending', id: modelId }
}

export const ModelChip = ({ chat }: ChatSlotProps) => {
  const face = computed(
    () => chipFace(chat.model(), catalogStatus()),
    `features.modelChip.${chat.id}.face`,
  )
  return (
    <button
      type="button"
      data-slot="ModelChip"
      data-state={() => face().kind}
      data-tone={() => (face().kind === 'missing' ? 'warning' : 'neutral')}
      attr:aria-haspopup="dialog"
      attr:aria-expanded={() => (ui.picker() !== null ? 'true' : 'false')}
      on:click={() => ui.picker.set({ purpose: 'chat' })}
      css={`
        ${resetButton}
        ${compactTarget('var(--control-height-compact)')}
        --visual-bg: var(--bg-elevated);
        --visual-line: var(--line-strong);
        --visual-shadow: var(--shadow-1);
        display: inline-flex;
        align-items: center;
        gap: var(--space-1-5);
        max-width: min(18rem, 100%);
        padding: 0 var(--space-3);
        color: var(--text);
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        line-height: var(--leading-none);
        white-space: nowrap;
        cursor: pointer;

        &:hover {
          --visual-bg: var(--surface-hover);
        }

        &[data-tone='warning'] {
          --visual-bg: var(--warning-soft);
          --visual-line: var(--warning-line);
          color: var(--warning);
        }

        &[data-state='choose'] {
          color: var(--text-muted);
        }

        & [data-label] {
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}
    >
      {() => {
        const state = face()
        if (state.kind === 'choose') {
          return (
            <>
              <span data-label="">Choose a model</span>
              <Icon name="chevron-down" size="0.875rem" />
            </>
          )
        }
        if (state.kind === 'known' || state.kind === 'pending') {
          const label = state.kind === 'known' ? state.label : state.id
          return (
            <>
              <span data-label="">{label}</span>
              <Icon name="chevron-down" size="0.875rem" />
            </>
          )
        }
        if (state.kind === 'custom') {
          return (
            <>
              <span data-label="">{state.id}</span>
              <Badge tone="accent">Custom</Badge>
              <Icon name="chevron-down" size="0.875rem" />
            </>
          )
        }
        return (
          <>
            <Icon name="warning" size="1rem" />
            <span data-label="">{state.id}</span>
            <Badge tone="warning">Not in catalog</Badge>
            <Icon name="chevron-down" size="0.875rem" />
          </>
        )
      }}
    </button>
  )
}
