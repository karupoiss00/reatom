import { recordHasError, recordLabel } from '../otlp/bind'
import type { AdminRecord } from '../otlp/ingest'
import { shortenTraceId } from '../otlp/traceHeader'
import { formatAxisOffset } from './formatTime'

export type TurnKindShare = {
  kind: string
  count: number
  durationMs: number
  share: number
}

export type TurnSection = {
  turn: number
  root: AdminRecord
  name: string
  shortTraceId: string
  kindShare: TurnKindShare[]
  errorCount: number
  durationMs: number
  updateCount: number
}

function kindName(record: AdminRecord): string {
  return record.reatomKind ?? (record.kind === 'log' ? 'log' : 'action')
}

function spanDuration(record: AdminRecord): number {
  if (record.kind !== 'span' || record.end === undefined) return 0
  return Math.max(0, record.end - record.start)
}

export function isRootSpan(record: AdminRecord): boolean {
  return record.kind === 'span' && record.parentSpanId === undefined
}

export function turnSection(
  root: AdminRecord,
  records: readonly AdminRecord[],
  turn: number,
): TurnSection {
  const members = records.filter(
    (record) =>
      record.traceId === root.traceId && record.sourceId === root.sourceId,
  )
  const durationByKind = new Map<string, { count: number; durationMs: number }>()
  let errorCount = 0
  let updateCount = 0
  for (const record of members) {
    if (recordHasError(record)) errorCount += 1
    if (
      record.eventName === 'reatom.atom.update' ||
      record.eventName === 'reatom.computed.update'
    ) {
      updateCount += 1
    }
    const kind = kindName(record)
    const current = durationByKind.get(kind) ?? { count: 0, durationMs: 0 }
    current.count += 1
    current.durationMs += spanDuration(record)
    durationByKind.set(kind, current)
  }
  const totalKindMs = [...durationByKind.values()].reduce(
    (sum, entry) => sum + entry.durationMs,
    0,
  )
  const kindShare = [...durationByKind.entries()]
    .map(([kind, entry]) => ({
      kind,
      count: entry.count,
      durationMs: entry.durationMs,
      share: totalKindMs === 0 ? 0 : entry.durationMs / totalKindMs,
    }))
    .sort((left, right) => right.durationMs - left.durationMs)
  const durationMs =
    root.end === undefined ? 0 : Math.max(0, root.end - root.start)
  return {
    turn,
    root,
    name: recordLabel(root),
    shortTraceId: shortenTraceId(root.traceId),
    kindShare,
    errorCount,
    durationMs,
    updateCount,
  }
}

export function turnHairlineText(section: TurnSection): string {
  const duration = formatAxisOffset(section.durationMs)
  const time = formatAxisOffset(section.root.start)
  return `Turn ${section.turn} · ${section.name} · ${time} · ${section.updateCount} updates · ${duration}`
}

export function rootTurnNumber(
  record: AdminRecord,
  roots: readonly AdminRecord[],
): number | undefined {
  const index = roots.findIndex((root) => root.id === record.id)
  if (index === -1) return undefined
  return index + 1
}

export function orderedRoots(records: readonly AdminRecord[]): AdminRecord[] {
  return records
    .filter(isRootSpan)
    .sort((left, right) => left.start - right.start)
}

export function sectionStickyTop(
  row: AdminRecord,
  rows: readonly AdminRecord[],
  scrollOffset: number,
  rowHeight: number,
): string {
  const index = rows.findIndex((entry) => entry.id === row.id)
  if (index === -1) return '0px'
  let next = -1
  for (let i = index + 1; i < rows.length; i++) {
    if (isRootSpan(rows[i]!)) {
      next = i
      break
    }
  }
  if (next === -1) return '0px'
  const collision = next * rowHeight - scrollOffset
  if (collision < rowHeight) return `${collision - rowHeight}px`
  return '0px'
}
