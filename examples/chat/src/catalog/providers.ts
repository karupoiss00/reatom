import {
  abortVar,
  computed,
  isAbort,
  throwAbort,
  withAsyncData,
  wrap,
} from '@reatom/core'

import { openRouterPublic } from '../api/openrouter'
import type { ProviderInfo } from './types'

const loadProviders = async (signal: AbortSignal): Promise<ProviderInfo[]> => {
  const page = await openRouterPublic().providers.list(
    {},
    { signal, retries: { strategy: 'none' } },
  )
  const seen = new Set<string>()
  const list: ProviderInfo[] = []
  for (const provider of page.data) {
    const slug = provider.slug.trim()
    const name = provider.name.trim()
    if (!slug || !name || seen.has(slug)) continue
    seen.add(slug)
    list.push({ slug, name })
  }
  return list
}

export const providers = computed(async (): Promise<ProviderInfo[]> => {
  const signal = abortVar.require().signal
  try {
    return await wrap(loadProviders(signal))
  } catch (error) {
    if (isAbort(error) || signal.aborted) throwAbort('catalog.providers')
    throw error
  }
}, 'catalog.providers').extend(withAsyncData({ initState: [] }))
