import type { LocalValues } from './localValues.ts'
import type { SpanId, TraceId } from './traceContext.ts'
import type { OtlpAnyValue, OtlpAttrValue } from './toOtlpValue.ts'
import { toOtlpAttributes, toOtlpValue } from './toOtlpValue.ts'

export { buildLogsPayload } from './buildExportPayload.ts'
export { selectLogsUnloadBatch } from './selectUnloadBatch.ts'
export { logsUrl } from './tracesUrl.ts'

const SEVERITY_INFO = 9
const SEVERITY_ERROR = 17
const EXCEPTION_EVENT_NAME = 'exception'

const msToNano = (ms: number): string => {
  const truncMs = Math.trunc(ms)
  const fracNs = Math.round((ms - truncMs) * 1_000_000)
  return (BigInt(truncMs) * 1_000_000n + BigInt(fracNs)).toString()
}

export interface LogRecordInput {
  eventName: string
  traceId: TraceId
  spanId: SpanId
  timeMs: number
  body?: OtlpAttrValue
  attributes?: Record<string, OtlpAttrValue>
  /** Stripped here. The factory stores it beside the local record. */
  local?: LocalValues
}

export interface OtlpLogRecord {
  eventName: string
  traceId: TraceId
  spanId: SpanId
  timeUnixNano: string
  severityNumber: number
  body?: OtlpAnyValue
  attributes: ReturnType<typeof toOtlpAttributes>
}

export const buildLogRecord = (input: LogRecordInput): OtlpLogRecord => {
  const record: OtlpLogRecord = {
    eventName: input.eventName,
    traceId: input.traceId,
    spanId: input.spanId,
    timeUnixNano: msToNano(input.timeMs),
    severityNumber:
      input.eventName === EXCEPTION_EVENT_NAME
        ? SEVERITY_ERROR
        : SEVERITY_INFO,
    attributes: [
      {
        key: 'event.name',
        value: { stringValue: input.eventName },
      },
      ...toOtlpAttributes(input.attributes),
    ],
  }
  if (input.body !== undefined) record.body = toOtlpValue(input.body)
  return record
}
