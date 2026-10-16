import type { Admin } from '../../index'
import type { FrameGroup } from '../../timeline'
import { formatPreview, formatTimestamp } from '../format'
import { buttonGhost, colors, flex, gap, mono, scrollable } from '../styles'

export interface TimelineEventListProps {
  admin: Admin
  selectedTimestamp: number | null
  onSelectTimestamp: (timestamp: number) => void
}

function leadingActionName(admin: Admin, group: FrameGroup): string | null {
  const actionFrame = group.frames.find((frame) => frame.params !== undefined)
  if (!actionFrame) return null
  return (
    admin.store.getAtoms().get(actionFrame.atomId)?.name ?? actionFrame.atomId
  )
}

export const TimelineEventList = ({
  admin,
  selectedTimestamp,
  onSelectTimestamp,
}: TimelineEventListProps) => {
  const groups = () => admin.timeline.frameGroups()

  return (
    <div
      data-reatom-name="TimelineEventList"
      css={`
        ${scrollable}
        display: grid;
        gap: 0.65rem;
        max-height: min(22rem, 48vh);
        overscroll-behavior: contain;
      `}
    >
      {() => {
        const currentGroups = groups()
        if (currentGroups.length === 0) {
          return (
            <div
              css={`
                color: ${colors.textSubtle};
                font-size: 0.8rem;
              `}
            >
              Event bursts will appear here after your app emits frames.
            </div>
          )
        }

        return currentGroups.map((group, groupIndex) => {
          const isSelected = selectedTimestamp === group.timestamp
          const errorCount = group.frames.filter(
            (frame) => frame.error !== null,
          ).length
          const actionName = leadingActionName(admin, group)

          return (
            <button
              type="button"
              css={`
                ${buttonGhost}
                min-width: 0;
                display: grid;
                gap: 0.35rem;
                text-align: left;
                border-color: ${
                  isSelected ? colors.accent : colors.borderStrong
                };
                background: ${
                  isSelected ? colors.highlight : colors.bgElevated
                };
              `}
              on:click={() => onSelectTimestamp(group.timestamp)}
            >
              <div
                css={`
                  ${flex}
                  ${gap(1)}
                  align-items: baseline;
                `}
              >
                <strong css="flex-shrink: 0;">Burst {groupIndex + 1}</strong>
                {actionName && (
                  <span
                    css={`
                      min-width: 0;
                      overflow: hidden;
                      text-overflow: ellipsis;
                      white-space: nowrap;
                      color: ${colors.textSubtle};
                      font-size: 0.7rem;
                    `}
                  >
                    {actionName}
                  </span>
                )}
                <span
                  css={`
                    margin-inline-start: auto;
                    flex-shrink: 0;
                    color: ${colors.textSubtle};
                    font-size: 0.7rem;
                  `}
                >
                  {group.frames.length} frame
                  {group.frames.length === 1 ? '' : 's'}
                  {errorCount > 0 && (
                    <>
                      {' · '}
                      <span
                        css={`
                          color: ${colors.error};
                        `}
                      >
                        {errorCount} error{errorCount === 1 ? '' : 's'}
                      </span>
                    </>
                  )}
                  {' · '}
                  {formatTimestamp(group.timestamp)}
                </span>
              </div>
              <div
                css={`
                  display: grid;
                  min-width: 0;
                  & > div + div {
                    border-top: 1px solid ${colors.border};
                  }
                `}
              >
                {group.frames.slice(0, 4).map((frame) => {
                  const atomName =
                    admin.store.getAtoms().get(frame.atomId)?.name ??
                    frame.atomId

                  return (
                    <div
                      css={`
                        ${mono}
                        min-width: 0;
                        padding-block: 0.35rem;
                        color: ${colors.textMuted};
                        font-size: 0.72rem;
                        white-space: pre-wrap;
                        overflow-wrap: anywhere;
                        &:hover {
                          background: ${colors.surface};
                        }
                      `}
                    >
                      <strong
                        css={`
                          color: ${colors.text};
                        `}
                      >
                        {atomName}
                      </strong>
                      {' · '}
                      {formatPreview(
                        frame.params !== undefined ? frame.params : frame.state,
                        64,
                      )}
                    </div>
                  )
                })}
                {group.frames.length > 4 && (
                  <div
                    css={`
                      padding-block: 0.35rem;
                      color: ${colors.textSubtle};
                      font-size: 0.72rem;
                    `}
                  >
                    +{group.frames.length - 4} more in this burst
                  </div>
                )}
              </div>
            </button>
          )
        })
      }}
    </div>
  )
}
