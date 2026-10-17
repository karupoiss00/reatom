import { atom } from '@reatom/core'

import {
  atomWriteSeries,
  captureClockNow,
  formatCaptureAge,
  groupWriteCounts,
  numericWriteValue,
  writeSeriesHeader,
  type AdminRecord,
  type HistoryGroupBy,
  type OtlpAdmin,
} from '../../otlp'
import {
  Button,
  Eyebrow,
  SelectField,
  tokens,
  type,
} from '../design-system'
import { Inspector } from '../inspector'
import { FunnelTrack } from '../design-system'
import { recordFieldValue } from './frameValues'
import { HistoryStepChart } from './WriteChart'

const quiet = `
  ${type.meta}
  margin: 0;
  color: ${tokens.text2};
`

let serial = 0

const SnapshotInspector = ({ value }: { value: unknown }) => {
  serial += 1
  const source = atom(value, `_Admin.frame.history.snap.${serial}`)
  return <Inspector value={source} defaultExpanded />
}

export const FrameHistory = ({
  admin,
  record,
}: {
  admin: OtlpAdmin
  record: AdminRecord
}) => {
  if (record.atomName === undefined) {
    return <p css={quiet}>No earlier value</p>
  }
  const groupBy = atom<HistoryGroupBy>(
    'cause',
    `_Admin.frame.history.group.${++serial}`,
  )
  const points = atomWriteSeries(
    admin.records(),
    record.atomName,
    record.sourceId,
  )
  if (points.length === 0) return <p css={quiet}>No earlier value</p>
  const header = writeSeriesHeader(points)
  const index = Math.max(
    0,
    points.findIndex((point) => point.record.id === record.id),
  )
  const current = points[index] ?? points.at(-1)!
  const numeric = points.every((point) => numericWriteValue(point.value) !== undefined)
  const selectPoint = (recordId: string) => {
    const match = admin.records().find((entry) => entry.id === recordId)
    if (!match) return
    admin.selectRecord(match)
    admin.cardOpen.setTrue()
  }
  const move = (delta: number) => {
    const next = points[index + delta]
    if (next) selectPoint(next.record.id)
  }
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-12);
        min-width: 0;
      `}
    >
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--admin-space-8);
        `}
      >
        <span
          css={`
            ${type.meta}
            font-variant-numeric: tabular-nums;
          `}
        >
          {`${index + 1} of ${points.length}`}
        </span>
        <Button
          variant="ghost"
          label="Previous write"
          onClick={() => move(-1)}
        >
          Prev
        </Button>
        <Button variant="ghost" label="Next write" onClick={() => move(1)}>
          Next
        </Button>
      </div>
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
          const first =
            header.first === undefined
              ? undefined
              : formatCaptureAge(clock, header.first)
          const last =
            header.last === undefined
              ? undefined
              : formatCaptureAge(clock, header.last)
          const ages =
            first || last ? `first ${first ?? '—'} · last ${last ?? '—'} · ` : ''
          return `${ages}${header.count}`
        })()}
      </p>
      {numeric ? (
        <HistoryStepChart points={points} onSelect={selectPoint} />
      ) : null}
      <SelectField
        value={groupBy}
        label="Group writes"
        options={[
          { value: 'cause', label: 'Cause action' },
          { value: 'route', label: 'Route' },
          { value: 'session', label: 'Session' },
          { value: 'outcome', label: 'Outcome' },
        ]}
      />
      {() => {
        const bars = groupWriteCounts(points, groupBy(), admin.records())
        const max = Math.max(1, ...bars.map((bar) => bar.count))
        return bars.map((bar) => (
          <FunnelTrack
            label={bar.label}
            meta={String(bar.count)}
            fill={bar.count / max}
          />
        ))
      }}
      <section
        css={`
          display: grid;
          gap: var(--admin-space-4);
        `}
      >
        <Eyebrow>Current</Eyebrow>
        <SnapshotInspector value={recordFieldValue(current.record)} />
      </section>
      {points
        .filter((point) => point.record.id !== current.record.id)
        .reverse()
        .map((point) => (
          <section
            css={`
              display: grid;
              gap: var(--admin-space-4);
            `}
          >
            <Eyebrow>Previous state</Eyebrow>
            <SnapshotInspector value={recordFieldValue(point.record)} />
          </section>
        ))}
    </div>
  )
}
