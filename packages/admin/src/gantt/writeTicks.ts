import { isInProgressRecord } from '../otlp/inProgress'
import type { AdminRecord } from '../otlp/ingest'
import { isUpdateLog } from './barMark'

export type CollapsedWriteTick = {
  record: AdminRecord
  start: number
}

export function collapsedWriteTicks(
  parent: AdminRecord,
  children: readonly AdminRecord[],
  expanded: boolean,
): CollapsedWriteTick[] {
  if (expanded || parent.kind !== 'span' || isInProgressRecord(parent)) {
    return []
  }
  const ticks: CollapsedWriteTick[] = []
  for (const child of children) {
    if (!isUpdateLog(child)) continue
    ticks.push({ record: child, start: child.start })
  }
  return ticks
}

export function tickLeftFraction(
  start: number,
  windowStart: number,
  windowEnd: number,
): number | undefined {
  const span = windowEnd - windowStart
  if (!(span > 0)) return undefined
  return (start - windowStart) / span
}
