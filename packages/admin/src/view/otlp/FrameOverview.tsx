import { atom, type AtomLike } from '@reatom/core'

import {
  explainRecordMatch,
  filterByValueDraft,
  captureClockNow,
  formatCaptureAge,
  formatRecordDuration,
  formatWriteChangeText,
  groupedOverviewAttributes,
  writeClipboard,
  isMaskedOtlpValue,
  isStateWrite,
  nameSegments,
  type AdminRecord,
  type OtlpAdmin,
} from '../../otlp'
import {
  Button,
  Disclosure,
  Eyebrow,
  SearchField,
  tokens,
  type,
} from '../design-system'
import { Inspector, ParamList } from '../inspector'
import {
  frameValueView,
  overviewDataValue,
  overviewEventAttributes,
  overviewParamsValue,
} from './frameValues'
import { CauseChips } from './FrameParts'

const quiet = `
  ${type.meta}
  margin: 0;
  color: ${tokens.text2};
`

let serial = 0

const SnapshotInspector = ({ value }: { value: unknown }) => {
  serial += 1
  const source = atom(value, `_Admin.frame.overview.snap.${serial}`)
  return <Inspector value={source} defaultExpanded />
}

const ValuePane = ({
  title,
  value,
  masked,
  raw,
}: {
  title: string
  value: unknown
  masked: boolean
  raw: AtomLike<string>
}) => {
  const mode = atom<'tree' | 'raw'>(
    'tree',
    `_Admin.frame.overview.mode.${++serial}`,
  )
  const view = frameValueView(value)
  return (
    <section
      css={`
        display: grid;
        gap: var(--admin-space-4);
        min-width: 0;
      `}
    >
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--admin-space-6);
        `}
      >
        <Eyebrow>{title}</Eyebrow>
        <span
          css={`
            display: inline-flex;
            gap: var(--admin-space-4);
          `}
        >
          {view === 'empty' ? null : (
          <Button
            variant="ghost"
            label={`Show ${title} as tree`}
            pressed={() => mode() === 'tree'}
            onClick={() => mode.set('tree')}
          >
            JSON
          </Button>
          )}
          {view === 'empty' ? null : (
          <Button
            variant="ghost"
            label={`Show ${title} as text`}
            pressed={() => mode() === 'raw'}
            onClick={() => mode.set('raw')}
          >
            Raw
          </Button>
          )}
          {view === 'empty' ? null : (
          <Button
            variant="ghost"
            label={`Copy ${title}`}
            onClick={() => {
              const text =
                typeof value === 'string'
                  ? value
                  : (() => {
                      try {
                        return JSON.stringify(value, null, 2) ?? ''
                      } catch {
                        return String(value)
                      }
                    })()
              writeClipboard(text)
            }}
          >
            Copy
          </Button>
          )}
        </span>
      </div>
      {masked ? (
        <p css={quiet}>from attributes, masked</p>
      ) : null}
      {() =>
        mode() === 'raw' ? (
          <pre
            css={`
              ${type.data}
              margin: 0;
              white-space: pre-wrap;
              overflow-wrap: anywhere;
            `}
          >
            {raw()}
          </pre>
        ) : view === 'empty' ? (
          <p css={quiet}>{`No ${title.toLowerCase()}`}</p>
        ) : title === 'Params' ? (
          <ParamList
            value={atom(value, `_Admin.frame.overview.params.${++serial}`)}
          />
        ) : (
          <SnapshotInspector value={value} />
        )
      }
    </section>
  )
}

const AttributeRow = ({
  entry,
  admin,
}: {
  entry: { key: string; value: unknown }
  admin: OtlpAdmin
}) => {
  const text =
    typeof entry.value === 'string'
      ? entry.value
      : (() => {
          try {
            return JSON.stringify(entry.value)
          } catch {
            return String(entry.value)
          }
        })()
  return (
    <div
      css={`
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--admin-space-6);
        align-items: start;
        &:hover [data-copy],
        &:focus-within [data-copy] {
          opacity: 1;
        }
      `}
    >
      <div css={`min-width: 0;`}>
        <p
          css={`
            ${type.meta}
            margin: 0;
            color: ${tokens.text3};
          `}
        >
          {entry.key}
        </p>
        <p
          css={`
            ${type.data}
            margin: 0;
            overflow-wrap: anywhere;
          `}
        >
          {text}
        </p>
      </div>
        <span
          data-copy
          css={`
            display: inline-flex;
            gap: var(--admin-space-4);
            opacity: 0;
            &:focus-within {
              opacity: 1;
            }
          `}
        >
        <Button
          variant="ghost"
          label={`Copy ${entry.key}`}
          onClick={() => writeClipboard(text)}
        >
          Copy
        </Button>
        <Button
          variant="ghost"
          label={`Filter by ${entry.key}`}
          onClick={() =>
            admin.pendingCalculatorDraft.set(
              filterByValueDraft(entry.key, entry.value),
            )
          }
        >
          Filter
        </Button>
      </span>
    </div>
  )
}

export const NameBreadcrumb = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const name = record.atomName ?? record.name
  const segments = nameSegments(name)
  return (
    <span
      css={`
        display: inline-flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--admin-space-4);
        min-width: 0;
      `}
    >
      {segments.map((segment, index) => (
        <>
          {index === 0 ? null : (
            <span css={`color: ${tokens.text3};`}>›</span>
          )}
          <Button
            variant="ghost"
            label={`Draft filter ${segment.draft}`}
            onClick={() => admin.pendingCalculatorDraft.set(segment.draft)}
          >
            {segment.label}
          </Button>
        </>
      ))}
    </span>
  )
}

export const PositionMark = ({
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
  const RANGE_CAP_MS = 365 * 86_400_000
  if (maxEnd - minStart > RANGE_CAP_MS) {
    maxEnd = minStart
    for (const entry of trace) {
      const end = entry.end ?? entry.start
      if (end - minStart <= RANGE_CAP_MS) maxEnd = Math.max(maxEnd, end)
    }
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
        {`+${formatRecordDuration({ ...record, start: minStart, end: record.start })} · ${formatRecordDuration(record)} / ${formatRecordDuration({ ...record, start: minStart, end: maxEnd })}`}
      </p>
    </div>
  )
}

export const FrameOverview = ({
  admin,
  record,
  errorHero,
}: {
  admin: OtlpAdmin
  record: AdminRecord
  errorHero: Element | null
}) => {
  const search = atom('', `_Admin.frame.overview.search.${++serial}`)
  const data = overviewDataValue(record)
  const params = overviewParamsValue(record)
  const eventAttributes = overviewEventAttributes(record)
  const writePreview = formatWriteChangeText(record, admin.records())
  const writes = isStateWrite(record)
    ? admin.records().filter(
        (entry) =>
          entry.atomName === record.atomName &&
          entry.sourceId === record.sourceId,
      )
    : []
  const firstWrite = writes[0]
  const lastWrite = writes.at(-1)
  const rawData = atom(
    typeof data === 'string' ? data : JSON.stringify(data, null, 2) ?? '',
    `_Admin.frame.overview.rawData.${serial}`,
  )
  const rawParams = atom(
    typeof params === 'string' ? params : JSON.stringify(params, null, 2) ?? '',
    `_Admin.frame.overview.rawParams.${serial}`,
  )
  return (
    <div
      css={`
        container: frame-overview / inline-size;
        display: grid;
        gap: var(--admin-space-12);
        min-width: 0;
      `}
    >
      {errorHero}
      {writePreview ? (
        <p
          css={`
            ${type.data}
            margin: 0;
          `}
        >
          {writePreview}
        </p>
      ) : null}
      <CauseChips admin={admin} record={record} />
      {() => {
        const source = admin.filterCalculator().trim()
        if (source === '') return null
        const mode = admin.filterMode()
        if (mode === 'hide' || mode === 'exclude') return null
        if (mode === 'highlight' && !admin.highlightedIds().has(record.id)) {
          return null
        }
        const lines = explainRecordMatch(record, source, admin.records())
        if (lines === undefined) return null
        return (
          <div
            data-testid="filter-match"
            css={`
              display: grid;
              gap: var(--admin-space-4);
            `}
          >
            {lines.map((line) => (
              <span
                css={`
                  ${type.meta}
                  color: ${tokens.text2};
                `}
              >
                <span
                  css={`
                    color: ${line.matched ? tokens.success : tokens.error};
                  `}
                >
                  {line.matched ? '✓' : '✗'}
                </span>
                {` ${line.clause}`}
                {line.hops && line.hops.length > 0
                  ? ` via ${line.hops.join(' → ')}`
                  : ''}
              </span>
            ))}
          </div>
        )
      }}
      <div
        css={`
          display: grid;
          gap: var(--admin-space-12);
          min-width: 0;
          @container frame-overview (min-width: 320px) {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          }
        `}
      >
        <ValuePane
          title={isStateWrite(record) ? 'State' : 'Payload'}
          value={data}
          masked={isMaskedOtlpValue(
            record,
            isStateWrite(record) ? 'state' : 'payload',
          )}
          raw={rawData}
        />
        <ValuePane
          title="Params"
          value={params}
          masked={isMaskedOtlpValue(record, 'params')}
          raw={rawParams}
        />
      </div>
      {writes.length > 0 ? (
        <p
          css={`
            ${type.meta}
            margin: 0;
            color: ${tokens.text2};
            font-variant-numeric: tabular-nums;
          `}
        >
          {(() => {
            const clock = captureClockNow(admin.records(), Date.now())
            const firstAge = firstWrite
              ? formatCaptureAge(clock, firstWrite.start)
              : undefined
            const lastAge = lastWrite
              ? formatCaptureAge(clock, lastWrite.start)
              : undefined
            const noun = writes.length === 1 ? 'write' : 'writes'
            const ages =
              firstAge || lastAge
                ? ` · first ${firstAge ?? '—'} · last ${lastAge ?? '—'}`
                : ''
            return `${writes.length} ${noun} in view${ages}`
          })()}
        </p>
      ) : null}
      <PositionMark admin={admin} record={record} />
      {eventAttributes !== undefined ? (
        <SnapshotInspector value={eventAttributes} />
      ) : null}
      <section
        css={`
          display: grid;
          gap: var(--admin-space-8);
          min-width: 0;
        `}
      >
        <Eyebrow>Attributes</Eyebrow>
        <SearchField
          value={search}
          label="Search attributes"
          placeholder="Filter keys"
          shortcut=""
        />
        {() =>
          groupedOverviewAttributes(record, search()).map((group) => {
            const body = (
              <div
                css={`
                  display: grid;
                  gap: var(--admin-space-6);
                `}
              >
                {group.entries.map((entry) => (
                  <AttributeRow admin={admin} entry={entry} />
                ))}
              </div>
            )
            if (group.collapsed) {
              return (
                <Disclosure label={`${group.label} ${group.entries.length}`}>
                  {body}
                </Disclosure>
              )
            }
            return (
              <div
                css={`
                  display: grid;
                  gap: var(--admin-space-6);
                `}
              >
                <Eyebrow summary={String(group.entries.length)}>
                  {group.label}
                </Eyebrow>
                {body}
              </div>
            )
          })
        }
      </section>
    </div>
  )
}
