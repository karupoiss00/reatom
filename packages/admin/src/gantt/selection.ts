import type { Action, Computed } from '@reatom/core'
import { action, effect } from '@reatom/core'

import type { AdminRecord } from '../otlp/ingest'
import { adminRecordTiming } from './records'
import type { Gantt } from './reatomGantt'

/**
 * Admin selection is a record id. Gantt selection is the record object.
 * `connect` copies the admin record onto the Gantt (expanding waterfall
 * ancestors so a child is actually in the row list). `select` and `move` write
 * both sides together.
 */
export interface GanttRecordSelectionSource {
  selectedRecord: Computed<AdminRecord | null>
  selectRecord: (record: AdminRecord | null) => void
  visibleRecords: Computed<ReadonlyArray<AdminRecord>>
}

export interface GanttRecordSelection {
  select: Action<[record: AdminRecord | null], void>
  move: Action<[delta: number], void>
  /** Start the admin → Gantt sync. Unsubscribe when the timeline unmounts. */
  connect: () => () => void
}

function ancestorsOf(
  record: AdminRecord,
  records: ReadonlyArray<AdminRecord>,
): AdminRecord[] {
  const byId = new Map<string, AdminRecord>()
  for (const item of records) {
    const key = adminRecordTiming.id?.(item)
    if (key !== undefined) byId.set(key, item)
  }

  const ancestors: AdminRecord[] = []
  const seen = new Set<AdminRecord>()
  let current: AdminRecord | undefined = record
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const parentKey: string | undefined = adminRecordTiming.parentId?.(current)
    const parent: AdminRecord | undefined =
      parentKey === undefined ? undefined : byId.get(parentKey)
    if (parent === undefined || parent === current) break
    ancestors.push(parent)
    current = parent
  }
  ancestors.reverse()
  return ancestors
}

export function reatomGanttRecordSelection(
  gantt: Gantt<AdminRecord>,
  source: GanttRecordSelectionSource,
  name = '_Admin.otlp.gantt.selection',
): GanttRecordSelection {
  const reveal = action((record: AdminRecord) => {
    const records = source.visibleRecords()
    if (!records.includes(record)) return
    if (gantt.mode() === 'waterfall') {
      for (const ancestor of ancestorsOf(record, records)) {
        gantt.expand(ancestor)
      }
    }
    gantt.scrollToRow(record)
  }, `${name}.reveal`)

  const select = action((record: AdminRecord | null) => {
    source.selectRecord(record)
    gantt.select(record)
    if (record !== null) reveal(record)
  }, `${name}.select`)

  const move = action((delta: number) => {
    if (gantt.rows().length === 0) return
    gantt.moveSelection(delta)
    const next = gantt.selected()
    if (source.selectedRecord() !== next) source.selectRecord(next)
  }, `${name}.move`)

  let stop: (() => void) | undefined
  const connect = () => {
    stop?.()
    const sync = effect(() => {
      const record = source.selectedRecord()
      if (gantt.selected() === record) return
      gantt.select(record)
      if (record !== null) reveal(record)
    }, `${name}.sync`)
    stop = () => sync.unsubscribe()
    return stop
  }

  return { select, move, connect }
}
