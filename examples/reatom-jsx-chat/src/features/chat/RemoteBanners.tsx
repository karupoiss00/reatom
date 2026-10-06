import { computed } from '@reatom/core'

import { deletedElsewhere, saveConflict, undoDelete } from '../../chat/library'
import { Banner, Button, Icon } from '../../ui'
import type { ChatSlotProps } from '../slots'

const generatingLabel = 'This chat is still generating in another tab.'

export const RemoteBanners = ({ chat }: ChatSlotProps) => {
  const name = `features.chat.remote#${chat.id}`
  const generatingElsewhere = computed(
    () => chat.sendBlock()?.label === generatingLabel,
    `${name}.generatingElsewhere`,
  )
  const deletedHere = computed(
    () => deletedElsewhere()?.chatId === chat.id,
    `${name}.deletedHere`,
  )
  const conflictReason = computed(() => {
    const notice = saveConflict()
    return notice?.chatId === chat.id ? notice.reason : null
  }, `${name}.conflict`)

  return (
    <>
      {() => {
        const generating = generatingElsewhere()
        const deleted = deletedHere()
        const reason = conflictReason()
        if (!generating && !deleted && !reason) {
          return <div data-slot="RemoteBanners" css="display: contents;" />
        }
        if (generating && !deleted && !reason) {
          return (
            <div
              data-slot="RemoteBanners"
              css={`
                display: grid;
                min-width: 0;
                padding: 0.25rem var(--space-6) 0;
              `}
            >
              <p
                role="status"
                css={`
                  display: flex;
                  align-items: center;
                  gap: var(--space-2);
                  margin: 0;
                  min-width: 0;
                  padding: 0.125rem 0.7rem;
                  border: 1px solid var(--warning-line);
                  border-radius: var(--radius-md);
                  background: var(--warning-soft);
                  color: var(--text);
                  font-size: var(--text-sm);
                  line-height: 1.25;
                `}
              >
                <span css="display: grid; color: var(--warning);">
                  <Icon name="info" size="1rem" />
                </span>
                <span>
                  <strong
                    css={`
                      color: var(--warning);
                      font-weight: var(--weight-semibold);
                    `}
                  >
                    {generatingLabel}
                  </strong>{' '}
                  Stop it in the tab that is generating.
                </span>
              </p>
            </div>
          )
        }
        return (
          <div
            data-slot="RemoteBanners"
            css={`
              display: grid;
              gap: var(--space-2);
              min-width: 0;
              padding: var(--space-3) var(--space-6) 0;
            `}
          >
            {generating ? (
              <Banner tone="warning" icon="info" title={generatingLabel}>
                Stop it in the tab that is generating.
              </Banner>
            ) : null}
            {deleted ? (
              <Banner
                tone="warning"
                icon="trash"
                title="This chat was deleted in another tab."
                actions={
                  <Button size="sm" variant="secondary" on:click={() => undoDelete()}>
                    Undo
                  </Button>
                }
              />
            ) : null}
            {reason ? (
              <span
                data-slot="ConflictBadge"
                role="status"
                css={`
                  justify-self: start;
                  max-width: 100%;
                  padding: 0.2rem 0.7rem;
                  border: 1px solid var(--warning-line);
                  border-radius: var(--radius-pill);
                  background: var(--warning-soft);
                  color: var(--warning);
                  font-size: var(--text-xs);
                  font-weight: var(--weight-medium);
                  line-height: var(--leading-snug);
                  white-space: normal;
                  overflow-wrap: anywhere;
                `}
              >
                Couldn't save this change: {reason}
              </span>
            ) : null}
          </div>
        )
      }}
    </>
  )
}
