import { atom, effect, peek, type Atom } from '@reatom/core'

import { mcpCallLog } from '../../mcp/callLog'
import type { OtlpAdmin } from '../../otlp'
import {
  appendCalculatorClause,
  calculatorClauses,
  chipCountRecords,
  describeCalculator,
  hasActiveFilter,
  parseCalculator,
  quoteCalculatorValue,
  removeCalculatorClause,
  topRecordNames,
} from '../../otlp'
import type { AdminRecord, AdminRecordKind, AdminReatomKind } from '../../otlp'
import {
  Button,
  Disclosure,
  Hint,
  Popover,
  SearchField,
  tokens,
  truncate,
  type,
} from '../design-system'
import { FilterCalculator } from './FilterCalculator'
import { KindSwatch } from './KindMark'
import type { RecordKindName } from './recordKind'

let filterBarCounter = 0

const CHIP_KINDS: Array<{
  label: string
  reatomKind: AdminReatomKind
  icon: RecordKindName
}> = [
  { label: 'Actions', reatomKind: 'action', icon: 'action' },
  { label: 'Atoms', reatomKind: 'atom', icon: 'atom' },
  { label: 'Computed', reatomKind: 'computed', icon: 'computed' },
]

function countRecords(
  records: readonly AdminRecord[],
  match: (record: AdminRecord) => boolean,
): number {
  let count = 0
  for (const record of records) {
    if (match(record)) count += 1
  }
  return count
}

let namesPopoverCounter = 0

const NamesPopover = ({
  admin,
  draft,
}: {
  admin: OtlpAdmin
  draft: Atom<string>
}) => {
  const popoverId = ++namesPopoverCounter
  const query = atom('', `_Admin.filter.namesQuery.${popoverId}`)
  const expanded = atom(false, `_Admin.filter.namesExpanded.${popoverId}`)
  return (
    <Popover triggerLabel="Names" label="Top names">
      <div
        css={`
          display: grid;
          gap: var(--admin-space-8);
          min-width: 12rem;
        `}
      >
        <SearchField
          value={query}
          label="Search names"
          placeholder="Search names"
          shortcut=""
        />
        <div
          css={`
            display: grid;
            gap: var(--admin-space-4);
          `}
        >
          {() => {
            const needle = query().trim().toLowerCase()
            const names = topRecordNames(
              chipCountRecords(admin, admin.filter()),
              20,
            ).filter(
              (entry) =>
                needle === '' || entry.name.toLowerCase().includes(needle),
            )
            const visible = names.slice(0, expanded() ? 20 : 8)
            return visible.map((entry) => (
              <Button
                variant="ghost"
                label={`Draft filter ${entry.name}`}
                onClick={() => {
                  draft.set(`name:${quoteCalculatorValue(entry.name)}`)
                }}
              >
                <span>{entry.name}</span>
                <span
                  css={`
                    ${type.meta}
                    color: ${tokens.text3};
                    font-variant-numeric: tabular-nums;
                  `}
                >
                  {entry.count}
                </span>
              </Button>
            ))
          }}
        </div>
        {() =>
          expanded() ? null : (
            <Button
              variant="ghost"
              label="Show more names"
              onClick={() => expanded.set(true)}
            >
              Show more
            </Button>
          )
        }
      </div>
    </Popover>
  )
}

