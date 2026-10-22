import type { AdminRecord } from '../otlp/ingest'
import type { GanttOptions } from './reatomGantt'

/** Height of a Gantt row in CSS pixels, shared by the model and the chart. */
export const ADMIN_GANTT_ROW_HEIGHT = 42

/** Rows rendered beyond each edge of the Gantt viewport. */
export const ADMIN_GANTT_OVERSCAN = 6

export const adminRecordSpanKey = (
  record: Pick<AdminRecord, 'sourceId' | 'traceId' | 'spanId'>,
) => `${record.sourceId}:${record.traceId}:${record.spanId}`

const spanKey = (record: AdminRecord, spanId: string) =>
  adminRecordSpanKey({
    sourceId: record.sourceId,
    traceId: record.traceId,
    spanId,
  })

/**
 * Timing accessors for `reatomGantt` over `AdminRecord`s. A span row is keyed
 * by source, trace and span id; its parent is the span with `parentSpanId`. A
 * log record is a child row of the span it was emitted in and never a parent.
 *
 * @example
 *   const gantt = reatomGantt(
 *     admin.visibleRecords,
 *     adminRecordTiming,
 *     '_Admin.otlp.gantt',
 *   )
 */
export const adminRecordTiming: GanttOptions<AdminRecord> = {
  start: (record) => record.start,
  end: (record) => record.end,
  id: (record) =>
    record.kind === 'span' ? spanKey(record, record.spanId) : undefined,
  parentId: (record) => {
    if (record.kind === 'log') return spanKey(record, record.spanId)
    return record.parentSpanId === undefined
      ? undefined
      : spanKey(record, record.parentSpanId)
  },
}
