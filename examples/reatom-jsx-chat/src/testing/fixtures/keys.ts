export type KeyWire = {
  allowed_data_regions: Array<'global' | 'europe' | 'us'>
  byok_usage: number
  byok_usage_daily: number
  byok_usage_monthly: number
  byok_usage_weekly: number
  creator_user_id: string | null
  expires_at: string | null
  free_model_daily_requests: {
    limit: number
    remaining: number
    used: number
  }
  include_byok_in_limit: boolean
  is_free_tier: boolean
  is_management_key: boolean
  is_provisioning_key: boolean
  label: string
  limit: number | null
  limit_remaining: number | null
  limit_reset: string | null
  organization_id: string | null
  rate_limit: {
    interval: string
    note: string
    requests: number
  }
  usage: number
  usage_daily: number
  usage_monthly: number
  usage_weekly: number
  workspace_id: string | null
}

const keyDefaults = {
  allowed_data_regions: ['global'],
  byok_usage: 17.38,
  byok_usage_daily: 0,
  byok_usage_weekly: 0,
  byok_usage_monthly: 17.38,
  creator_user_id: 'user_fixture',
  expires_at: null,
  free_model_daily_requests: { limit: 50, remaining: 50, used: 0 },
  include_byok_in_limit: false,
  is_free_tier: false,
  is_management_key: false,
  is_provisioning_key: false,
  limit: 100,
  limit_remaining: 74.5,
  limit_reset: 'monthly',
  organization_id: null,
  rate_limit: { requests: -1, interval: '1h', note: 'deprecated' },
  usage: 25.5,
  usage_daily: 1.2,
  usage_weekly: 4.4,
  usage_monthly: 25.5,
  workspace_id: null,
} satisfies Omit<KeyWire, 'label'>

const key = (patch: Partial<KeyWire> & Pick<KeyWire, 'label'>): KeyWire => ({
  ...keyDefaults,
  ...patch,
})

export const limitedKey = key({
  label: 'sk-or-v1-au7...890',
})

export const unlimitedKey = key({
  label: 'sk-or-v1-unl...000',
  limit: null,
  limit_remaining: null,
  limit_reset: null,
  usage: 0,
  usage_daily: 0,
  usage_weekly: 0,
  usage_monthly: 0,
})

export const freeTierKey = key({
  label: 'sk-or-v1-free...111',
  is_free_tier: true,
  limit: 0,
  limit_remaining: 0,
  limit_reset: 'daily',
  usage: 0,
  usage_daily: 0,
  usage_weekly: 0,
  usage_monthly: 0,
  byok_usage: 0,
  byok_usage_monthly: 0,
  free_model_daily_requests: { limit: 50, remaining: 12, used: 38 },
})
