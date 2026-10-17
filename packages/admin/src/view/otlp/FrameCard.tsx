import { atom, computed, type AtomLike } from '@reatom/core'

import type { OtlpAdmin } from '../../otlp'
import {
  copyForAgentMarkdown,
  firstExceptionMessageLine,
  frameCalculatorExpression,
  frameMcpSnippet,
  isStateWrite,
  recordErrorMessage,
  recordErrorStack,
  recordErrorType,
  recordHasError,
  recordLabel,
  recordReatomName,
  resolveCauseChips,
  stackCulprit,
  toRailNode,
} from '../../otlp'
import type { AdminRecord } from '../../otlp'
import {
  Button,
  Disclosure,
  InspectorTabs,
  Popover,
  RailGraph,
  kindPill,
  kindStripe,
  kindTokens,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { Inspector, ParamList } from '../inspector'
import { KindMark, KindSwatch } from './KindMark'
import type { RecordKindName } from './recordKind'
import { kindColorVar, recordKindIcon } from './recordKind'
import {
  frameValueView,
  overviewDataValue,
  overviewEventAttributes,
  overviewParamsValue,
  recordFieldValue,
  type FrameValueTitle,
} from './frameValues'

function durationLabel(record: AdminRecord): string {
  if (record.end === undefined) return 'open'
  const ms = Math.max(0, record.end - record.start)
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
}

function kindLabel(record: AdminRecord): string {
  if (record.outcome === 'abort') return 'abort'
  if (record.kind === 'log' && record.reatomKind === undefined) return 'LOG'
  return record.reatomKind ?? record.kind
}

function causeSwatchKind(kind: string): RecordKindName {
  if (
    kind === 'action' ||
    kind === 'atom' ||
    kind === 'computed' ||
    kind === 'effect' ||
    kind === 'log' ||
    kind === 'route'
  ) {
    return kind
  }
  return 'framework'
}

function visibleCardRows(admin: OtlpAdmin): readonly AdminRecord[] {
  const feed = admin.feedRecords()
  if (admin.filterMode() !== 'highlight') return feed
  const highlighted = admin.highlightedIds()
  if (highlighted.size === 0) return feed
  return feed.filter((entry) => highlighted.has(entry.id))
}

function writeClipboard(text: string) {
  void navigator.clipboard.writeText(text)
}

function focusSelector(selector: string) {
  const hosts = document.querySelectorAll('[data-admin-host]')
  for (const host of hosts) {
    const row = host.shadowRoot?.querySelector(selector)
    if (row instanceof HTMLElement) {
      row.focus()
      return
    }
  }
  const row = document.querySelector(selector)
  if (row instanceof HTMLElement) row.focus()
}

export function closeFrameCard(admin: OtlpAdmin) {
  const paths = admin.view() === 'timeline' && admin.timelineUnit() === 'paths'
  const pathId = paths ? (admin.analytics.paths.selected()?.id ?? null) : null
  const recordId = admin.selectedRecordId()
  admin.cardOpen.setFalse()
  queueMicrotask(() => {
    if (paths) {
      if (pathId !== null) {
        focusSelector(`[data-path-id="${CSS.escape(pathId)}"]`)
      }
      return
    }
    if (recordId !== null) {
      focusSelector(`[data-record-id="${CSS.escape(recordId)}"]`)
    }
  })
}

let frameSerial = 0

function frameSources(admin: OtlpAdmin) {
  frameSerial += 1
  const name = `_Admin.frameCard.${frameSerial}`
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
  return { data, params }
}

export const OtlpFrameCard = ({ admin }: { admin: OtlpAdmin }) => {
  const sources = frameSources(admin)
  return (
    <section
      data-reatom-name="FrameCard"
      css={`
        ${scrollable}
        box-sizing: border-box;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        align-content: start;
        gap: var(--admin-space-12);
        height: 100%;
        min-height: 0;
        padding: var(--admin-space-12);
        background: ${tokens.surface1};
        color: ${tokens.text1};
      `}
    >
      {() => {
        const record = admin.selectedRecord()
        if (!record) return null
        const kind = recordKindIcon(record, admin.mountLogIds())
        return (
          <div
            css={`
              display: grid;
              grid-template-columns: minmax(0, 1fr);
              gap: var(--admin-space-12);
              min-width: 0;
            `}
          >
            <header
              data-row-kind={kind}
              css={`
                display: grid;
                gap: var(--admin-space-4);
                min-width: 0;
                padding-left: var(--admin-space-8);
                --row-kind: ${kindColorVar(kind)};
                [data-admin-colors='false'] & {
                  --row-kind: ${tokens.text3};
                }
                box-shadow: ${kindStripe('var(--row-kind)')};
              `}
            >
              <h2
                css={`
                  ${type.title}
                  display: flex;
                  align-items: center;
                  gap: var(--admin-space-6);
                  margin: 0;
                  min-width: 0;
                `}
              >
                <KindMark kind={kind} />
                <span
                  css={`
                    min-width: 0;
                    overflow-wrap: anywhere;
                  `}
                >
                  {recordLabel(record)}
                </span>
              </h2>
              <p
                css={`
                  ${type.meta}
                  display: flex;
                  flex-wrap: wrap;
                  align-items: center;
                  gap: var(--admin-space-6);
                  margin: 0;
                  color: ${tokens.text2};
                `}
              >
                <span css={kindPill('var(--row-kind)')}>{kindLabel(record)}</span>
                <span
                  css={kindPill(
                    record.outcome === 'error' || recordHasError(record)
                      ? tokens.error
                      : record.outcome === 'abort'
                        ? tokens.warning
                        : record.outcome === 'suspense'
                          ? tokens.info
                          : kindTokens.other,
                  )}
                >
                  {record.outcome ?? 'ok'}
                </span>
                <span
                  css={`
                    font-variant-numeric: tabular-nums;
                  `}
                >
                  {durationLabel(record)}
                </span>
                {() => {
                  const rows = visibleCardRows(admin)
                  const index = rows.findIndex((entry) => entry.id === record.id)
                  if (index < 0) return null
                  return (
                    <span
                      css={`
                        display: inline-flex;
                        align-items: center;
                        gap: var(--admin-space-4);
                        font-variant-numeric: tabular-nums;
                      `}
                    >
                      {`${index + 1} of ${rows.length}`}
                      <Button
                        variant="ghost"
                        label="Previous record"
                        onClick={() => admin.ganttSelection.move(-1)}
                      >
                        Up
                      </Button>
                      <Button
                        variant="ghost"
                        label="Next record"
                        onClick={() => admin.ganttSelection.move(1)}
                      >
                        Down
                      </Button>
                    </span>
                  )
                }}
                <CopyMenu admin={admin} record={record} />
              </p>
            </header>
            <InspectorTabs
              value={admin.inspectorTab}
              causeCount={() =>
                resolveCauseChips(record, admin.records()).length
              }
              historyCount={() => admin.historyForSelected().length}
            />
            {() => {
              const tab = admin.inspectorTab()
              if (tab === 'causes')
                return <Causes admin={admin} record={record} />
              if (tab === 'history')
                return <History admin={admin} record={record} />
              if (tab === 'json')
                return (
                  <Inspector value={admin.selectedRecord} defaultExpanded />
                )
              return (
                <Overview admin={admin} record={record} sources={sources} />
              )
            }}
          </div>
        )
      }}
    </section>
  )
}

function emptyFieldLabel(title: FrameValueTitle): string {
  if (title === 'Payload') return 'No payload'
  if (title === 'Params') return 'No params'
  if (title === 'New state') return 'No new state'
  return 'No earlier value'
}

const expandedValueHooks = {
  initiallyExpanded: () => true,
}

const FrameField = ({
  value,
  emptyLabel,
}: {
  value: AtomLike<unknown>
  emptyLabel: string
}) => (
  <>
    {emptyLabel ? (
      <p css={quiet} prop:hidden={() => frameValueView(value()) !== 'empty'}>
        {emptyLabel}
      </p>
    ) : null}
    <div prop:hidden={() => frameValueView(value()) === 'empty'}>
      <Inspector value={value} defaultExpanded hooks={expandedValueHooks} />
    </div>
  </>
)

let snapshotSerial = 0

const SnapshotInspector = ({ value }: { value: unknown }) => {
  snapshotSerial += 1
  const source = atom(value, `_Admin.frameCard.snapshot.${snapshotSerial}`)
  return <Inspector value={source} defaultExpanded />
}

const SnapshotField = ({
  value,
  emptyLabel,
}: {
  value: unknown
  emptyLabel: string
}) => {
  const view = frameValueView(value)
  if (view === 'empty') return <p css={quiet}>{emptyLabel}</p>
  return <SnapshotInspector value={value} />
}

function sameNameCount(admin: OtlpAdmin, record: AdminRecord): number {
  const name = recordReatomName(record)
  let count = 0
  for (const entry of admin.feedRecords()) {
    if (recordReatomName(entry) === name) count += 1
  }
  return count
}

const ErrorHero = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const errorType = recordErrorType(record)
  const message =
    firstExceptionMessageLine(recordErrorMessage(record)) ||
    record.outcome ||
    'error'
  const stack = recordErrorStack(record)
  const culprit = stackCulprit(stack)
  const repeats = sameNameCount(admin, record)
  return (
    <div
      role="alert"
      css={`
        display: grid;
        gap: var(--admin-space-8);
        min-width: 0;
        padding: var(--admin-space-8);
        padding-left: var(--admin-space-12);
        background: ${tokens.errorWash};
        box-shadow: ${kindStripe(tokens.error)};
      `}
    >
      <p
        css={`
          ${type.ui}
          margin: 0;
          color: ${tokens.error};
          letter-spacing: 0.04em;
          text-transform: uppercase;
        `}
      >
        {errorType === '' ? 'Error' : errorType}
      </p>
      <p
        css={`
          ${type.body}
          margin: 0;
          font-family: ${tokens.fontData};
          font-size: 13px;
          line-height: 20px;
          color: ${tokens.text1};
        `}
      >
        {message}
      </p>
      {culprit ? (
        <p
          css={`
            ${type.meta}
            margin: 0;
            color: ${tokens.text2};
          `}
        >
          Culprit {culprit}
        </p>
      ) : null}
      {repeats > 1 ? (
        <p
          css={`
            ${type.meta}
            margin: 0;
            color: ${tokens.text3};
            font-variant-numeric: tabular-nums;
          `}
        >
          {`×${repeats} in session`}
        </p>
      ) : null}
      {stack ? (
        <Disclosure label="Stack">
          <pre
            css={`
              ${type.data}
              margin: 0;
              white-space: pre-wrap;
              color: ${tokens.text2};
            `}
          >
            {stack}
          </pre>
        </Disclosure>
      ) : null}
      <Button
        variant="ghost"
        label="Show cause chain"
        onClick={() => admin.inspectorTab.set('causes')}
      >
        Show cause chain
      </Button>
    </div>
  )
}

