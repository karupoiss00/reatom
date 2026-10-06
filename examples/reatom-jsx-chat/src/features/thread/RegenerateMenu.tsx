import { computed, peek } from '@reatom/core'

import { ui } from '../../app/ui'
import { regenerate } from '../../chat/engine'
import { Icon, Menu } from '../../ui'
import type { NodeSlotProps } from '../slots'

const quietButton = `
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  height: 1.75rem;
  margin: 0;
  padding: 0 0.4rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.75rem;
  letter-spacing: 0.01em;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-hover);
  }

  &:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 2px;
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
`

export const RegenerateMenu = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const name = `features.thread.regenerate#${messageId}`
  const streaming = computed(
    () => chat.streaming() !== null,
    `${name}.streaming`,
  )

  const regenerateHere = () => {
    if (chat.streaming() !== null || chat.id === 'new') return
    regenerate(chat.id, messageId)
  }

  const regenerateWith = () => {
    if (chat.streaming() !== null) return
    ui.picker.set({ purpose: 'regenerate', messageId })
  }

  return (
    <div
      data-slot="RegenerateMenu"
      css={`
        display: inline-flex;
        align-items: center;
        gap: 0.1rem;
      `}
    >
      <button
        type="button"
        aria-label="Regenerate"
        css={quietButton}
        prop:disabled={() => streaming()}
        on:click={regenerateHere}
      >
        <Icon name="regenerate" size="0.875rem" />
        Regenerate
      </button>
      <Menu
        label="Regenerate options"
        placement="bottom-start"
        items={() => [
          {
            label: 'Regenerate with…',
            icon: 'sparkle',
            disabled: streaming(),
            onSelect: regenerateWith,
          },
        ]}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label="More ways to regenerate"
            css={`
              ${quietButton}
              min-width: 1.75rem;
              padding: 0;
            `}
            prop:disabled={() => streaming()}
          >
            <Icon name="chevron-down" size="0.875rem" />
          </button>
        )}
      />
    </div>
  )
}
