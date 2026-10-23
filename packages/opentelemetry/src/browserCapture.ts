import { bind } from '@reatom/core'
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
  preflightConsent(): void
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
  Set<() => Record<string, OtlpAttrValue>>
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
  const readers = metadata.get(otel) ?? new Set()
  readers.add(read)
  metadata.set(otel, readers)
  return () => {
    readers.delete(read)
    if (!readers.size) metadata.delete(otel)
  }
}
export const browserMetadataOf = (
  otel: ReatomOpentelemetry,
): Record<string, OtlpAttrValue> => {
  try {
    const readers = metadata.get(otel)
    const read = readers && [...readers].at(-1)
    return read?.() ?? {}
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

const consentReaders = new WeakMap<
  ReatomOpentelemetry,
  () => Record<string, boolean> | undefined
>()
export const effectiveConsentOf = (
  otel: ReatomOpentelemetry,
): Record<string, boolean> | undefined => {
  const read = consentReaders.get(otel)
  if (!read) return otel().consent
  try {
    return read()
  } catch {
    return { diagnostics: false, analytics: false }
  }
}
export const preflightConsent = (otel: ReatomOpentelemetry): void => {
  const capture = browserCaptureOf(otel)
  if (!capture)
    throw new Error(
      '[@reatom/opentelemetry] consent requires an initialized telemetry atom',
    )
  capture.preflightConsent()
  if (consentReaders.has(otel))
    throw new Error('[@reatom/opentelemetry] consent is already bound')
}
export const bindConsent = (
  otel: ReatomOpentelemetry,
  read: () => Record<string, boolean> | undefined,
  subscribe?: (notify: () => void) => () => void,
): (() => void) => {
  preflightConsent(otel)
  const bound = bind(read)
  consentReaders.set(otel, bound)
  const notify = bind(() => {
    const consent = effectiveConsentOf(otel)
    otel.set((current) => ({ ...current, consent }))
  })
  let stop: (() => void) | undefined
  let active = true
  const cleanup = () => {
    if (!active) return
    active = false
    stop?.()
    if (consentReaders.get(otel) === bound) consentReaders.delete(otel)
  }
  try {
    notify()
    stop = subscribe?.(notify)
  } catch (error) {
    cleanup()
    throw error
  }
  const detach = browserCaptureOf(otel)!.attach(cleanup)
  return () => {
    cleanup()
    detach()
  }
}

export const hasBoundConsent = (otel: ReatomOpentelemetry) =>
  consentReaders.has(otel)
