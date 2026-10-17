import {
  causeReads,
  causeTriggers,
  formatRecordDuration,
  timeNeighbors,
  type AdminRecord,
  type CauseListRow,
  type OtlpAdmin,
  type TimeNeighbor,
} from '../../otlp'
import { Button, Eyebrow, tokens, type } from '../design-system'
import { CauseRail } from './CauseRail'
import { KindSwatch } from './KindMark'
import { recordKindIcon } from './recordKind'

const quiet = `
  ${type.meta}
  margin: 0;
  color: ${tokens.text2};
`

const ListRow = ({
  admin,
  row,
  extra,
}: {
  admin: OtlpAdmin
  row: CauseListRow
  extra?: string
}) => (
  <Button
    variant="ghost"
    label={`Select ${row.name}`}
    onClick={() => {
      admin.selectRecord(row.record)
      admin.cardOpen.setTrue()
    }}
  >
    <span
      css={`
        display: inline-flex;
        align-items: center;
        gap: var(--admin-space-6);
        min-width: 0;
      `}
    >
      <KindSwatch kind={recordKindIcon(row.record, admin.mountLogIds())} />
      <span
        css={`
          ${type.data}
          overflow-wrap: anywhere;
        `}
      >
        {row.name}
      </span>
      <span
        css={`
          ${type.meta}
          color: ${tokens.text3};
          font-variant-numeric: tabular-nums;
        `}
      >
        {row.durationMs === undefined
          ? 'open'
          : formatRecordDuration({
              ...row.record,
              end: row.record.start + row.durationMs,
            })}
      </span>
      <span
        css={`
          ${type.meta}
          color: ${tokens.text3};
        `}
      >
        {row.outcome}
      </span>
      {extra ? (
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
            font-variant-numeric: tabular-nums;
          `}
        >
          {extra}
        </span>
      ) : null}
    </span>
  </Button>
)

function offsetLabel(offsetMs: number): string {
  const sign = offsetMs > 0 ? '+' : offsetMs < 0 ? '−' : ''
  return `${sign}${Math.abs(Math.round(offsetMs))}ms`
}

export const FrameCauses = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  const nodes = admin.allRailNodes()
  const thread = admin.causeThread()
  const reads = causeReads(record, admin.records())
  const triggers = causeTriggers(record, admin.records())
  const neighbors = timeNeighbors(record, admin.byTrace(record.traceId), 5)
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-12);
        min-width: 0;
      `}
    >
      {nodes.length === 0 ? (
        <p css={quiet}>No causes</p>
      ) : (
        <CauseRail
          nodes={nodes}
          selectedId={Number(record.frameId)}
          pathIds={thread.pathIds}
          errorPathUntilId={thread.errorAncestorFrameId}
          onSelect={(nodeId) => admin.selectFrame(nodeId)}
          onOpen={(nodeId) => {
            admin.selectFrame(nodeId)
            admin.cardOpen.setTrue()
          }}
        />
      )}
      <Button
        label="Open in Graph"
        testId="open-in-graph"
        onClick={() => admin.view.set('graph')}
      >
        Open in Graph
      </Button>
      {reads.length > 0 ? (
        <section css={`display: grid; gap: var(--admin-space-6);`}>
          <Eyebrow summary={String(reads.length)}>Reads</Eyebrow>
          {reads.map((row) => (
            <ListRow admin={admin} row={row} />
          ))}
        </section>
      ) : null}
      {triggers.length > 0 ? (
        <section css={`display: grid; gap: var(--admin-space-6);`}>
          <Eyebrow summary={String(triggers.length)}>Triggers</Eyebrow>
          {triggers.map((row) => (
            <ListRow admin={admin} row={row} />
          ))}
        </section>
      ) : null}
      {neighbors.length > 0 ? (
        <section
          css={`display: grid; gap: var(--admin-space-6);`}
          on:keydown={(event: KeyboardEvent) => {
            if (event.key !== 'j' && event.key !== 'k' && event.key !== 'J' && event.key !== 'K') {
              return
            }
            event.preventDefault()
            const delta = event.key === 'j' || event.key === 'J' ? 1 : -1
            const index = neighbors.findIndex((row) => row.selected)
            const next = neighbors[index + delta]
            if (next) {
              admin.selectRecord(next.record)
              admin.cardOpen.setTrue()
            }
          }}
        >
          <Eyebrow>Nearby in trace</Eyebrow>
          {neighbors.map((row: TimeNeighbor) => (
            <div data-selected={row.selected ? '' : undefined}>
              <ListRow
                admin={admin}
                row={row}
                extra={offsetLabel(row.offsetMs)}
              />
            </div>
          ))}
        </section>
      ) : null}
    </div>
  )
}
