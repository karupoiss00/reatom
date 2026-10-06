import { OpenRouter } from '@openrouter/sdk'
import {
  ConnectionError,
  OpenRouterError as OpenRouterHttpError,
  RequestAbortedError,
  RequestTimeoutError,
  UnexpectedClientError,
} from '@openrouter/sdk/models/errors'
import { action, isAbort, withAsync, wrap } from '@reatom/core'

import { openRouterServerURL } from '../api/client'
import { now } from '../platform/env'
import { placeKey } from './keyStore'
import type { KeyMeta, ValidateResult } from './types'

const clientFor = (key: string) =>
  new OpenRouter({
    apiKey: key,
    serverURL: openRouterServerURL,
    retryConfig: { strategy: 'none' },
  })

export const isRequestAbort = (error: unknown): boolean => {
  if (isAbort(error)) return true
  if (error instanceof RequestAbortedError) return true
  return error instanceof DOMException && error.name === 'AbortError'
}

const retryAfterSeconds = (headers: Headers): number | undefined => {
  const raw = headers.get('retry-after')?.trim()
  if (!raw) return undefined
  if (/^\d+$/.test(raw)) return Number(raw)
  const at = Date.parse(raw)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, Math.ceil((at - now()) / 1000))
}

const managementKeyBody = (body: string): boolean => {
  try {
    const parsed = JSON.parse(body) as {
      data?: { is_management_key?: boolean; isManagementKey?: boolean }
    }
    return (
      parsed.data?.is_management_key === true ||
      parsed.data?.isManagementKey === true
    )
  } catch {
    return false
  }
}

const busyResult = (status: number, headers: Headers): ValidateResult => {
  const retryAfterSec = retryAfterSeconds(headers)
  return retryAfterSec === undefined
    ? { ok: false, reason: 'busy', status }
    : { ok: false, reason: 'busy', status, retryAfterSec }
}

const knownLimit = (limit: number | null): number | null => {
  if (limit === null) return null
  if (typeof limit === 'number' && Number.isFinite(limit)) return limit
  throw new Error('Unknown key limit')
}

export const toKeyMeta = (data: {
  label: string
  limit: number | null
  limitRemaining: number | null
  limitReset: string | null
  usageDaily: number
  usageWeekly: number
  usageMonthly: number
  byokUsageMonthly: number
  isFreeTier: boolean
  isManagementKey: boolean
}): KeyMeta => ({
  label: data.label,
  limit: knownLimit(data.limit),
  limitRemaining: data.limitRemaining,
  limitReset: data.limitReset,
  usageDaily: data.usageDaily,
  usageWeekly: data.usageWeekly,
  usageMonthly: data.usageMonthly,
  byokUsageMonthly: data.byokUsageMonthly,
  isFreeTier: data.isFreeTier,
  isManagementKey: data.isManagementKey,
})

export const readKeyMeta = async (
  key: string,
  signal?: AbortSignal,
): Promise<KeyMeta> => {
  const response = await clientFor(key).apiKeys.getCurrentKeyMetadata(
    {},
    signal ? { signal } : undefined,
  )
  return toKeyMeta(response.data)
}

const offlineResult = (): ValidateResult => ({ ok: false, reason: 'offline' })

export const classifyKeyError = (error: unknown): ValidateResult => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return offlineResult()
  }
  if (error instanceof OpenRouterHttpError) {
    if (managementKeyBody(error.body)) {
      return { ok: false, reason: 'management-key', status: error.statusCode }
    }
    if (error.statusCode === 401) {
      return { ok: false, reason: 'unauthorized', status: 401 }
    }
    if (error.statusCode === 403) {
      return { ok: false, reason: 'forbidden', status: 403 }
    }
    if (
      error.statusCode === 408 ||
      error.statusCode === 429 ||
      error.statusCode >= 500
    ) {
      return busyResult(error.statusCode, error.headers)
    }
    return { ok: false, reason: 'forbidden', status: error.statusCode }
  }
  if (
    error instanceof TypeError ||
    error instanceof ConnectionError ||
    error instanceof UnexpectedClientError ||
    error instanceof RequestTimeoutError
  ) {
    return offlineResult()
  }
  return offlineResult()
}

export const validateKey = async (
  key: string,
  signal?: AbortSignal,
): Promise<ValidateResult> => {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, reason: 'unauthorized' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return offlineResult()
  }
  try {
    const meta = await readKeyMeta(trimmed, signal)
    if (meta.isManagementKey) return { ok: false, reason: 'management-key' }
    return { ok: true, meta }
  } catch (error) {
    if (isRequestAbort(error)) throw error
    return classifyKeyError(error)
  }
}

export const connectWithKey = action(
  async (key: string, opts: { remember: boolean }): Promise<ValidateResult> => {
    const result = await wrap(validateKey(key))
    if (!result.ok) return result
    placeKey(key.trim(), opts.remember)
    return result
  },
  'auth.connectWithKey',
).extend(withAsync())
