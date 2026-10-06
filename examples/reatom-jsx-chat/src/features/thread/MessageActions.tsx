import { atom, computed, peek, wrap } from '@reatom/core'

import { retry } from '../../chat/engine'
import { copyText } from '../../platform/clipboard'
import { Icon } from '../../ui'
import type { NodeSlotProps } from '../slots'

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const actionButton = `
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

  &:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  &:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
`

export const MessageActions = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const name = `features.thread.actions#${messageId}`
  const copyPhase = atom<'idle' | 'copied' | 'failed'>('idle', `${name}.copy`)
  const role = computed(() => node().message.role, `${name}.role`)
  const copyLabel = computed(
    () => (role() === 'user' ? 'Copy message' : 'Copy reply'),
    `${name}.copyLabel`,
  )

  const onCopy = async () => {
    const copied = await wrap(copyText(node().message.content))
    if (!copied) {
      copyPhase.set('failed')
      return
    }
    copyPhase.set('copied')
    await wrap(pause(2000))
    if (copyPhase() === 'copied') copyPhase.set('idle')
  }

  return (
    <div
      data-slot="MessageActions"
      css="display: contents;"
    >
      {() =>
        node().message.content.length === 0 ? null : (
          <button
            type="button"
            css={actionButton}
            aria-label={() => copyLabel()}
            on:click={onCopy}
          >
            <Icon name="copy" size="0.875rem" />
            {() => (copyPhase() === 'copied' ? 'Copied' : 'Copy')}
          </button>
        )
      }
      {() =>
        copyPhase() === 'failed' ? (
          <span
            css={`
              color: var(--text-muted);
              font-size: var(--text-xs);
            `}
          >
            Couldn't copy. Select the text instead.
          </span>
        ) : null
      }
      {() => {
        const message = node().message
        if (message.role !== 'assistant' || message.status !== 'interrupted') {
          return null
        }
        return (
          <button
            type="button"
            css={actionButton}
            on:click={() => retry(chat.id, messageId)}
          >
            Retry
          </button>
        )
      }}
    </div>
  )
}