const CopyMenu = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => (
  <Popover triggerLabel="Copy" label="Copy frame">
    <div
      css={`
        display: grid;
        gap: var(--admin-space-4);
      `}
    >
      <Button
        variant="ghost"
        label="Copy record id"
        onClick={() => writeClipboard(record.id)}
      >
        Record id
      </Button>
      <Button
        variant="ghost"
        label="Copy calculator expression"
        onClick={() => writeClipboard(frameCalculatorExpression(record))}
      >
        Calculator
      </Button>
      <Button
        variant="ghost"
        label="Copy MCP snippet"
        onClick={() => writeClipboard(frameMcpSnippet(record))}
      >
        MCP snippet
      </Button>
      <Button
        variant="ghost"
        label="Copy for agent"
        onClick={() =>
          writeClipboard(
            copyForAgentMarkdown(record, admin.records(), false),
          )
        }
      >
        Copy for agent
      </Button>
      <Button
        variant="ghost"
        label="Include live values"
        onClick={() =>
          writeClipboard(copyForAgentMarkdown(record, admin.records(), true))
        }
      >
        <span css={`color: ${tokens.warning};`}>Include live values</span>
      </Button>
    </div>
  </Popover>
)

const CauseChips = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const chips = resolveCauseChips(record, admin.records())
  if (chips.length === 0) return null
  return (
    <div
      css={`
        display: flex;
        flex-wrap: wrap;
        gap: var(--admin-space-6);
        min-width: 0;
      `}
    >
      {chips.map((chip) =>
        chip.record === undefined ? (
          <span
            css={`
              ${type.meta}
              color: ${tokens.text3};
              font-family: ${tokens.fontData};
            `}
          >
            {chip.id}
          </span>
        ) : (
          <Button
            variant="ghost"
            label={`Select cause ${chip.name}`}
            onClick={() => {
              if (chip.record?.frameId !== undefined) {
                admin.selectFrame(chip.record.frameId)
                admin.cardOpen.setTrue()
              }
            }}
          >
            <KindSwatch kind={causeSwatchKind(chip.kind)} />
            {chip.name}
          </Button>
        ),
      )}
    </div>
  )
}

