import { atom, computed, peek, wrap } from '@reatom/core'

import { continueReply } from '../../chat/engine'
import { forkChat } from '../../chat/fork'
import { Icon } from '../../ui'
import type { NodeSlotProps } from '../slots'

const quietButton = `
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  height: 1.75rem;
  margin: 0;
  border: 0;
  padding: 0 0.4rem;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  letter-spacing: 0.01em;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--text);
    background: var(--surface-hover);
  }

  &:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }

  &[data-pending='true'] {
    color: var(--accent);
  }
`

export const ForkContinue = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const name = `features.thread.fork#${messageId}`
  const pending = atom(false, `${name}.pending`)
  const message = computed(() => node().message, `${name}.message`)
  const busy = computed(
    () => pending() || chat.streaming() !== null,
    `${name}.busy`,
  )
  const showContinue = computed(() => {
    if (pending()) return true
    const current = message()
    return (
      current.role === 'assistant' &&
      (current.status === 'cut-off' || current.error?.kind === 'cut-off')
    )
  }, `${name}.showContinue`)
  const continueLabel = computed(
    () => (pending() ? 'Continuing…' : 'Continue'),
    `${name}.continueLabel`,
  )

  const onFork = () => {
    const chatId = chat.id
    if (chatId === 'new' || busy()) return
    forkChat(chatId, message().id).catch(() => {})
  }

  const onContinue = async () => {
    const chatId = chat.id
    if (chatId === 'new' || busy()) return
    pending.set(true)
    try {
      await wrap(continueReply(chatId, message().id))
    } finally {
      pending.set(false)
    }
  }

  return (
    <div
      data-slot="ForkContinue"
      css="display: contents;"
    >
      <button
        type="button"
        css={quietButton}
        aria-label="Fork to new chat"
        prop:disabled={() => busy()}
        on:click={onFork}
      >
        <Icon name="branch" size="0.875rem" />
        Fork to new chat
      </button>
      {() =>
        showContinue() ? (
          <button
            type="button"
            css={quietButton}
            data-pending={() => (pending() ? 'true' : null)}
            aria-label={() => continueLabel()}
            prop:disabled={() => busy()}
            on:click={onContinue}
          >
            {() => continueLabel()}
          </button>
        ) : null
      }
    </div>
  )
}
