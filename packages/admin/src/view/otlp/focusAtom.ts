import type { AdminRecord, OtlpAdmin } from '../../otlp'
import { isStateWrite, recordMatches } from '../../otlp'
import { isAbortOrSuspense } from '../../otlp/inProgress'
import type { FilterMode } from '../../types'

export interface FocusAtomTarget {
  atomName: string
  recordId?: string
  sourceId?: string
}

/**
 * Selects this atom's state write and opens it on the timeline Gantt.
 * `recordId` or `sourceId` picks that source. A name-only target uses the
 * latest state write. Quick filters that hide the record are cleared first, so
 * the Gantt row is actually in the list `ganttSelection` scrolls to.
 */
export function focusAtomOnTimeline(
  admin: OtlpAdmin,
  target: string | FocusAtomTarget,
): boolean {
  const request = typeof target === 'string' ? { atomName: target } : target
  const record = resolveFocusRecord(admin, request)
  if (!record) return false
  clearQuickFiltersHiding(admin, record)
  admin.ganttSelection.select(record)
  admin.view.set('timeline')
  return true
}

function resolveFocusRecord(
  admin: OtlpAdmin,
  target: FocusAtomTarget,
): AdminRecord | undefined {
  if (target.recordId !== undefined) {
    const exact =
      admin.records().find((record) => record.id === target.recordId) ??
      admin.inProgress().find((record) => record.id === target.recordId)
    if (exact) return exact
  }
  const records = admin.byAtom(target.atomName).filter((record) => {
    if (target.sourceId === undefined) return true
    return record.sourceId === target.sourceId
  })
  let record = records[records.length - 1]
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index]
    if (candidate && isStateWrite(candidate)) {
      record = candidate
      break
    }
  }
  return record
}

function clearQuickFiltersHiding(admin: OtlpAdmin, record: AdminRecord) {
  if (admin.ganttRecords().includes(record)) return
  const mode = admin.filterMode()
  const name = admin.filterName().trim()
  if (name !== '' && predicateHides(mode, recordMatches(record, { name }))) {
    admin.filterName.set('')
  }
  const query = admin.filterQuery().trim()
  if (query !== '' && predicateHides(mode, recordMatches(record, { query }))) {
    admin.filterQuery.set('')
  }
  const hasError = admin.filterHasError()
  if (
    hasError !== undefined &&
    predicateHides(mode, recordMatches(record, { hasError }))
  ) {
    admin.filterHasError.set(undefined)
  }
  const reatomKind = admin.filterReatomKind()
  if (
    reatomKind !== undefined &&
    predicateHides(mode, recordMatches(record, { reatomKind }))
  ) {
    admin.filterReatomKind.set(undefined)
  }
  const kind = admin.filterKind()
  if (
    kind !== undefined &&
    predicateHides(mode, recordMatches(record, { kind }))
  ) {
    admin.filterKind.set(undefined)
  }
  if (!admin.showAbortAndSuspense() && isAbortOrSuspense(record)) {
    admin.showAbortAndSuspense.setTrue()
  }
  if (!admin.showMountLogs() && admin.mountLogIds().has(record.id)) {
    admin.showMountLogs.setTrue()
  }
}

function predicateHides(mode: FilterMode, matches: boolean): boolean {
  if (mode === 'highlight') return false
  if (mode === 'hide' || mode === 'exclude') return matches
  return !matches
}
