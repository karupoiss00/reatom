import { computed, type AtomLike } from '@reatom/core'

import { isEventLog, type AdminRecord, type OtlpAdmin } from '../../otlp'
import {
  EmptyState,
  InspectorTabs,
  RailGraph,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { formatPreview, formatTimestamp } from '../format'
import { Inspector, ParamList } from '../inspector'
import { EventOverview } from './EventOverview'
import {
  frameValueView,
  overviewDataValue,
  overviewParamsValue,
} from './frameValues'

export interface OtlpInspectorProps {
  admin: OtlpAdmin
}

let otlpInspectorSerial = 0

export const OtlpInspector = ({ admin }: OtlpInspectorProps) => {
  otlpInspectorSerial += 1
  const name = `_Admin.otlpInspector.${otlpInspectorSerial}`
  const data = computed(() => {
    const record = admin.selectedRecord()
    if (!record) return undefined
    return overviewDataValue(record)
  }, `${name}.data`)
  const params = computed(() => {
    const record = admin.selectedRecord()
    if (!record) return undefined
    return overviewParamsValue(record)
  }, `${name}.params`)

  return (
    <div
      data-reatom-name="OtlpInspector"
      css={`
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: ${tokens.surface1};
      `}
    >
      {() => {
        const record = admin.selectedRecord()
        if (!record) {
          return (
            <EmptyState
              title="Inspect any record"
              description="Select a record to inspect payload, cause chain, and last-write history."
            />
          )
        }

        const label = record.atomName ?? record.name
        const tab = admin.inspectorTab()
        const railNodes = admin.allRailNodes()
        const history = admin.historyForSelected()
        const selectedRailId =
          record.frameId === undefined ? undefined : Number(record.frameId)

        return (
          <div
            css={`
              display: grid;
              grid-template-rows: auto auto minmax(0, 1fr);
              height: 100%;
              min-height: 0;
            `}
          >
            <div
              css={`
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: var(--admin-space-8);
                min-height: 36px;
                padding-inline: var(--admin-space-8);
                border-bottom: 1px solid ${tokens.border1};
              `}
            >
              <h2
                css={`
                  ${type.ui}
                  min-width: 0;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                  margin: 0;
                `}
              >
                {label}
              </h2>
              <span
                css={`
                  ${type.meta}
                  color: ${tokens.text3};
                `}
              >
                {formatTimestamp(record.start)}
              </span>
            </div>
            <InspectorTabs value={admin.inspectorTab} />
            <div
              css={`
                ${scrollable}
                min-height: 0;
                padding: var(--admin-space-8);
              `}
            >
              {tab === 'overview' ? (
                <RecordOverview record={record} data={data} params={params} />
              ) : null}
              {tab === 'causes' ? (
                record.frameId === undefined ||
                selectedRailId === undefined ||
                railNodes.length === 0 ? (
                  <EmptyState
                    title="No cause chain"
                    description="This record has no frame id, so it is Activity/Timeline only until the tracer stamps reatom.frame.id."
                  />
                ) : (
                  <RailGraph
                    nodes={railNodes}
                    selectedId={selectedRailId}
                    onSelect={(frameId) => admin.selectFrame(frameId)}
                    onReroot={(frameId) => admin.selectFrame(frameId)}
                  />
                )
              ) : null}
              {tab === 'history' ? (
                history.length === 0 ? (
                  <div
                    css={`
                      ${type.body}
                      color: ${tokens.text3};
                    `}
                  >
                    No prior records for this atom in the current session.
                  </div>
                ) : (
                  history.map((entry) => (
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
                        margin-bottom: var(--admin-space-8);
                      `}
                      on:click={() => admin.selectRecord(entry)}
                    >
                      <span>{formatTimestamp(entry.start)}</span>
                      <span
                        css={`
                          color: ${tokens.text2};
                        `}
                      >
                        {formatPreview(entry.body ?? entry.eventName)}
                      </span>
                    </button>
                  ))
                )
              ) : null}
              {tab === 'json' ? (
                <Inspector value={admin.selectedRecord} defaultExpanded />
              ) : null}
            </div>
          </div>
        )
      }}
    </div>
  )
}

const expandedValueHooks = {
  initiallyExpanded: () => true,
}

const ValueField = ({ value }: { value: AtomLike<unknown> }) => (
  <div prop:hidden={() => frameValueView(value()) === 'empty'}>
    <Inspector value={value} defaultExpanded hooks={expandedValueHooks} />
  </div>
)

const RecordOverview = ({
  record,
  data,
  params,
}: {
  record: AdminRecord
  data: AtomLike<unknown>
  params: AtomLike<unknown>
}) =>
  isEventLog(record) ? (
    <EventOverview record={record} />
  ) : (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-8);
        min-width: 0;
      `}
    >
      {record.error ? (
        <p
          role="alert"
          css={`
            margin: 0;
            color: ${tokens.error};
            ${type.body}
          `}
        >
          {record.error.type ?? 'Error'}
          {record.error.message ? `: ${record.error.message}` : ''}
        </p>
      ) : null}
      <ValueField value={data} />
      <ParamList value={params} />
    </div>
  )
