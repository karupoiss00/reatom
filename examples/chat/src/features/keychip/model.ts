import { action, atom, computed } from '@reatom/core'

import {
  acknowledgeUnlimited,
  apiKeyHash,
  forgetKey,
  keyMeta,
  keyStatus,
  refreshKeyMeta,
  revokedDuringStream,
  sessionMode,
  unlimitedAckNeeded,
  type KeyMeta,
} from '../../auth'
import { connect, openChangeKey, openConnect } from '../welcome/model'
import { formatUsd } from '../../money'

export const keyMenuOpen = atom(false, 'keychip.menuOpen')
export const forgetArmed = atom(false, 'keychip.forgetArmed')
export const unlimitedDialogOpen = atom(false, 'keychip.unlimitedDialogOpen')

export const addCreditsUrl = 'https://openrouter.ai/credits'
export const byokSettingsUrl = 'https://openrouter.ai/settings/integrations'

const fallbackKeyPageUrl = 'https://openrouter.ai/settings/keys'

export const keyPageUrl = computed(() => {
  const hash = apiKeyHash.data()
  if (!hash) return fallbackKeyPageUrl
  return `https://openrouter.ai/keys/${hash}`
}, 'keychip.keyPageUrl')

const money = (amount: number | null): string =>
  amount === null || !Number.isFinite(amount) ? '\u2014' : formatUsd(amount)

const resetPhrase = (period: string | null): string | null =>
  period ? `resets ${period}` : null

export type KeyFacts = {
  label: string
  limit: string
  remaining: string
  reset: string | null
  usageDaily: string
  usageWeekly: string
  usageMonthly: string
  byokUsageMonthly: string
  freeTier: boolean
  unlimited: boolean
}

const factsFrom = (meta: KeyMeta): KeyFacts => {
  const unlimited = meta.limit === null
  return {
    label: meta.label,
    limit: unlimited ? 'No limit' : money(meta.limit),
    remaining: unlimited ? 'No limit' : money(meta.limitRemaining),
    reset: resetPhrase(meta.limitReset),
    usageDaily: money(meta.usageDaily),
    usageWeekly: money(meta.usageWeekly),
    usageMonthly: money(meta.usageMonthly),
    byokUsageMonthly: money(meta.byokUsageMonthly),
    freeTier: meta.isFreeTier,
    unlimited,
  }
}

export const keyFacts = computed((): KeyFacts | null => {
  const meta = keyMeta.data()
  if (!meta) return null
  return factsFrom(meta)
}, 'keychip.keyFacts')

export type ChipState =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'capped'; label: string; low: boolean }
  | { kind: 'unlimited'; acknowledged: boolean }

export const chipState = computed((): ChipState => {
  if (revokedDuringStream()) return { kind: 'hidden' }
  const status = keyStatus()
  if (status === 'none' || status === 'revoked') return { kind: 'hidden' }
  if (status === 'loading') return { kind: 'loading' }
  if (status === 'unavailable') return { kind: 'unavailable' }
  const meta = keyMeta.data()
  if (!meta) return { kind: 'loading' }
  if (meta.limit === null) {
    return { kind: 'unlimited', acknowledged: !unlimitedAckNeeded() }
  }
  const remaining = meta.limitRemaining
  const low = remaining !== null && remaining < 1
  const amount = remaining === null ? '\u2014' : formatUsd(remaining)
  return { kind: 'capped', label: `${amount} left`, low }
}, 'keychip.chipState')

export const bannerMode = computed((): 'stream' | 'revoked' | 'none' => {
  if (revokedDuringStream()) return 'stream'
  if (keyStatus() === 'revoked') return 'revoked'
  return 'none'
}, 'keychip.bannerMode')

export const retryLimit = action(() => {
  refreshKeyMeta({ force: true })
}, 'keychip.retryLimit')

export const armForget = action(() => {
  forgetArmed.set(true)
}, 'keychip.armForget')

export const keepKey = action(() => {
  forgetArmed.set(false)
}, 'keychip.keepKey')

export const confirmForget = action(() => {
  forgetArmed.set(false)
  keyMenuOpen.set(false)
  forgetKey()
}, 'keychip.confirmForget')

export const changeKeyFromMenu = action(() => {
  forgetArmed.set(false)
  keyMenuOpen.set(false)
  openChangeKey()
}, 'keychip.changeKeyFromMenu')

export const reconnect = action(() => {
  if (sessionMode() === 'welcome') {
    void connect()
    return
  }
  openConnect()
}, 'keychip.reconnect')

export const understandUnlimited = action(() => {
  void acknowledgeUnlimited()
}, 'keychip.understandUnlimited')
