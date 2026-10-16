import type { Admin } from '../../index'
import type { AdminFrame } from '../../types'
import { tokens, type } from '../design-system'
import { formatPreview, formatTimestamp } from '../format'

export interface HistoryPanelProps {
  admin: Admin
  frame: AdminFrame
}

export const HistoryPanel = ({ admin, frame }: HistoryPanelProps) => {
  const history = () =>
    admin.store
      .frames()
      .filter((entry) => entry.atomId === frame.atomId && entry.id !== frame.id)
      .slice(-8)
      .reverse()

  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-8);
      `}
    >
      {() =>
        history().length === 0 ? (
          <div
            css={`
              ${type.body}
              color: ${tokens.text3};
            `}
          >
            No prior frames for this atom in the current session.
          </div>
        ) : (
          history().map((entry) => (
            <button
              type="button"
              css={`
                ${type.data}
                display: grid;
                gap: var(--admin-space-4);
                text-align: left;
                border: 1px solid ${tokens.border1};
                background: ${tokens.surface2};
                color: ${tokens.text1};
                padding: var(--admin-space-8);
                cursor: pointer;
              `}
              on:click={() => {
                admin.store.selectFrame(entry.id)
                admin.causeGraph.selectedRootId.set(entry.id)
              }}
            >
              <span css={`color: ${tokens.text3};`}>
                #{entry.id} · {formatTimestamp(entry.timestamp)}
              </span>
              <span>{formatPreview(entry.state)}</span>
            </button>
          ))
        )
      }
    </div>
  )
}
