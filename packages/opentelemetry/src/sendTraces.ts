import { markTelemetryUrl } from './browserCapture.ts'
import { suppressTracing } from './observation.ts'
import { readExportResponse } from './parseExportResponse.ts'
import { signalUrl, type OtlpHttpSignal } from './tracesUrl.ts'

export interface SendTracesInput {
  endpoint: string
  payload: unknown
  /** Already serialized owned payload, including the measured unload envelope. */
  body?: string
  /**
   * Auth and tenancy headers attached to every OTLP fetch. The OTLP wire
   * `Content-Type` is fixed to `application/json` and any user-supplied
   * `content-type` (any case) is dropped to keep the protocol intact.
   */
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
  /**
   * Set on unload-triggered fetches so the browser holds the connection past
   * page teardown. The browser shares a limited in-flight byte budget across
   * keepalive requests. Off by default for ordinary batches.
   */
  keepalive?: boolean
  /** Aborts the in-flight fetch — used by `dispose()` to tear down cleanly. */
  signal?: AbortSignal
}

export interface SendSignalInput extends SendTracesInput {
  otlpSignal?: OtlpHttpSignal
}

// fetch normalizes header casing per-runtime: if both
// `Content-Type: application/json` and `content-type: application/x-protobuf`
// reach it the result is undefined and can mangle the OTLP wire. Drop any
// user-supplied content-type (any case) so our spec-mandated value wins.
const buildHeaders = (
  userHeaders: Record<string, string> | undefined,
): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (userHeaders) {
    for (const [key, value] of Object.entries(userHeaders)) {
      if (key.toLowerCase() === 'content-type') continue
      headers[key] = value
    }
  }
  return headers
}

const postOtlp = async (
  url: string,
  input: SendTracesInput,
): Promise<Response> => {
  const fetchImpl = input.fetch ?? globalThis.fetch
  const init: RequestInit = {
    method: 'POST',
    headers: buildHeaders(input.headers),
    body: input.body ?? JSON.stringify(input.payload),
    keepalive: input.keepalive,
    signal: input.signal,
  }
  input.signal?.throwIfAborted()
  markTelemetryUrl(url)
  return suppressTracing(() => fetchImpl(url, init))
}

/**
 * POSTs an OTLP/JSON payload to `${endpoint}/v1/${otlpSignal}`.
 *
 * Caller-supplied `headers` are attached for auth/tenancy. `Content-Type` is
 * locked to `application/json` per spec; user-supplied content-type headers are
 * dropped. `fetch` is injectable for retry wrapping and tests.
 *
 * https://opentelemetry.io/docs/specs/otlp/#otlphttp-request
 */
export const sendSignal = async (input: SendSignalInput): Promise<Response> =>
  postOtlp(signalUrl(input.endpoint, input.otlpSignal ?? 'traces'), input)

/** POSTs an OTLP/JSON trace payload to `${endpoint}/v1/traces`. */
export const sendTraces = async (input: SendTracesInput): Promise<Response> =>
  sendSignal({ ...input, otlpSignal: 'traces' })

export interface TransportBatch {
  signal: OtlpHttpSignal
  payload: unknown
  body?: string
  keepalive: boolean
  abort: AbortSignal
  itemCount: number
  deadline?: number
}

export interface TransportResult {
  accepted: number
  rejected: number
  errorMessage?: string
}

export type Transport = (batch: TransportBatch) => Promise<TransportResult>

/**
 * One OTLP/HTTP destination. `endpoint` + `headers` on the instance desugar to
 * `transports: [otlpTransport({ endpoint, headers })]`.
 */
export const otlpTransport = (input: {
  endpoint: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}): Transport => {
  return async (batch) => {
    const response = await sendSignal({
      endpoint: input.endpoint,
      otlpSignal: batch.signal,
      payload: batch.payload,
      body: batch.body,
      headers: input.headers,
      fetch: input.fetch,
      signal: batch.abort,
      keepalive: batch.keepalive,
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    const outcome = await readExportResponse(response, batch.itemCount)
    return {
      accepted: outcome.accepted,
      rejected: outcome.rejected,
      ...(outcome.errorMessage === undefined
        ? {}
        : { errorMessage: outcome.errorMessage }),
    }
  }
}
