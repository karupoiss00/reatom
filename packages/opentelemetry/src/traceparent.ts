const TRACEPARENT =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ZERO_TRACE_ID = '0'.repeat(32)
const ZERO_SPAN_ID = '0'.repeat(16)
const SAMPLED_FLAG = 0x01

export type ParsedTraceparent = {
  traceId: string
  spanId: string
  sampled: boolean
}

export const isSampledFlags = (flags: string): boolean =>
  (Number.parseInt(flags, 16) & SAMPLED_FLAG) === SAMPLED_FLAG

export const parseTraceparent = (
  header: string | null | undefined,
): ParsedTraceparent | undefined => {
  if (typeof header !== 'string') return
  const match = TRACEPARENT.exec(header.trim())
  if (!match) return
  const version = match[1]!
  const traceId = match[2]!
  const spanId = match[3]!
  const flags = match[4]!
  if (version !== '00') return
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) return
  return {
    traceId,
    spanId,
    sampled: isSampledFlags(flags),
  }
}

export const formatTraceparent = (
  context: { traceId: string; spanId: string },
  sampled: boolean,
): string => `00-${context.traceId}-${context.spanId}-${sampled ? '01' : '00'}`
