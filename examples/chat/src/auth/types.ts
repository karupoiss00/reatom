export interface KeyMeta {
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
}
export type ValidateResult =
  | { ok: true; meta: KeyMeta }
  | {
      ok: false
      reason:
        'unauthorized' | 'management-key' | 'forbidden' | 'offline' | 'busy'
      status?: number
      retryAfterSec?: number
    }
export type OAuthOutcome =
  | { status: 'idle' }
  | { status: 'redirecting' }
  | { status: 'connecting' }
  | { status: 'connected'; returnTo: string | null }
  | {
      status: 'error'
      reason:
        | 'cancelled'
        | 'state-mismatch'
        | 'expired'
        | 'exchange-failed'
        | 'offline'
        | 'unauthorized'
      code?: number
    }
export type SessionMode = 'booting' | 'connected' | 'welcome' | 'archive'
export type KeyStatus = 'none' | 'loading' | 'ok' | 'unavailable' | 'revoked'
