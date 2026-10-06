import { computed, peek } from '@reatom/core'

import { ui } from '../../app/ui'
import type { NodeSlotProps } from '../slots'
import { AttachmentList } from './AttachmentList'
import { MessageActions } from './MessageActions'
import { UserMessageEditor } from './UserMessageEditor'
import { VersionSwitcher } from './VersionSwitcher'

export const UserMessage = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const isEditing = computed(
    () => ui.editing() === messageId,
    `features.thread.user#${messageId}.isEditing`,
  )
  const content = () => node().message.content
  const attachments = computed(() => {
    const message = node().message
    return message.role === 'user' ? message.attachments : []
  }, `features.thread.user#${messageId}.attachments`)

  return (
    <article
      data-slot="UserMessage"
      css={`
        display: grid;
        justify-items: end;
        gap: var(--space-2);
      `}
    >
      <div
        dir="auto"
        data-slot="UserMessageBubble"
        data-editing={() => (isEditing() ? 'true' : null)}
        css={`
          display: grid;
          max-width: min(36rem, 85%);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-lg);
          background: var(--accent-soft);

          & > * {
            grid-area: 1 / 1;
            min-width: 0;
          }

          &[data-editing='true'] {
            box-shadow: inset 0 0 0 1px var(--line-strong);
          }

          &[data-editing='true'] [data-slot='UserMessageRead'] {
            visibility: hidden;
          }
        `}
      >
        <div
          data-slot="UserMessageRead"
          css={`
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          `}
        >
          {content}
        </div>
        {() => (isEditing() ? <UserMessageEditor chat={chat} node={node} /> : null)}
      </div>
      {() =>
        isEditing() ? null : (
          <>
            <AttachmentList attachments={attachments()} />
            <div
              data-slot="UserActions"
              css={`
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: flex-end;
                gap: 0.125rem 0.25rem;
                min-width: 0;
                margin: 0;
                padding: 0;
              `}
            >
              <VersionSwitcher chat={chat} node={node} />
              <MessageActions chat={chat} node={node} />
            </div>
          </>
        )
      }
    </article>
  )
}