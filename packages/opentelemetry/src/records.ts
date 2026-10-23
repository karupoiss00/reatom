import type { DropReason } from './createBatchQueue.ts'
import type { SpanKind, StatusCode } from './buildSpan.ts'
import type { SpanId, TraceId } from './traceContext.ts'
import type { OtlpAttrValue } from './toOtlpValue.ts'

export type CapturedAttributes = Readonly<Record<string, OtlpAttrValue>>
export interface CapturedLink {
  readonly traceId: string
  readonly spanId: string
  readonly attributes?: CapturedAttributes
}
export interface CapturedValues {
  readonly params?: OtlpAttrValue
  readonly payload?: OtlpAttrValue
  readonly exceptionMessage?: OtlpAttrValue
}
interface CapturedBase {
  /** Owned automatic values; only the optional exporter formats their wire text. */
  readonly values?: CapturedValues
  readonly traceId: TraceId
  readonly spanId: SpanId
  readonly attributes: CapturedAttributes
  readonly resourceAttributes: CapturedAttributes
  readonly scope: { readonly name: string; readonly version: string }
}
export interface CapturedSpan extends CapturedBase {
  readonly type: 'span'
  readonly parentSpanId?: SpanId
  readonly name: string
  readonly kind: SpanKind
  readonly startTimeMs: number
  readonly endTimeMs: number
  readonly flags: number
  readonly status?: { readonly code: StatusCode; readonly message?: string }
  readonly events: readonly {
    readonly name: string
    readonly timeMs: number
    readonly attributes?: CapturedAttributes
  }[]
  readonly links?: readonly CapturedLink[]
}
export interface CapturedLog extends CapturedBase {
  readonly type: 'log'
  readonly eventName: string
  readonly timeMs: number
  readonly severityNumber: number
  readonly body?: OtlpAttrValue
}
export type CapturedRecord = CapturedSpan | CapturedLog
export interface CaptureStats {
  readonly active: number
  readonly captured: number
  readonly retained: number
  readonly dropped: number
  readonly droppedByReason: Readonly<
    Partial<Record<DropReason | 'rateLimit', number>>
  >
  readonly invalidParent: number
}
