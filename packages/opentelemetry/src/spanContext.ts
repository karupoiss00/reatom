import { hexFromBytes } from './hexFromBytes.ts'

type Brand<T, B extends string> = T & { readonly __brand: B }

export type SpanId = Brand<string, 'SpanId'>
export type TraceId = Brand<string, 'TraceId'>

// OTLP deviates from protobuf JSON here: trace and span ids are hex, not base64.
// https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding
const traceId = (): TraceId =>
  hexFromBytes(crypto.getRandomValues(new Uint8Array(16))) as TraceId

const spanId = (): SpanId =>
  hexFromBytes(crypto.getRandomValues(new Uint8Array(8))) as SpanId

export type SpanContext = Readonly<{ traceId: TraceId; spanId: SpanId }>
export const ROOT_BOUNDARY = Symbol('OTel root boundary')
export type ContextSlot = SpanContext | typeof ROOT_BOUNDARY

export const createChildContext = (parent?: ContextSlot): SpanContext =>
  Object.freeze({
    traceId: parent && parent !== ROOT_BOUNDARY ? parent.traceId : traceId(),
    spanId: spanId(),
  })

export const createSpanContext = () => {
  let value: ContextSlot | undefined
  let disposed = false
  return {
    read: () => value,
    dispose: () => {
      disposed = true
      value = undefined
    },
    write: (next: ContextSlot) => {
      if (!disposed) value = next
    },
    save: () => {
      const saved = value
      return () => {
        if (!disposed) value = saved
      }
    },
    current: (): SpanContext | undefined =>
      value === ROOT_BOUNDARY ? undefined : value,
  }
}
