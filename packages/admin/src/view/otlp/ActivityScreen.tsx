import type { AdminRecord, OtlpAdmin } from '../../otlp'
import { toActivityRow } from '../../otlp'
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
import { OtlpInspector } from './Inspector'

export interface OtlpActivityScreenProps {
  admin: OtlpAdmin
}

export const OtlpActivityScreen = ({ admin }: OtlpActivityScreenProps) => {
  const rows = () => admin.feedRecords()

  const selectRecord = (record: AdminRecord) => {
    admin.selectRecord(record)
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
      <div
        css={`
          min-height: 0;
          height: 100%;
          [data-testid='log-row'][data-highlighted='true'] {
            background: color-mix(
              in oklch,
              ${tokens.accent} 16%,
              ${tokens.canvas}
            );
            box-shadow: inset 3px 0 0 ${tokens.accent};
          }
        `}
      >
      <DataGrid
        ariaLabel="Activity feed"
        columns={[
          {
            id: 'time',
            header: 'Time',
            width: '6rem',
            render: (record) => (
              <span
                data-testid="log-item-timestamp"
                css={`
                  color: ${tokens.text3};
                  font-variant-numeric: tabular-nums;
                `}
              >
                {formatTimestamp(record.start)}
              </span>
            ),
          },
          {
            id: 'atom',
            header: 'Action / Atom',
            width: 'minmax(8rem, 1.2fr)',
            render: (record) => {
              const row = toActivityRow(record)
              const highlighted = admin.highlightedIds().has(record.id)
              return (
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
                    {row.label}
                  </strong>
                  {row.showActionBadge && (
                    <span data-testid="log-item-badge" css={visuallyHidden}>
                      {record.kind === 'span' ? 'span' : 'action'}
                    </span>
                  )}
                  {row.showErrorBadge && (
                    <span
                      data-testid="log-item-badge"
                      css={`
                        color: ${tokens.error};
                      `}
                    >
                      error
                    </span>
                  )}
                  {highlighted && (
                    <span
                      data-testid="otlp-row-highlighted"
                      css={`
                        color: ${tokens.accent};
                      `}
                    >
                      highlighted
                    </span>
                  )}
                </span>
              )
            },
          },
          {
            id: 'value',
            header: 'Value',
            render: (record) => (
              <span
                data-testid="log-item-preview"
                css={`
                  color: ${tokens.text2};
                `}
              >
                {formatPreview(toActivityRow(record).value)}
              </span>
            ),
          },
        ]}
        rows={rows}
        getRowId={(record) => record.id}
        selectedId={() => admin.selectedRecordId()}
        onSelect={selectRecord}
        empty={
          <EmptyState
            title="No records yet"
            description="Ingest otel.records (keepRecords) or load a fixture batch to fill the activity feed."
          />
        }
        rowTestAttr={(record) => ({
          'data-testid': 'log-row',
          'data-record-id': record.id,
          ...(admin.highlightedIds().has(record.id)
            ? { 'data-highlighted': 'true' }
            : {}),
        })}
      />
      </div>
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
      <OtlpInspector admin={admin} />
    </aside>
  )

  return (
    <div
      data-reatom-name="OtlpActivityScreen"
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
          value={admin.workspaceFocus}
          items={[
            { id: 'logs', label: 'Logs' },
            { id: 'details', label: 'Details' },
          ]}
          ariaLabel="Activity panes"
        />
      </div>
      <div
        data-workspace-focus={() => admin.workspaceFocus()}
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
          ratio={admin.activitySplitRatio}
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
