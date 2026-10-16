import { hexFromBytes } from './hexFromBytes.ts'

type Brand<T, B extends string> = T & { readonly __brand: B }

export type SpanId = Brand<string, 'SpanId'>
export type TraceId = Brand<string, 'TraceId'>

export type SpanContext = Readonly<{ traceId: TraceId; spanId: SpanId }>

const newTraceId = (): TraceId =>
  hexFromBytes(crypto.getRandomValues(new Uint8Array(16))) as TraceId

const newSpanId = (): SpanId =>
  hexFromBytes(crypto.getRandomValues(new Uint8Array(8))) as SpanId

export const createChildContext = (
  parent?: { traceId: string; spanId: string } | SpanContext,
): SpanContext =>
  Object.freeze({
    traceId: parent ? (parent.traceId as TraceId) : newTraceId(),
    spanId: newSpanId(),
  })
