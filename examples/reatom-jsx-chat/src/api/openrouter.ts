import { OpenRouter } from '@openrouter/sdk'

import { apiKey } from '../auth/keyStore'
import { openRouterServerURL } from './client'

const noRetries = { strategy: 'none' } as const

export class MissingApiKeyError extends Error {
  constructor() {
    super('OpenRouter API key is not connected')
    this.name = 'MissingApiKeyError'
  }
}

const readConnectedKey = async () => {
  const key = apiKey()
  if (!key) throw new MissingApiKeyError()
  return key
}

let authenticatedClient: OpenRouter | null = null
let publicClient: OpenRouter | null = null

/**
 * Sends `Authorization: Bearer <key>`; rejects before sending when no key is
 * connected.
 */
export const openRouter = (): OpenRouter => {
  authenticatedClient ??= new OpenRouter({
    apiKey: readConnectedKey,
    serverURL: openRouterServerURL,
    retryConfig: noRetries,
  })
  return authenticatedClient
}

/**
 * For public endpoints (`GET /models`, `/providers`); never sends
 * `Authorization`.
 */
export const openRouterPublic = (): OpenRouter => {
  publicClient ??= new OpenRouter({
    serverURL: openRouterServerURL,
    retryConfig: noRetries,
  })
  return publicClient
}