export const OtlpFilterBar = ({ admin }: { admin: OtlpAdmin }) => {
  const barId = ++filterBarCounter
  const draft = atom(
    peek(admin.filterCalculator),
    `_Admin.filter.draft.${barId}`,
  )
  const advancedOpen = atom(false, `_Admin.filter.advancedOpen.${barId}`)
  effect(() => {
    const pending =
      admin.pendingCalculatorDraft() ?? mcpCallLog().pendingCalculatorDraft()
    if (pending === null) return
    admin.pendingCalculatorDraft.set(null)
    mcpCallLog().pendingCalculatorDraft.set(null)
    advancedOpen.set(true)
    const current = draft().trim()
    const isClause = /^(NOT \(.+\)|[A-Za-z.][A-Za-z0-9.]*\s*[=:<>]+)/.test(
      pending,
    )
    if (isClause && current !== '' && !current.includes(pending)) {
      draft.set(appendCalculatorClause(current, pending))
      return
    }
    draft.set(pending)
  }, `_Admin.filter.pendingDraft.${barId}`)
  effect(() => {
    admin.filterDraft.set(draft())
  }, `_Admin.filter.draftSync.${barId}`)

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
    admin.hoveredClause.set(null)
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
              title={() =>
                hasActiveFilter(admin.filter())
                  ? 'Sessions that match stay in'
                  : 'Add a name, value, chip, or expression first'
              }
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
              title={() =>
                hasActiveFilter(admin.filter())
                  ? 'Sessions that match drop out'
                  : 'Add a name, value, chip, or expression first'
              }
              onClick={() => admin.analytics.segmentMode.set('exclude')}
            >
              Exclude
            </Button>
            {() =>
              hasActiveFilter(admin.filter()) ? null : (
                <Hint>Include and Exclude need an active filter.</Hint>
              )
            }
          </span>
        ) : null
      }
      <Button
        variant="ghost"
        label="Errors"
        pressed={() => admin.filterHasError() === true}
        onClick={() => {
          admin.filterHasError.set(
            admin.filterHasError() === true ? undefined : true,
          )
        }}
      >
        <span>Errors</span>
        <span
          css={`
            ${type.meta}
            font-variant-numeric: tabular-nums;
          `}
        >
          {() => {
            const count = countRecords(
              chipCountRecords(admin, admin.filter()),
              (record) => record.error != null || record.outcome === 'error',
            )
            return (
              <span
                css={`
                  color: ${count > 0 ? tokens.error : tokens.text3};
                  opacity: ${count === 0 ? 0.55 : 1};
                `}
              >
                {count}
              </span>
            )
          }}
        </span>
      </Button>
      {CHIP_KINDS.map((chip) => (
        <Button
          variant="ghost"
          label={chip.label}
          pressed={() => admin.filterReatomKind() === chip.reatomKind}
          onClick={() => toggleKind(chip.reatomKind)}
        >
          <KindSwatch kind={chip.icon} />
          <span>{chip.label}</span>
          <span
            css={`
              ${type.meta}
              color: ${tokens.text3};
              font-variant-numeric: tabular-nums;
            `}
          >
            {() => {
              const count = countRecords(
                chipCountRecords(admin, admin.filter()),
                (record) => record.reatomKind === chip.reatomKind,
              )
              return (
                <span
                  css={`
                    opacity: ${count === 0 ? 0.55 : 1};
                  `}
                >
                  {count}
                </span>
              )
            }}
          </span>
        </Button>
      ))}
      <Button
        variant="ghost"
        label="LOG"
        pressed={() => admin.filterKind() === 'log'}
        onClick={() => {
          const next: AdminRecordKind | undefined =
            admin.filterKind() === 'log' ? undefined : 'log'
          admin.filterKind.set(next)
          if (next === 'log') admin.filterReatomKind.set(undefined)
        }}
      >
        <KindSwatch kind="log" />
        <span>LOG</span>
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
            font-variant-numeric: tabular-nums;
          `}
        >
          {() => {
            const count = countRecords(
              chipCountRecords(admin, admin.filter()),
              (record) => record.kind === 'log',
            )
            return (
              <span
                css={`
                  opacity: ${count === 0 ? 0.55 : 1};
                `}
              >
                {count}
              </span>
            )
          }}
        </span>
      </Button>
      <NamesPopover admin={admin} draft={draft} />
      {() => {
        const applied = admin.filterCalculator().trim()
        if (applied === '') return null
        const sentence = describeCalculator(applied, admin.filterMode())
        const clauses = calculatorClauses(applied)
        const pills = clauses.length > 0 ? clauses : [{ source: applied }]
        return (
          <span
            data-testid="filter-clause-pills"
            css={`
              display: inline-flex;
              flex-wrap: wrap;
              align-items: center;
              gap: var(--admin-space-6);
              min-width: 0;
            `}
          >
            {pills.map((clause) => (
              <Button
                variant="ghost"
                label={`Remove clause ${clause.source}`}
                title={clause.source}
                onClick={() => {
                  const next = removeCalculatorClause(applied, clause.source)
                  admin.filterCalculator.set(next)
                  draft.set(next)
                }}
              >
                <span
                  css={`
                    ${type.data}
                    ${truncate}
                    max-width: 12rem;
                  `}
                >
                  {clause.source}
                </span>
                <span aria-hidden="true">×</span>
              </Button>
            ))}
            {sentence ? (
              <span
                css={`
                  ${type.meta}
                  color: ${tokens.text3};
                `}
              >
                {sentence}
              </span>
            ) : null}
          </span>
        )
      }}
      <div
        css={`
          min-width: 0;
          &:has(> details[open]) {
            flex-basis: 100%;
            order: 1;
          }
        `}
      >
        <Disclosure
          open={advancedOpen}
          label="Advanced filters"
          detail={() => {
            const mode = admin.filterMode()
            const modeLabel =
              mode === 'highlight'
                ? 'Highlight'
                : mode === 'hide' || mode === 'exclude'
                  ? 'Hide'
                  : 'Show'
            const parsed = parseCalculator(admin.filterCalculator())
            const clauses = parsed.ok ? parsed.tags.length : 0
            const matches = admin.matchedRecords().length
            const parts = [modeLabel]
            if (clauses > 0) {
              parts.push(`${clauses} ${clauses === 1 ? 'clause' : 'clauses'}`)
            }
            parts.push(`${matches} ${matches === 1 ? 'match' : 'matches'}`)
            return parts.join(' · ')
          }}
        >
          <div
            css={`
              display: grid;
              gap: var(--admin-space-8);
            `}
          >
            <Button
              variant="ghost"
              label="Aborted and suspense"
              pressed={() => admin.showAbortAndSuspense()}
              onClick={() => admin.showAbortAndSuspense.toggle()}
            >
              {() => {
                const count = admin.showAbortAndSuspense()
                  ? admin.abortSuspenseCount()
                  : admin.hiddenAbortSuspenseCount()
                return count > 0
                  ? `Aborted and suspense ${count}`
                  : 'Aborted and suspense'
              }}
            </Button>
            <Button
              variant="ghost"
              label="Mount logs"
              title="Logs from the first read or connect of an atom"
              pressed={() => admin.showMountLogs()}
              onClick={() => admin.showMountLogs.toggle()}
            >
              {() => {
                const count = admin.showMountLogs()
                  ? admin.mountLogCount()
                  : admin.hiddenMountLogCount()
                return count > 0 ? `Mount logs ${count}` : 'Mount logs'
              }}
            </Button>
            <Button
              variant="ghost"
              label="Edit as expression"
              onClick={() => {
                const parts: string[] = []
                if (admin.filterHasError() === true) parts.push('errors:true')
                if (admin.filterReatomKind() === 'action')
                  parts.push('kind:action')
                if (admin.filterReatomKind() === 'atom') parts.push('kind:atom')
                if (admin.filterReatomKind() === 'computed')
                  parts.push('kind:computed')
                if (admin.filterKind() === 'log') parts.push('kind:log')
                if (parts.length > 0) draft.set(parts.join(' '))
              }}
            >
              Edit as expression
            </Button>
            <FilterCalculator admin={admin} draft={draft} />
          </div>
        </Disclosure>
      </div>
      {() =>
        hasActiveFilter(admin.filter()) ||
        admin.showAbortAndSuspense() ||
        admin.showMountLogs() ? (
          <Button label="Clear all" onClick={reset}>
            Clear all
          </Button>
        ) : null
      }
    </div>
  )
}
