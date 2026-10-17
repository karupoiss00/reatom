import { recordHasError, recordLabel } from '../otlp/bind'
import { errorGroupKey } from '../otlp/ingest'
import type { AdminRecord } from '../otlp/ingest'
import { formatAxisOffset } from './formatTime'

export type LogGroupKind = 'repeat' | 'error' | 'hidden-mount' | 'hidden-abort'

export type LogGroup = {
  key: string
  kind: LogGroupKind
  members: AdminRecord[]
  count: number
}

export type FoldedLogRows = {
  rows: AdminRecord[]
  groupByRecord: Map<AdminRecord, LogGroup>
}

export const HIDDEN_MOUNT_ROW_ID = 'log-group:hidden-mount'
export const HIDDEN_ABORT_ROW_ID = 'log-group:hidden-abort'

export function isHiddenLogGroupRow(record: AdminRecord): boolean {
  return (
    record.id === HIDDEN_MOUNT_ROW_ID || record.id === HIDDEN_ABORT_ROW_ID
  )
}

export function createHiddenLogRow(id: string): AdminRecord {
  return {
    id,
    sourceId: 'local',
    kind: 'log',
    traceId: '',
    spanId: '',
    name: '',
    start: 0,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
  }
}

function repeatKey(record: AdminRecord): string {
  return `${record.name}\0${record.reatomKind ?? record.kind}\0${record.eventName ?? ''}`
}

function hiddenLabel(kind: 'mount' | 'abort', count: number): string {
  if (kind === 'mount') {
    return `${count} mount ${count === 1 ? 'read' : 'reads'} hidden`
  }
  return `${count} abort ${count === 1 ? 'row' : 'rows'} hidden`
}

export function foldLogRows(
  records: readonly AdminRecord[],
  options: {
    expandedKeys: ReadonlySet<string>
    errorsOn: boolean
    hiddenMountCount: number
    hiddenAbortCount: number
    hiddenMountRow?: AdminRecord
    hiddenAbortRow?: AdminRecord
  },
): FoldedLogRows {
  const groupByRecord = new Map<AdminRecord, LogGroup>()
  const attach = (record: AdminRecord, group: LogGroup) => {
    groupByRecord.set(record, group)
  }
  const sorted = [...records].sort((left, right) => left.start - right.start)
  const errorMembers = new Map<string, AdminRecord[]>()
  const rest: AdminRecord[] = []
  if (options.errorsOn) {
    for (const record of sorted) {
      const key = errorGroupKey(record)
      if (key === undefined || !recordHasError(record)) {
        rest.push(record)
        continue
      }
      const members = errorMembers.get(key)
      if (members) members.push(record)
      else errorMembers.set(key, [record])
    }
  } else {
    rest.push(...sorted)
  }

  const folded: AdminRecord[] = []
  let run: AdminRecord[] = []
  const flushRun = () => {
    if (run.length === 0) return
    const key = `repeat:${repeatKey(run[0]!)}`
    const latest = run[run.length - 1]!
    const group: LogGroup = { key, kind: 'repeat', members: run, count: run.length }
    if (run.length === 1) {
      folded.push(latest)
      run = []
      return
    }
    attach(latest, group)
    if (options.expandedKeys.has(key)) {
      for (const member of run) {
        attach(member, group)
        folded.push(member)
      }
    } else {
      folded.push(latest)
    }
    run = []
  }
  for (const record of rest) {
    if (run.length === 0) {
      run = [record]
      continue
    }
    if (repeatKey(run[0]!) === repeatKey(record)) {
      run.push(record)
      continue
    }
    flushRun()
    run = [record]
  }
  flushRun()

  const errorRows: AdminRecord[] = []
  for (const [key, members] of errorMembers) {
    if (members.length === 0) continue
    const latest = members[members.length - 1]!
    if (members.length === 1) {
      errorRows.push(latest)
      continue
    }
    const group: LogGroup = {
      key: `error:${key}`,
      kind: 'error',
      members,
      count: members.length,
    }
    attach(latest, group)
    errorRows.push(latest)
    if (options.expandedKeys.has(group.key)) {
      for (const member of members) {
        if (member === latest) continue
        attach(member, group)
        errorRows.push(member)
      }
    }
  }
  errorRows.sort((left, right) => left.start - right.start)

  const start = sorted[0]?.start ?? 0
  const hidden: AdminRecord[] = []
  if (options.hiddenMountCount > 0) {
    const row = options.hiddenMountRow ?? createHiddenLogRow(HIDDEN_MOUNT_ROW_ID)
    row.name = hiddenLabel('mount', options.hiddenMountCount)
    row.start = start
    attach(row, {
      key: HIDDEN_MOUNT_ROW_ID,
      kind: 'hidden-mount',
      members: [],
      count: options.hiddenMountCount,
    })
    hidden.push(row)
  }
  if (options.hiddenAbortCount > 0) {
    const row = options.hiddenAbortRow ?? createHiddenLogRow(HIDDEN_ABORT_ROW_ID)
    row.name = hiddenLabel('abort', options.hiddenAbortCount)
    row.start = start
    attach(row, {
      key: HIDDEN_ABORT_ROW_ID,
      kind: 'hidden-abort',
      members: [],
      count: options.hiddenAbortCount,
    })
    hidden.push(row)
  }

  const merged = [...folded, ...errorRows].sort(
    (left, right) => left.start - right.start,
  )
  return { rows: [...hidden, ...merged], groupByRecord }
}

export function logGroupOf(
  record: AdminRecord,
  groups: Map<AdminRecord, LogGroup> | undefined,
): LogGroup | undefined {
  return groups?.get(record)
}

export function logGroupLabel(group: LogGroup | undefined): string | undefined {
  if (group === undefined || group.count < 2) return undefined
  if (group.kind === 'error') return `×${group.count}`
  if (group.kind !== 'repeat') return undefined
  const first = group.members[0]!
  const last = group.members[group.members.length - 1]!
  const from = formatAxisOffset(0)
  const to = formatAxisOffset(Math.max(0, last.start - first.start))
  return `×${group.count} · ${from}–${to}`
}

export function logGroupName(record: AdminRecord, group: LogGroup | undefined): string {
  if (group?.kind === 'error') return `! ${recordLabel(record)}`
  return recordLabel(record)
}
