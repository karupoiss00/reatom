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

const groupMeta = new WeakMap<AdminRecord, LogGroup>()

export const HIDDEN_MOUNT_ROW_ID = 'log-group:hidden-mount'
export const HIDDEN_ABORT_ROW_ID = 'log-group:hidden-abort'

export function logGroupOf(record: AdminRecord): LogGroup | undefined {
  return groupMeta.get(record)
}

export function isHiddenLogGroupRow(record: AdminRecord): boolean {
  return (
    record.id === HIDDEN_MOUNT_ROW_ID || record.id === HIDDEN_ABORT_ROW_ID
  )
}

function repeatKey(record: AdminRecord): string {
  return `${record.name}\0${record.reatomKind ?? record.kind}\0${record.eventName ?? ''}`
}

function attach(record: AdminRecord, group: LogGroup) {
  groupMeta.set(record, group)
}

function syntheticHiddenRow(
  id: string,
  name: string,
  start: number,
): AdminRecord {
  return {
    id,
    sourceId: 'local',
    kind: 'log',
    traceId: '',
    spanId: '',
    name,
    start,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
  }
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
  },
): AdminRecord[] {
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
    const group: LogGroup = {
      key: `error:${key}`,
      kind: 'error',
      members,
      count: members.length,
    }
    attach(latest, group)
    errorRows.push(latest)
    if (options.expandedKeys.has(group.key) || members.length === 1) {
      if (members.length === 1) continue
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
    const row = syntheticHiddenRow(
      HIDDEN_MOUNT_ROW_ID,
      hiddenLabel('mount', options.hiddenMountCount),
      start,
    )
    attach(row, {
      key: HIDDEN_MOUNT_ROW_ID,
      kind: 'hidden-mount',
      members: [],
      count: options.hiddenMountCount,
    })
    hidden.push(row)
  }
  if (options.hiddenAbortCount > 0) {
    const row = syntheticHiddenRow(
      HIDDEN_ABORT_ROW_ID,
      hiddenLabel('abort', options.hiddenAbortCount),
      start,
    )
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
  return [...hidden, ...merged]
}

export function logGroupLabel(record: AdminRecord): string | undefined {
  const group = logGroupOf(record)
  if (group === undefined || group.count < 2) return undefined
  if (group.kind === 'error') return `×${group.count}`
  if (group.kind !== 'repeat') return undefined
  const first = group.members[0]!
  const last = group.members[group.members.length - 1]!
  const from = formatAxisOffset(0)
  const to = formatAxisOffset(Math.max(0, last.start - first.start))
  return `×${group.count} · ${from}–${to}`
}

export function logGroupName(record: AdminRecord): string {
  const group = logGroupOf(record)
  if (group?.kind === 'error') return `! ${recordLabel(record)}`
  return recordLabel(record)
}
