import { atom, peek } from '@reatom/core'

import type { OtlpAdmin } from '../../otlp'
import { hasActiveFilter } from '../../otlp'
import type { AdminRecordKind, AdminReatomKind } from '../../otlp'
import { Button, Drawer, SearchField, truncate, type } from '../design-system'
import { FilterCalculator } from './FilterCalculator'
import { KindMark } from './KindMark'
import type { RecordKindName } from './recordKind'

let filterBarCounter = 0

const compactCount = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumSignificantDigits: 3,
})

const FilterCount = ({ value }: { value: () => number }) => (
  <span
    aria-hidden="true"
    css={`
      ${type.data}
      display: inline-block;
      inline-size: 5ch;
      flex: 0 0 5ch;
      font-variant-numeric: tabular-nums;
      text-align: end;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `}
  >
    {() => {
      const count = value()
      return count < 10_000 ? String(count) : compactCount.format(count)
    }}
  </span>
)

const CHIP_KINDS: Array<{
  label: string
  reatomKind: AdminReatomKind
  icon: RecordKindName
}> = [
  { label: 'Actions', reatomKind: 'action', icon: 'action' },
  { label: 'Atoms', reatomKind: 'atom', icon: 'atom' },
  { label: 'Computed', reatomKind: 'computed', icon: 'computed' },
]

export const OtlpFilterBar = ({ admin }: { admin: OtlpAdmin }) => {
  const barId = ++filterBarCounter
  const editorOpen = atom(false, `_Admin.filter.editor.${barId}`)
  const draft = atom(
    peek(admin.filterCalculator),
    `_Admin.filter.draft.${barId}`,
  )
  const errors = () => admin.recordCounts().errors
  const logs = () => admin.recordCounts().logs
  const aborts = () =>
    admin.showAbortAndSuspense()
      ? admin.abortSuspenseCount()
      : admin.hiddenAbortSuspenseCount()
  const mounts = () =>
    admin.showMountLogs() ? admin.mountLogCount() : admin.hiddenMountLogCount()

  const toggleKind = (kind: AdminReatomKind) => {
    admin.filterKind.set(undefined)
    admin.filterReatomKind.set(
      admin.filterReatomKind() === kind ? undefined : kind,
    )
  }

  const reset = () => {
    admin.resetFilter()
    admin.showAbortAndSuspense.setFalse()
    admin.showMountLogs.setFalse()
    draft.set('')
  }

  return (
    <div
      css={`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--admin-space-8);
        padding: var(--admin-space-8);
        min-width: 0;
      `}
    >
      <SearchField
        value={admin.filterName}
        label="Name"
        placeholder="Name"
        shortcut=""
        testId="filter-name"
      />
      <SearchField
        value={admin.filterQuery}
        label="Value"
        placeholder="Value"
        shortcut=""
        testId="filter-value"
      />
      {() => {
        const scope = admin.analytics.scope()
        if (scope === null) return null
        return (
          <span
            data-testid="analytics-scope"
            css={`
              display: inline-flex;
              align-items: center;
              gap: var(--admin-space-4);
            `}
          >
            <span>{scope.label}</span>
            <Button
              variant="ghost"
              label="Remove session scope"
              onClick={() => admin.analytics.scope.clearScope()}
            >
              Remove session scope
            </Button>
          </span>
        )
      }}
      {() =>
        admin.view() === 'analytics' ||
        (admin.view() === 'timeline' && admin.timelineUnit() === 'paths') ? (
          <span
            css={`
              display: inline-flex;
              gap: var(--admin-space-4);
            `}
          >
            <Button
              variant="ghost"
              label="Include"
              testId="analytics-segment-include"
              pressed={() => admin.analytics.segmentMode() === 'include'}
              disabled={() => !hasActiveFilter(admin.filter())}
              onClick={() => admin.analytics.segmentMode.set('include')}
            >
              Include
            </Button>
            <Button
              variant="ghost"
              label="Exclude"
              testId="analytics-segment-exclude"
              pressed={() => admin.analytics.segmentMode() === 'exclude'}
              disabled={() => !hasActiveFilter(admin.filter())}
              onClick={() => admin.analytics.segmentMode.set('exclude')}
            >
              Exclude
            </Button>
          </span>
        ) : null
      }
      <Button
        variant="ghost"
        label="Errors"
        title={() => `Errors: ${errors()}`}
        pressed={() => admin.filterHasError() === true}
        onClick={() => {
          admin.filterHasError.set(
            admin.filterHasError() === true ? undefined : true,
          )
        }}
      >
        <span>Errors</span> <FilterCount value={errors} />
      </Button>
      {CHIP_KINDS.map((chip) => {
        const count = () => admin.recordCounts().kinds[chip.reatomKind] ?? 0
        return (
          <Button
            variant="ghost"
            label={chip.label}
            title={() => `${chip.label}: ${count()}`}
            pressed={() => admin.filterReatomKind() === chip.reatomKind}
            onClick={() => toggleKind(chip.reatomKind)}
          >
            <KindMark kind={chip.icon} />
            <span>{chip.label}</span> <FilterCount value={count} />
          </Button>
        )
      })}
      <Button
        variant="ghost"
        label="LOG"
        title={() => `LOG: ${logs()}`}
        pressed={() => admin.filterKind() === 'log'}
        onClick={() => {
          const next: AdminRecordKind | undefined =
            admin.filterKind() === 'log' ? undefined : 'log'
          admin.filterKind.set(next)
          if (next === 'log') admin.filterReatomKind.set(undefined)
        }}
      >
        <KindMark kind="log" />
        <span>LOG</span> <FilterCount value={logs} />
      </Button>
      <Button
        variant="ghost"
        label="Aborted and suspense"
        title={() => `Aborted and suspense: ${aborts()}`}
        pressed={() => admin.showAbortAndSuspense()}
        onClick={() => admin.showAbortAndSuspense.toggle()}
      >
        <span>Aborted and suspense</span> <FilterCount value={aborts} />
      </Button>
      <Button
        variant="ghost"
        label="Mount logs"
        title={() =>
          `Mount logs: ${mounts()}. Logs from the first read or connect of an atom`
        }
        pressed={() => admin.showMountLogs()}
        onClick={() => admin.showMountLogs.toggle()}
      >
        <span>Mount logs</span> <FilterCount value={mounts} />
      </Button>
      {() => {
        const applied = admin.filterCalculator().trim()
        if (applied === '') return null
        return (
          <Button
            label={`Remove applied expression ${applied}`}
            title={`Applied expression: ${applied}. Click to remove it.`}
            onClick={() => admin.filterCalculator.set('')}
          >
            <span
              css={`
                ${type.data}
                ${truncate}
                max-width: 16rem;
              `}
            >
              {`= ${applied}`}
            </span>
            <span aria-hidden="true">×</span>
          </Button>
        )
      }}
      <Button label="Advanced filters" onClick={() => editorOpen.set(true)}>
        Advanced filters
      </Button>
      <Drawer
        open={editorOpen}
        label="Advanced filters"
        onClose={() => editorOpen.set(false)}
      >
        <FilterCalculator admin={admin} draft={draft} />
      </Drawer>
      {() =>
        hasActiveFilter(admin.filter()) ||
        admin.showAbortAndSuspense() ||
        admin.showMountLogs() ? (
          <Button label="Reset filters" onClick={reset}>
            Reset
          </Button>
        ) : null
      }
    </div>
  )
}
