import {
  ConnectionError,
  InvalidRequestError,
  OpenRouterError,
  RequestAbortedError,
  RequestTimeoutError,
  SDKValidationError,
  UnexpectedClientError,
} from '@openrouter/sdk/models/errors'

import type { ClassifiableFailure, ClassifiableStreamError } from './input'

const headerRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const httpBody = (error: OpenRouterError): unknown => {
  const parsed = parseJson(error.body)
  if (parsed && typeof parsed === 'object') return parsed
  if ('error' in error && error.error) return { error: error.error }
  return error.body
}

const retryAfterSeconds = (raw: string): number | null => {
  const trimmed = raw.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.ceil((at - Date.now()) / 1000))
}

const normalizeRetryAfter = (
  headers: Record<string, string>,
): Record<string, string> => {
  const raw = headers['retry-after']
  if (raw === undefined) return headers
  const seconds = retryAfterSeconds(raw)
  if (seconds === null) return headers
  return { ...headers, 'retry-after': String(seconds) }
}

const isAbort = (error: unknown): boolean => {
  if (error instanceof RequestAbortedError) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.name === 'AbortError'
}

const chunkRecord = (rawChunk: unknown): Record<string, unknown> | null => {
  if (typeof rawChunk === 'string') {
    const parsed = parseJson(rawChunk)
    return asRecord(parsed)
  }
  return asRecord(rawChunk)
}

export const fromStreamErrorChunk = (
  rawChunk: unknown,
  opts: { contentReceived: boolean },
): ClassifiableStreamError | null => {
  const chunk = chunkRecord(rawChunk)
  const error = asRecord(chunk?.error)
  if (!error) return null
  const metadata = { ...(asRecord(error.metadata) ?? {}) }
  const provider =
    chunk && typeof chunk.provider === 'string' ? chunk.provider : null
  if (
    provider &&
    metadata.provider_name == null &&
    metadata.providerName == null
  ) {
    metadata.provider_name = provider
  }
  return {
    source: 'stream-error',
    code: typeof error.code === 'number' ? error.code : null,
    message: typeof error.message === 'string' ? error.message : '',
    metadata,
    contentReceived: opts.contentReceived,
  }
}

export const fromSdkError = (
  error: unknown,
): ClassifiableFailure | 'aborted' => {
  if (isAbort(error)) return 'aborted'
  if (error instanceof RequestTimeoutError) return { source: 'timeout' }
  if (
    error instanceof ConnectionError ||
    error instanceof UnexpectedClientError ||
    error instanceof TypeError
  ) {
    return { source: 'network' }
  }
  if (error instanceof InvalidRequestError) {
    return {
      source: 'http',
      status: 400,
      body: { error: { code: 400, message: error.message } },
      headers: {},
    }
  }
  if (error instanceof OpenRouterError) {
    return {
      source: 'http',
      status: error.statusCode,
      body: httpBody(error),
      headers: normalizeRetryAfter(headerRecord(error.headers)),
    }
  }
  if (error instanceof SDKValidationError) {
    const streamed = fromStreamErrorChunk(error.rawValue, {
      contentReceived: false,
    })
    if (streamed) return streamed
    return { source: 'stream-error', code: null, message: error.message }
  }
  return { source: 'network' }
}
