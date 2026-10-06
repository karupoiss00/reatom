import { type HTTPClient, OpenRouter } from '@openrouter/sdk'
import type { Atom } from '@reatom/core'

export const openRouterServerURL = 'https://openrouter.ai/api/v1'

export type OpenRouterClientOptions = { httpClient?: HTTPClient }

export const createOpenRouterClient = (
  apiKey: Atom<string>,
  options: OpenRouterClientOptions = {},
): OpenRouter =>
  new OpenRouter({
    apiKey: async () => apiKey(),
    serverURL: openRouterServerURL,
    retryConfig: { strategy: 'none' },
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  })
