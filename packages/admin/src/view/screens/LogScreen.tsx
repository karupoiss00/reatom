import type { Admin } from '../../index'
import type { AdminFrame } from '../../types'
import { InspectorPanel } from '../components/InspectorPanel'
import {
  DataGrid,
  EmptyState,
  SHELL_FOCUS_MAX,
  SplitPane,
  Tabs,
  tokens,
  visuallyHidden,
} from '../design-system'
import { formatPreview, formatTimestamp } from '../format'
import { isActionFrame } from '../frame-inspector'

const FEED_RENDER_LIMIT = 200

export interface LogScreenProps {
  admin: Admin
}

function framePreview(frame: AdminFrame): string {
  if (frame.params !== undefined) return formatPreview(frame.params)
  if (frame.payload !== undefined) return formatPreview(frame.payload)
  return formatPreview(frame.state)
}

export const LogScreen = ({ admin }: LogScreenProps) => {
  const frames = () => {
    const query = admin.filters.search.searchQuery()
    if (query) return admin.filters.search.searchResults()
    return admin.filters.engine.visibleFrames()
  }
  const highlightStyles = () => admin.filters.engine.highlightedFrames()
  const atoms = () => admin.store.getAtoms()
  const selectedFrameId = () => admin.store.selectedFrameId()

  const renderedFrames = () => {
    const allFrames = frames()
    if (allFrames.length <= FEED_RENDER_LIMIT) return allFrames
    return allFrames.slice(-FEED_RENDER_LIMIT)
  }

  const selectFrame = (frame: AdminFrame) => {
    admin.view.followLive.setFalse()
    admin.store.selectFrame(frame.id)
    admin.causeGraph.selectedRootId.set(frame.id)
    admin.view.workspaceFocus.set('details')
  }

  const logs = (
    <section
      data-reatom-name="ActivityWorkspace"
      css={`
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        background: ${tokens.canvas};
      `}
    >
      <h2
        css={`
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
        `}
      >
        Activity feed
      </h2>
      <DataGrid
        ariaLabel="Activity feed"
        columns={[
          {
            id: 'time',
            header: 'Time',
            width: '6rem',
            render: (frame) => (
              <span
                data-testid="log-item-timestamp"
                css={`
                  color: ${tokens.text3};
                  font-variant-numeric: tabular-nums;
                `}
              >
                {formatTimestamp(frame.timestamp)}
              </span>
            ),
          },
          {
            id: 'atom',
            header: 'Action / Atom',
            width: 'minmax(8rem, 1.2fr)',
            render: (frame) => (
              <span
                css={`
                  display: inline-flex;
                  gap: var(--admin-space-6);
                  min-width: 0;
                `}
              >
                <strong
                  data-testid="log-item-name"
                  css={`
                    font-weight: 500;
                  `}
                >
                  {atoms().get(frame.atomId)?.name ?? frame.atomId}
                </strong>
                {isActionFrame(frame) && (
                  <span data-testid="log-item-badge" css={visuallyHidden}>
                    action
                  </span>
                )}
                {frame.error !== null && (
                  <span
                    data-testid="log-item-badge"
                    css={`
                      color: ${tokens.error};
                    `}
                  >
                    error
                  </span>
                )}
              </span>
            ),
          },
          {
            id: 'value',
            header: 'Value',
            render: (frame) => (
              <span
                data-testid="log-item-preview"
                css={`
                  color: ${highlightStyles().get(frame.id)?.textColor ?? tokens.text2};
                `}
              >
                {framePreview(frame)}
              </span>
            ),
          },
        ]}
        rows={renderedFrames}
        getRowId={(frame) => String(frame.id)}
        selectedId={() =>
          selectedFrameId() === null ? null : String(selectedFrameId())
        }
        onSelect={selectFrame}
        empty={
          <EmptyState
            title="No frames match the current filters"
            description="Clear the search query, disable saved rules, or interact with your app to capture new state transitions."
          />
        }
        rowTestAttr={(frame) => ({
          'data-testid': 'log-row',
          'data-frame-id': String(frame.id),
        })}
      />
    </section>
  )

  const details = (
    <aside
      css={`
        height: 100%;
        min-height: 0;
        overflow: hidden;
      `}
    >
      <InspectorPanel admin={admin} />
    </aside>
  )

  return (
    <div
      data-reatom-name="LogScreen"
      css={`
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        overflow: hidden;
      `}
    >
      <div
        css={`
          grid-row: 1;
          display: none;
          @container admin-shell (max-width: ${SHELL_FOCUS_MAX}px) {
            display: block;
          }
        `}
      >
        <Tabs
          value={admin.view.workspaceFocus}
          items={[
            { id: 'logs', label: 'Logs' },
            { id: 'details', label: 'Details' },
          ]}
          ariaLabel="Activity panes"
        />
      </div>
      <div
        data-workspace-focus={() => admin.view.workspaceFocus()}
        css={`
          grid-row: 2;
          min-height: 0;
          height: 100%;
          @container admin-shell (max-width: ${SHELL_FOCUS_MAX}px) {
            [data-reatom-name='SplitPane'] {
              display: block;
            }
            [data-reatom-name='SplitPane'] > button {
              display: none;
            }
            &[data-workspace-focus='logs'] [data-pane='right'] {
              display: none;
            }
            &[data-workspace-focus='details'] [data-pane='left'] {
              display: none;
            }
            [data-pane] {
              height: 100%;
            }
          }
        `}
      >
        <SplitPane
          ratio={admin.view.activitySplitRatio}
          left={logs}
          right={details}
          minLeft={250}
          minRight={280}
          defaultRatio={0.42}
        />
      </div>
    </div>
  )
}
