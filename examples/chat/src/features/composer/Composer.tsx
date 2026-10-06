import { computed, peek } from '@reatom/core'

import { send, stop } from '../../chat/engine'
import { modelName } from '../../catalog'
import { requestPersistOnce } from '../../platform/storage-api'
import { AutoGrowTextarea, focusRing, Icon, openLayerCount } from '../../ui'
import type { ChatSlotProps } from '../slots'
import { AttachmentTray } from './attachments/AttachmentTray'
import { CompareButton } from './CompareButton'
import { CostChip, CostNotes } from './CostChip'
import { EffortChip } from './EffortChip'
import { ModelChip } from './ModelChip'
import { WebSearchNotice, WebSearchToggle } from './WebSearchToggle'

const isImeEnter = (event: KeyboardEvent) =>
  event.isComposing || event.keyCode === 229

export const Composer = ({ chat }: ChatSlotProps) => {
  const name = `features.composer#${chat.id}`
  const placeholder = computed(() => {
    const modelId = chat.model()
    return modelId ? `Message ${modelName(modelId)}` : 'Message'
  }, `${name}.placeholder`)
  const stopping = computed(
    () => chat.streaming()?.local === true,
    `${name}.stopping`,
  )

  const sendDraft = () => {
    requestPersistOnce()
    if (chat.streaming()?.local || chat.sendBlock()) return
    send(chat.id, {
      text: chat.draft.text(),
      attachments: chat.draft.attachments(),
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || isImeEnter(event)) return
    event.preventDefault()
    sendDraft()
  }

  const onPress = () => {
    if (stopping()) {
      stop(chat.id)
      return
    }
    sendDraft()
  }

  const muted = computed(
    () => !stopping() && chat.sendBlock() !== null,
    `${name}.muted`,
  )

  const focusWelcomeField = (form: HTMLFormElement) => {
    if (chat.id !== 'new' || chat.path().length > 0) return
    if (peek(openLayerCount) > 0 || document.querySelector('dialog[open]')) return
    const field = form.querySelector('textarea')
    if (!(field instanceof HTMLTextAreaElement)) return
    field.focus({ preventScroll: true })
  }

  const editor = (
    <div
      css={`
        display: flex;
        flex-wrap: nowrap;
        align-items: flex-end;
        gap: var(--space-3);
        min-width: 0;
      `}
    >
      <div css="flex: 1; min-width: 0;">
        <AutoGrowTextarea
          value={chat.draft.text}
          label="Message"
          variant="bare"
          data-focus-ring="off"
          prop:placeholder={placeholder}
          on:keydown={onKeyDown}
        />
      </div>
      <button
        type="button"
        data-send=""
        data-mode={() => (stopping() ? 'stop' : 'send')}
        data-muted={() => (muted() ? 'true' : 'false')}
        aria-label={() =>
          stopping() ? 'Stop' : (chat.sendBlock()?.label ?? 'Send')
        }
        prop:disabled={() => muted()}
        on:click={onPress}
        css={`
          display: grid;
          place-items: center;
          width: 2.75rem;
          height: 2.75rem;
          flex: none;
          border: 0;
          border-radius: var(--radius-pill);
          background: var(--accent);
          color: var(--accent-ink);
          cursor: pointer;

          &[data-muted='true'] {
            background: var(--bg-sunken);
            color: var(--text-disabled);
            cursor: default;
          }

          &[data-muted='false']:hover {
            background: var(--accent-hover);
          }

          &:focus-visible {
            outline: var(--focus-width) solid var(--focus);
            outline-offset: 2px;
          }
        `}
      >
        {() => <Icon name={stopping() ? 'stop' : 'send'} size="1.15rem" />}
      </button>
    </div>
  )

  return (
    <form
      data-slot="Composer"
      data-testid="composer"
      ref={focusWelcomeField}
      on:submit={(event) => event.preventDefault()}
      css={`
        flex: none;
        padding: var(--space-4) var(--space-6) var(--space-5);
        padding-bottom: max(var(--space-5), env(safe-area-inset-bottom));
        background: var(--thread);
      `}
    >
      <WebSearchNotice chat={chat} />
      <CostNotes chat={chat} />
      <div
        data-composer-card=""
        css={`
          position: relative;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          max-width: 46rem;
          margin: 0 auto;
          padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
          border: 1px solid var(--line-strong);
          border-radius: var(--radius-lg);
          background: var(--bg-elevated);
          box-shadow: var(--shadow);

          & textarea:focus,
          & textarea:focus-visible {
            outline: none;
          }

          &:has(textarea:focus-visible) {
            ${focusRing}
          }
        `}
      >
        <AttachmentTray
          chat={chat}
          editor={editor}
          tools={(trigger) => (
            <div
              data-composer-tools=""
              css={`
                display: flex;
                flex-direction: row;
                flex-wrap: nowrap;
                align-items: center;
                gap: var(--space-1-5);
                width: 100%;
                min-width: 0;

                @media (max-width: 480px) {
                  min-width: 0;
                  max-width: 100%;
                  overflow-x: auto;
                }

                & button,
                & [data-attachment-trigger],
                & [data-slot='ModelChip'],
                & [data-slot='CompareButton'],
                & [data-slot='WebSearchToggle'],
                & [data-web-search-toggle] {
                  flex: 0 0 auto;
                  align-self: center;
                }

                & [data-slot='CostChip'] {
                  flex: 1 1 auto;
                  min-width: 0;
                  margin-inline-start: auto;
                }
              `}
            >
              {trigger}
              <ModelChip chat={chat} />
              <EffortChip chat={chat} />
              <WebSearchToggle chat={chat} />
              <CompareButton chat={chat} />
              <CostChip chat={chat} />
            </div>
          )}
        />
      </div>
    </form>
  )
}