const PositionMark = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const trace = admin.byTrace(record.traceId)
  if (trace.length === 0) return null
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = Number.NEGATIVE_INFINITY
  for (const entry of trace) {
    minStart = Math.min(minStart, entry.start)
    maxEnd = Math.max(maxEnd, entry.end ?? entry.start)
  }
  const total = Math.max(1, maxEnd - minStart)
  const offset = record.start - minStart
  const duration = Math.max(0, (record.end ?? record.start) - record.start)
  const left = Math.max(0, Math.min(1, offset / total))
  const width = Math.max(0, Math.min(1 - left, duration / total))
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-4);
        min-width: 0;
      `}
    >
      <div
        css={`
          position: relative;
          height: 4px;
          border-radius: var(--admin-radius-2);
          background: ${tokens.surface3};
        `}
      >
        {record.kind === 'log' ? (
          <span
            css={`
              position: absolute;
              top: 0;
              bottom: 0;
              left: ${left * 100}%;
              width: 2px;
              background: ${tokens.accent};
            `}
          />
        ) : (
          <span
            css={`
              position: absolute;
              top: 0;
              bottom: 0;
              left: ${left * 100}%;
              width: ${Math.max(width * 100, 1)}%;
              background: ${tokens.accent};
              border-radius: var(--admin-radius-2);
            `}
          />
        )}
      </div>
      <p
        css={`
          ${type.meta}
          margin: 0;
          color: ${tokens.text3};
          font-variant-numeric: tabular-nums;
        `}
      >
        {`+${durationLabel({ ...record, start: minStart, end: record.start })} · ${durationLabel(record)} / ${durationLabel({ ...record, start: minStart, end: maxEnd })}`}
      </p>
    </div>
  )
}

const Overview = ({
  admin,
  record,
  sources,
}: {
  admin: OtlpAdmin
  record: AdminRecord
  sources: ReturnType<typeof frameSources>
}) => {
  const eventAttributes = overviewEventAttributes(record)
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-12);
        min-width: 0;
      `}
    >
      {recordHasError(record) ? (
        <ErrorHero admin={admin} record={record} />
      ) : null}
      <CauseChips admin={admin} record={record} />
      <PositionMark admin={admin} record={record} />
      {eventAttributes !== undefined ? (
        <SnapshotField value={eventAttributes} emptyLabel="" />
      ) : null}
      <FrameField value={sources.data} emptyLabel="" />
      <ParamList value={sources.params} />
    </div>
  )
}

