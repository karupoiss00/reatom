import type { OtlpAttrValue } from './toOtlpValue.ts'

/** Complete operation/update identity. Empty dictionaries are captured values. */
export interface ObservationSnapshot {
  attributes: Record<string, OtlpAttrValue>
  metadata: Record<string, OtlpAttrValue>
  resourceAttributes?: Record<string, OtlpAttrValue>
  root?: object
}
