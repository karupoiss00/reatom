import { OpenRouter } from '@openrouter/sdk'
import { OpenRouterError } from '@openrouter/sdk/models/errors'
import {
  abortVar,
  action,
  atom,
  isAbort,
  withAbort,
  withAsync,
  wrap,
} from '@reatom/core'

import { openRouter } from '../api/openrouter'
import { openRouterServerURL } from '../api/client'
import { navigateExternal } from '../platform/external'
import { onRuntimeReset } from '../platform/runtime'
import { sha256Hex } from '../platform/crypto'
import { rememberUnlimitedHash } from './ack'
import { placeKey } from './keyStore'
import {
  clearPendingOAuth,
  readPendingOAuth,
  sameOriginReturnTo,
  writePendingOAuth,
} from './pkce'
import type { OAuthOutcome, ValidateResult } from './types'
import { isRequestAbort, validateKey } from './validate'

const exchangeClient = new OpenRouter({
  apiKey: '',
  serverURL: openRouterServerURL,
  retryConfig: { strategy: 'none' },
})

const callbackParamNames = ['code', 'state', 'error'] as const

const oauthCallbackUrl = () => {
  const base = import.meta.env.BASE_URL
  if (base === '/' || base === '') return location.origin
  return new URL(base, location.origin).href.replace(/\/$/, '')
}

let stashedCallbackUrl: URL | null = null

const stripCallbackParams = (url: URL) => {
  for (const name of callbackParamNames) url.searchParams.delete(name)
  history.replaceState(
    history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  )
}

export const captureOAuthCallback = (): void => {
  const current = new URL(location.href)
  if (!current.searchParams.has('code') || !current.searchParams.has('state')) {
    return
  }
  if (!stashedCallbackUrl) stashedCallbackUrl = new URL(current.href)
  stripCallbackParams(current)
}

export const takeOAuthCallbackUrl = (): URL | null => {
  const url = stashedCallbackUrl
  stashedCallbackUrl = null
  return url
}

const clearStashedOAuthCallback = () => {
  stashedCallbackUrl = null
  onRuntimeReset(clearStashedOAuthCallback)
}

onRuntimeReset(clearStashedOAuthCallback)

export const oauthOutcome = atom<OAuthOutcome>(
  { status: 'idle' },
  'auth.oauthOutcome',
)

const positiveLimit = (limit: number | null): number | undefined =>
  typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? limit
    : undefined

const oauthState = () => crypto.randomUUID()

export const startOAuth = action(
  async (opts: {
    limit: number | null
    remember: boolean
    returnTo: string | null
  }): Promise<void> => {
    if (opts.limit !== null && positiveLimit(opts.limit) === undefined) {
      oauthOutcome.set({ status: 'idle' })
      return
    }
    if (navigator.onLine === false) {
      oauthOutcome.set({ status: 'error', reason: 'offline' })
      return
    }
    oauthOutcome.set({ status: 'redirecting' })
    const challenge = await wrap(openRouter().oAuth.createSHA256CodeChallenge())
    const state = oauthState()
    const limit = positiveLimit(opts.limit)
    writePendingOAuth({
      verifier: challenge.codeVerifier,
      state,
      remember: opts.remember,
      returnTo: sameOriginReturnTo(opts.returnTo),
      unlimitedAck: opts.limit === null,
    })
    const url = await wrap(
      openRouter().oAuth.createAuthorizationUrl({
        callbackUrl: oauthCallbackUrl(),
        codeChallenge: challenge.codeChallenge,
        codeChallengeMethod: 'S256',
        ...(limit === undefined ? {} : { limit }),
      }),
    )
    const authUrl = new URL(url)
    authUrl.searchParams.set('state', state)
    navigateExternal(authUrl.toString())
  },
  'auth.startOAuth',
).extend(withAsync(), withAbort('first-in-win'))

export const hasOAuthCallback = (url: URL) =>
  callbackParamNames.some((name) => url.searchParams.has(name))

const replaceCallback = (url: URL) => {
  if (!hasOAuthCallback(url) || url.origin !== location.origin) return
  const next = new URL(url.href)
  for (const name of callbackParamNames) next.searchParams.delete(name)
  history.replaceState(
    history.state,
    '',
    `${next.pathname}${next.search}${next.hash}`,
  )
}

const settle = (outcome: OAuthOutcome): OAuthOutcome => {
  oauthOutcome.set(outcome)
  return outcome
}

const exchangeOutcome = (error: unknown): OAuthOutcome => {
  if (navigator.onLine === false) return { status: 'error', reason: 'offline' }
  if (error instanceof OpenRouterError) {
    if (error.statusCode === 403) {
      return { status: 'error', reason: 'expired', code: 403 }
    }
    return {
      status: 'error',
      reason: 'exchange-failed',
      code: error.statusCode,
    }
  }
  return { status: 'error', reason: 'offline' }
}

const validationOutcome = (result: ValidateResult): OAuthOutcome => {
  if (result.ok) return { status: 'idle' }
  if (result.reason === 'offline') return { status: 'error', reason: 'offline' }
  if (result.reason === 'unauthorized' || result.reason === 'management-key') {
    return {
      status: 'error',
      reason: 'unauthorized',
      ...(result.status === undefined ? {} : { code: result.status }),
    }
  }
  return {
    status: 'error',
    reason: 'exchange-failed',
    ...(result.status === undefined ? {} : { code: result.status }),
  }
}

export const completeOAuthFromUrl = action(
  async (url: URL): Promise<OAuthOutcome> => {
    if (!hasOAuthCallback(url)) return oauthOutcome()
    let dropVerifier = false
    try {
      replaceCallback(url)
      const code = url.searchParams.get('code')
      const pending = readPendingOAuth()
      if (!code) return settle({ status: 'error', reason: 'cancelled' })
      if (!pending || url.searchParams.get('state') !== pending.state) {
        return settle({ status: 'error', reason: 'state-mismatch' })
      }
      dropVerifier = true
      if (navigator.onLine === false) {
        return settle({ status: 'error', reason: 'offline' })
      }
      oauthOutcome.set({ status: 'connecting' })
      let exchangedKey: string
      try {
        const exchanged = await wrap(
          exchangeClient.oAuth.exchangeAuthCodeForAPIKey(
            {
              requestBody: {
                code,
                codeVerifier: pending.verifier,
                codeChallengeMethod: 'S256',
              },
            },
            { signal: abortVar.require().signal },
          ),
        )
        exchangedKey = exchanged.key
      } catch (error) {
        if (isRequestAbort(error) || isAbort(error)) throw error
        return settle(exchangeOutcome(error))
      }
      const validation = await wrap(
        validateKey(exchangedKey, abortVar.require().signal),
      )
      if (!validation.ok) return settle(validationOutcome(validation))
      if (pending.unlimitedAck) {
        const hash = await wrap(sha256Hex(exchangedKey))
        rememberUnlimitedHash(hash)
      }
      placeKey(exchangedKey, pending.remember)
      return settle({
        status: 'connected',
        returnTo: sameOriginReturnTo(pending.returnTo),
      })
    } finally {
      if (dropVerifier) clearPendingOAuth()
    }
  },
  'auth.completeOAuthFromUrl',
).extend(withAsync(), withAbort('first-in-win'))
