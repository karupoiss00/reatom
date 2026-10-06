import { action, computed, peek, wrap } from '@reatom/core'

import { ui } from '../../app/ui'
import { activeChat } from '../../chat'
import { Icon } from '../../ui'
import type { NodeSlotProps } from '../slots'

const quietButton = `
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  min-width: 1.25rem;
  margin: 0;
  padding: 0 0.35rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
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

const stepButton = `
  ${quietButton}
  width: 1.5rem;
  min-width: 1.5rem;
  padding: 0;
`

const editFromArrow = action((event: KeyboardEvent) => {
  if (event.key !== 'ArrowUp') return
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.defaultPrevented || event.isComposing) return
  const target = event.target
  if (!(target instanceof HTMLTextAreaElement)) return
  if (!target.closest('[data-slot="Composer"]')) return
  const chat = activeChat()
  if (chat.draft.text().length > 0 || chat.draft.attachments().length > 0) return
  if (chat.streaming() !== null) return
  if (ui.editing() !== null || ui.picker() !== null || ui.openLayerCount() > 0)
    return
  const lastUser = chat
    .path()
    .findLast((node) => node.message.role === 'user')
  if (!lastUser) return
  event.preventDefault()
  ui.editing.set(lastUser.message.id)
}, 'features.thread.versions.editFromArrow')

const listenForArrowEdit = action(() => {
  const onKeyDown = wrap((event: KeyboardEvent) => {
    editFromArrow(event)
  })
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}, 'features.thread.versions.listenForArrowEdit')

let arrowListeners = 0
let removeArrowListener: (() => void) | null = null

const retainArrowEdit = () => {
  arrowListeners += 1
  if (!removeArrowListener) removeArrowListener = listenForArrowEdit()
  return () => {
    arrowListeners -= 1
    if (arrowListeners > 0) return
    removeArrowListener?.()
    removeArrowListener = null
  }
}

export const VersionSwitcher = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const isUser = peek(node).message.role === 'user'
  const name = `features.thread.versions#${messageId}`
  const streaming = computed(
    () => chat.streaming() !== null,
    `${name}.streaming`,
  )
  const version = computed(() => {
    const current = node()
    const total = Math.max(current.versions.length, 1)
    const index = Math.min(Math.max(current.versionIndex, 0), total - 1)
    return {
      label: `${index + 1}/${total}`,
      atStart: index <= 0,
      atEnd: index >= total - 1,
      previousId: index > 0 ? (current.versions[index - 1] ?? null) : null,
      nextId: index < total - 1 ? (current.versions[index + 1] ?? null) : null,
    }
  }, `${name}.version`)

  const showVersion = (targetId: string | null) => {
    if (!targetId || chat.id === 'new') return
    chat.selectVersion(targetId)
  }

  const openEditor = () => {
    if (chat.streaming() !== null) return
    ui.editing.set(messageId)
  }

  return (
    <div
      data-slot="VersionSwitcher"
      role="group"
      aria-label="Versions"
      ref={retainArrowEdit}
      css={`
        display: inline-flex;
        align-items: center;
        gap: 0;
        height: 1.75rem;
        margin: 0;
        padding: 0;
        color: var(--text-muted);
        font-size: 0.75rem;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      `}
    >
      <button
        type="button"
        aria-label="Previous version"
        css={stepButton}
        prop:disabled={() => version().atStart}
        on:click={() => showVersion(version().previousId)}
      >
        <Icon name="chevron-left" size="0.875rem" />
      </button>
      <span
        data-version=""
        css={`
          display: inline-flex;
          align-items: center;
          height: 1.75rem;
          padding: 0 0.15rem;
          font-size: 0.75rem;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        `}
      >
        {() => version().label}
      </span>
      <button
        type="button"
        aria-label="Next version"
        css={stepButton}
        prop:disabled={() => version().atEnd}
        on:click={() => showVersion(version().nextId)}
      >
        <Icon name="chevron-right" size="0.875rem" />
      </button>
      {isUser ? (
        <button
          type="button"
          aria-label="Edit"
          css={`
            ${quietButton}
            padding: 0 0.45rem;
          `}
          prop:disabled={() => streaming()}
          on:click={openEditor}
        >
          Edit
        </button>
      ) : null}
    </div>
  )
}
