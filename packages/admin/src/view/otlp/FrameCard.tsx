import type { OtlpAdmin } from '../../otlp'
import {
  copyForAgentMarkdown,
  writeClipboard,
  firstExceptionMessageLine,
  formatRecordDuration,
  frameCalculatorExpression,
  frameMcpSnippet,
  recordErrorMessage,
  recordErrorStack,
  recordErrorType,
  recordHasError,
  recordReatomName,
  resolveCauseChips,
  stackCulprit,
} from '../../otlp'
import type { AdminRecord } from '../../otlp'
import {
  Button,
  Disclosure,
  InspectorTabs,
  Popover,
  kindPill,
  kindStripe,
  kindTokens,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { Inspector } from '../inspector'
import { KindMark } from './KindMark'
import { kindColorVar, recordKindIcon } from './recordKind'
import { FrameCauses } from './FrameCauses'
import { FrameHistory } from './FrameHistory'
import { FrameOverview, NameBreadcrumb } from './FrameOverview'

function durationLabel(record: AdminRecord): string {
  return formatRecordDuration(record)
}

function kindLabel(record: AdminRecord): string {
  if (record.outcome === 'abort') return 'abort'
  if (record.kind === 'log' && record.reatomKind === undefined) return 'LOG'
  return record.reatomKind ?? record.kind
}

function visibleCardRows(admin: OtlpAdmin): readonly AdminRecord[] {
  const rows = admin.visibleRecords()
  if (admin.filterMode() !== 'highlight') return rows
  const highlighted = admin.highlightedIds()
  if (highlighted.size === 0) return rows
  return rows.filter((entry) => highlighted.has(entry.id))
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

export const OtlpFrameCard = ({ admin }: { admin: OtlpAdmin }) => {
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
                <NameBreadcrumb admin={admin} record={record} />
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
                return <FrameCauses admin={admin} record={record} />
              if (tab === 'history')
                return <FrameHistory admin={admin} record={record} />
              if (tab === 'json')
                return (
                  <Inspector value={admin.selectedRecord} defaultExpanded />
                )
              return (
                <FrameOverview
                  admin={admin}
                  record={record}
                  errorHero={
                    recordHasError(record) ? (
                      <ErrorHero admin={admin} record={record} />
                    ) : null
                  }
                />
              )
            }}
          </div>
        )
      }}
    </section>
  )
}

function sameNameCount(admin: OtlpAdmin, record: AdminRecord): number {
  const name = recordReatomName(record)
  let count = 0
  for (const entry of admin.visibleRecords()) {
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

