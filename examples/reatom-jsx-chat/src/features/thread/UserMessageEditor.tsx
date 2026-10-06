import { atom, computed, peek } from '@reatom/core'

import { ui } from '../../app/ui'
import { editAndSend } from '../../chat/engine'
import type { AttachmentRef } from '../../storage/types'
import { AutoGrowTextarea, Button, Icon } from '../../ui'
import type { NodeSlotProps } from '../slots'

const isImeEnter = (event: KeyboardEvent) =>
  event.isComposing || event.keyCode === 229

const sameAttachments = (
  left: readonly AttachmentRef[],
  right: readonly AttachmentRef[],
) =>
  left.length === right.length &&
  left.every((ref, index) => ref.id === right[index]?.id)

export const UserMessageEditor = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const opened = peek(node).message
  const name = `features.thread.editor#${messageId}`
  const draft = atom(
    opened.role === 'user' ? opened.content : '',
    `${name}.draft`,
  )
  const kept = atom(
    opened.role === 'user' ? opened.attachments : [],
    `${name}.kept`,
  )
  const saveDisabled = computed(() => {
    const text = draft()
    if (text.trim().length === 0) return true
    const current = node().message
    if (current.role !== 'user') return true
    return (
      text === current.content && sameAttachments(kept(), current.attachments)
    )
  }, `${name}.saveDisabled`)

  const discard = () => {
    ui.editing.set(null)
  }

  const save = () => {
    if (saveDisabled() || chat.streaming() !== null || chat.id === 'new') return
    const text = draft()
    const attachments = kept()
    ui.editing.set(null)
    editAndSend(chat.id, messageId, { text, attachments })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      discard()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || isImeEnter(event)) return
    event.preventDefault()
    save()
  }

  return (
    <form
      data-slot="UserMessageEditor"
      on:submit={(event) => event.preventDefault()}
      on:keydown={onKeyDown}
      ref={(form: HTMLFormElement) => {
        form.querySelector('textarea')?.focus({ preventScroll: true })
      }}
      css={`
        display: grid;
        align-content: start;
        gap: var(--space-3);
      `}
    >
      <AutoGrowTextarea value={draft} label="Edit message" variant="bare" />
      {() =>
        kept().length === 0 ? null : (
          <ul
            css={`
              display: flex;
              flex-wrap: wrap;
              gap: var(--space-2);
              margin: 0;
              padding: 0;
              list-style: none;
            `}
          >
            {kept().map((ref) => (
              <li
                css={`
                  display: inline-flex;
                  align-items: center;
                  gap: var(--space-2);
                  max-width: 100%;
                  min-height: 2rem;
                  padding: 0 0.3rem 0 0.7rem;
                  border: 1px solid var(--line);
                  border-radius: var(--radius-pill);
                  background: var(--surface);
                  color: var(--text);
                  font-size: var(--text-sm);
                `}
              >
                <Icon
                  name={ref.kind === 'image' ? 'image' : 'file'}
                  size="0.95rem"
                />
                <span
                  css={`
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  `}
                >
                  {ref.name}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${ref.name}`}
                  on:click={() =>
                    kept.set((attachments) =>
                      attachments.filter((item) => item.id !== ref.id),
                    )
                  }
                  css={`
                    appearance: none;
                    display: inline-grid;
                    place-items: center;
                    width: 1.5rem;
                    height: 1.5rem;
                    margin: 0;
                    padding: 0;
                    border: 0;
                    border-radius: var(--radius-pill);
                    background: none;
                    color: var(--text-muted);
                    cursor: pointer;

                    &:hover {
                      color: var(--text);
                      background: var(--surface-hover);
                    }

                    &:focus-visible {
                      outline: var(--focus-width) solid var(--focus);
                      outline-offset: 2px;
                    }
                  `}
                >
                  <Icon name="close" size="0.85rem" />
                </button>
              </li>
            ))}
          </ul>
        )
      }
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: var(--space-2);
        `}
      >
        <Button size="sm" variant="ghost" on:click={discard}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={saveDisabled}
          on:click={save}
        >
          Save & send
        </Button>
      </div>
    </form>
  )
}