const Causes = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const nodes = causeNodes(admin, record)
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-8);
        min-width: 0;
      `}
    >
      {nodes.length === 0 ? (
        <p css={quiet}>No causes</p>
      ) : (
        <RailGraph
          nodes={nodes}
          selectedId={Number(record.frameId)}
          onSelect={(nodeId) => admin.selectFrame(nodeId)}
          onReroot={(nodeId) => admin.selectFrame(nodeId)}
        />
      )}
      <Button label="Open in Graph" onClick={() => admin.view.set('graph')}>
        Open in Graph
      </Button>
    </div>
  )
}

const History = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const history = admin.historyForSelected()
  if (history.length === 0) return <p css={quiet}>No earlier value</p>
  const currentTitle = isStateWrite(record) ? 'New state' : 'Payload'
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-8);
      `}
    >
      <section
        css={`
          display: grid;
          gap: var(--admin-space-4);
        `}
      >
        <h3 css={sectionTitle}>{currentTitle}</h3>
        <SnapshotField
          value={recordFieldValue(record)}
          emptyLabel={emptyFieldLabel(currentTitle)}
        />
      </section>
      {history.map((entry) => (
        <section
          css={`
            display: grid;
            gap: var(--admin-space-4);
          `}
        >
          <h3 css={sectionTitle}>Previous state</h3>
          <SnapshotField
            value={recordFieldValue(entry)}
            emptyLabel="No earlier value"
          />
        </section>
      ))}
    </div>
  )
}

function causeNodes(admin: OtlpAdmin, record: AdminRecord) {
  const ids = new Set(record.causeIds)
  const related = admin.records().filter((entry) => {
    if (entry.id === record.id) return true
    return entry.frameId !== undefined && ids.has(entry.frameId)
  })
  return related.flatMap((entry) => {
    const node = toRailNode(entry)
    return node ? [node] : []
  })
}

const sectionTitle = `
  ${type.ui}
  margin: 0;
`

const quiet = `
  ${type.meta}
  margin: 0;
  color: ${tokens.text2};
`
