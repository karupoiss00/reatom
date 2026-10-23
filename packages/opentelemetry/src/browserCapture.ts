/** Private bridge shared by opt-in browser connectors. Never exported by root. */
import type { ReatomOpentelemetry } from './reatomOpentelemetry.ts'
import type { SpanContext } from './traceContext.ts'
import type { OtlpAttrValue } from './toOtlpValue.ts'
import type { SpanKind } from './buildSpan.ts'
export type CaptureSnapshot = {
  context: SpanContext
  attributes: Record<string, OtlpAttrValue>
}
export type BrowserCapture = {
  attach(cleanup: () => void, key?: string): () => void
  isTransportUrl(url: string): boolean
  enabled(signal: 'logs' | 'traces'): boolean
  capture(key: string, value: unknown): OtlpAttrValue | undefined
  snapshot(): CaptureSnapshot
  log(input: {
    eventName: string
    timeMs: number
    body?: OtlpAttrValue
    attributes?: Record<string, OtlpAttrValue>
    severityNumber?: number
    snapshot?: CaptureSnapshot
  }): void
  span(input: {
    name: string
    startTimeMs: number
    attributes?: Record<string, OtlpAttrValue>
    snapshot?: CaptureSnapshot
    kind?: SpanKind
  }):
    | {
        context: SpanContext
        traceparent: string
        cancel(): void
        finish(input: {
          endTimeMs: number
          name?: string
          attributes?: Record<string, OtlpAttrValue>
          error?: boolean
        }): void
      }
    | undefined
}
const captures = new WeakMap<ReatomOpentelemetry, BrowserCapture>()
const metadata = new WeakMap<
  ReatomOpentelemetry,
  () => Record<string, OtlpAttrValue>
>()
export const browserCaptureOf = (otel: ReatomOpentelemetry) =>
  captures.get(otel)
export const installBrowserCapture = (
  otel: ReatomOpentelemetry,
  capture: BrowserCapture,
) => captures.set(otel, capture)
export const setBrowserMetadata = (
  otel: ReatomOpentelemetry,
  read: () => Record<string, OtlpAttrValue>,
) => {
  metadata.set(otel, read)
  return () => {
    if (metadata.get(otel) === read) metadata.delete(otel)
  }
}
export const browserMetadataOf = (
  otel: ReatomOpentelemetry,
): Record<string, OtlpAttrValue> => {
  try {
    return metadata.get(otel)?.() ?? {}
  } catch {
    return {}
  }
}

const telemetryKey = Symbol.for('@reatom/opentelemetry/transport-urls')
const telemetryHost = globalThis as typeof globalThis & {
  [telemetryKey]?: Set<string>
}
const telemetryUrls = (telemetryHost[telemetryKey] ??= new Set<string>())
const urlKey = (url: string) => {
  try {
    const parsed = new URL(
      url,
      typeof location === 'undefined' ? undefined : location.href,
    )
    return parsed.origin + parsed.pathname
  } catch {
    return url
  }
}
export const markTelemetryUrl = (url: string) => {
  if (telemetryUrls.size > 256) telemetryUrls.clear()
  telemetryUrls.add(urlKey(url))
}
export const isTelemetryUrl = (url: string) => telemetryUrls.has(urlKey(url))
