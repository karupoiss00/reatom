import {
  errorGroupKey,
  firstExceptionMessageLine,
  recordErrorMessage,
  recordErrorStack,
  recordErrorType,
  recordReatomName,
  stackCulprit,
  type AdminRecord,
} from '../otlp/ingest.ts'
import type { AdminMcpErrorGroup } from './types.ts'

const MAX_TRACE_IDS = 5

export function collectErrorGroups(
  records: readonly AdminRecord[],
  causeName: (record: AdminRecord, causeId: string) => string,
): AdminMcpErrorGroup[] {
  const groups = new Map<
    string,
    {
      group: AdminMcpErrorGroup
      traces: string[]
      causedBy: Set<string>
    }
  >()
  for (const record of records) {
    const key = errorGroupKey(record)
    if (key === undefined) continue
    const type = recordErrorType(record)
    const message = firstExceptionMessageLine(recordErrorMessage(record))
    const culprit = stackCulprit(recordErrorStack(record))
    let entry = groups.get(key)
    if (!entry) {
      entry = {
        group: {
          key,
          reatomName: recordReatomName(record),
          type,
          message,
          count: 0,
          firstSeen: record.start,
          lastSeen: record.start,
          traceIds: [],
          ...(culprit !== undefined ? { culprit } : {}),
          causedBy: [],
        },
        traces: [],
        causedBy: new Set(),
      }
      groups.set(key, entry)
    }
    entry.group.count += 1
    if (record.start < entry.group.firstSeen) entry.group.firstSeen = record.start
    if (record.start > entry.group.lastSeen) entry.group.lastSeen = record.start
    if (!entry.traces.includes(record.traceId)) entry.traces.push(record.traceId)
    if (entry.group.culprit === undefined && culprit !== undefined) {
      entry.group.culprit = culprit
    }
    for (const causeId of record.causeIds) {
      entry.causedBy.add(causeName(record, causeId))
    }
  }
  return [...groups.values()]
    .map((entry) => ({
      ...entry.group,
      traceIds: entry.traces.slice(0, MAX_TRACE_IDS),
      causedBy: [...entry.causedBy],
    }))
    .sort((left, right) =>
      right.count === left.count
        ? right.lastSeen - left.lastSeen
        : right.count - left.count,
    )
}
