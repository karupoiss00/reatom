import { browserCaptureOf } from '../browserCapture.ts'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import type { OtlpAttrValue } from '../toOtlpValue.ts'

export interface BrowserPerformanceOptions {
  /** Observe document navigation timings (default true). */
  navigation?: boolean
  /**
   * Observe resource timings (default true); distinct from network request
   * spans.
   */
  resources?: boolean
  /**
   * Skip URLs, including opaque async custom transport destinations. Receives
   * the full URL before sanitization.
   */
  ignoreUrl?: (url: URL) => boolean
}

const safeUrl = (
  name: string,
  ignoreUrl?: BrowserPerformanceOptions['ignoreUrl'],
): string | undefined => {
  // Bound input before parsing as well as serialized output.
  if (name.length > 8192) return
  try {
    const url = new URL(name)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    // Give user code a clone: mutations cannot alter the exported safe URL.
    // A throwing predicate fails closed for this entry only.
    if (ignoreUrl?.(new URL(url.href))) return
    return `${url.origin}${url.pathname}`.slice(0, 2048)
  } catch {
    return
  }
}

/**
 * Native timing measurements, without request spans, replay, or DOM
 * observation.
 */
export const connectBrowserPerformance = (
  otel: ReatomOpentelemetry,
  options: BrowserPerformanceOptions = {},
): { dispose(): void } => {
  const capture = browserCaptureOf(otel)
  if (
    !capture ||
    typeof window === 'undefined' ||
    typeof PerformanceObserver === 'undefined'
  )
    return { dispose() {} }
  const documentSnapshot = capture.snapshot()
  const observers: PerformanceObserver[] = []
  let active = true
  const dispose = capture.attach(() => {
    active = false
    observers.forEach((observer) => observer.disconnect())
    observers.length = 0
  }, 'browser-performance')
  if (!active) return { dispose }
  for (const type of ['navigation', 'resource'] as const) {
    if (
      (type === 'navigation' ? options.navigation : options.resources) ===
        false ||
      !PerformanceObserver.supportedEntryTypes?.includes(type)
    )
      continue
    try {
      const observer = new PerformanceObserver((list) => {
        if (!active || !capture.enabled('logs')) return
        const snapshot =
          type === 'navigation' ? documentSnapshot : capture.snapshot()
        if (!active) return
        // Cap a delivered batch so late buffered observation cannot flood the queue.
        for (const entry of list.getEntries().slice(0, 100)) {
          if (entry.entryType !== type || capture.isTransportUrl(entry.name))
            continue
          const url = safeUrl(entry.name, options.ignoreUrl)
          if (!active) return
          if (!url) continue
          const timing = entry as PerformanceResourceTiming
          const values: Record<string, number> = {}
          const add = (name: string, value: number) => {
            if (Number.isFinite(value) && value >= 0) values[name] = value
          }
          add('duration', timing.duration)
          add('dns', timing.domainLookupEnd - timing.domainLookupStart)
          add('connect', timing.connectEnd - timing.connectStart)
          add('request', timing.responseStart - timing.requestStart)
          add('response', timing.responseEnd - timing.responseStart)
          add('transfer_size', timing.transferSize)
          add('encoded_body_size', timing.encodedBodySize)
          add('decoded_body_size', timing.decodedBodySize)
          const attributes: Record<string, OtlpAttrValue> = {
            'measurement.type': `browser-${type}`,
            'measurement.values': values,
            'url.full': url,
            'performance.entry_type': type,
          }
          if (type === 'resource')
            attributes['performance.initiator_type'] =
              timing.initiatorType.slice(0, 64)
          else {
            const navigation = entry as PerformanceNavigationTiming
            if (navigation.domInteractive > 0)
              add('dom_interactive', navigation.domInteractive)
            if (navigation.domContentLoadedEventEnd > 0)
              add('dom_content_loaded', navigation.domContentLoadedEventEnd)
            if (navigation.loadEventEnd > 0)
              add('load', navigation.loadEventEnd)
            attributes['performance.navigation_type'] = navigation.type
          }
          attributes['measurement.units'] = Object.fromEntries(
            Object.keys(values).map((key) => [
              key,
              key.endsWith('size') ? 'By' : 'ms',
            ]),
          )
          if (!Object.keys(values).length || !Number.isFinite(entry.startTime))
            continue
          if (!active) return
          capture.log({
            eventName: 'measurement',
            timeMs: performance.timeOrigin + entry.startTime,
            attributes,
            snapshot,
          })
        }
      })
      observers.push(observer)
      observer.observe({ type, buffered: true })
    } catch {
      /* Older engines can advertise an unsupported entry type. */
    }
  }
  return { dispose }
}
