import { context, sleep } from '@reatom/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { boot } from '../../app/boot'
import { overrideTimings } from '../../app/timings'
import { openRouter } from '../../api/openrouter'
import { streamLifecycle } from '../../chat/engine'
import { library } from '../../chat/library'
import { sha256Hex } from '../../platform/crypto'
import {
  resetExternalNavigator,
  setExternalNavigator,
} from '../../platform/external'
import { createChatRecord } from '../../storage/records'
import { repo, resetRepoBackend } from '../../storage/repo'
import { unlimitedAckHashes } from '../../storage/prefs'
import { exchangedKey, expiredAuthCode } from '../../testing/fixtures/auth'
import { plainTextScript } from '../../testing/fixtures/sse'
import {
  freeTierKey,
  limitedKey,
  unlimitedKey,
} from '../../testing/fixtures/keys'
import {
  mockAuthExchange,
  mockChatStream,
  mockKey,
  mockRouteDelay,
  openRouterRequests,
  requestsTo,
} from '../../testing/openrouter-mock'
import { captureExternalNavigation } from '../../testing/navigation'
import { acknowledgeUnlimited, apiKeyHash, unlimitedAckNeeded } from '../ack'
import {
  keyMeta,
  keyStatus,
  refreshKeyMeta,
  revokedDuringStream,
} from '../keyMeta'
import {
  apiKey,
  keyStorageFailed,
  keyStorageKey,
  rememberKey,
} from '../keyStore'
import {
  pendingOAuthStorageKey,
  readPendingOAuth,
  type PendingOAuth,
} from '../pkce'
import { completeOAuthFromUrl, oauthOutcome, startOAuth } from '../oauth'
import { forgetKey, initAuth, sessionMode } from '../session'
import { connectWithKey, isRequestAbort, validateKey } from '../validate'

const storedKey = 'sk-or-v1-stored'
const pastedKey = 'sk-or-v1-pasted'

const authRequests = () => requestsTo('/auth/keys')
const keyRequests = () => requestsTo('/key')

const pendingOAuth = (): PendingOAuth | null => {
  const raw = sessionStorage.getItem(pendingOAuthStorageKey)
  return raw ? (JSON.parse(raw) as PendingOAuth) : null
}

const callbackUrl = (pending: PendingOAuth, code = 'auth-code') => {
  const url = new URL(location.origin)
  url.searchParams.set('code', code)
  url.searchParams.set('state', pending.state)
  return url
}

const readyLibrary = async () => {
  await library.reload()
}

const setOnline = (online: boolean) => {
  Object.defineProperty(Navigator.prototype, 'onLine', {
    configurable: true,
    get: () => online,
  })
}

beforeEach(() => {
  context.reset()
  resetRepoBackend()
  resetExternalNavigator()
  overrideTimings()
  history.replaceState(null, '', `${location.pathname}${location.hash}`)
})

afterEach(() => {
  resetExternalNavigator()
  setOnline(true)
  history.replaceState(null, '', `${location.pathname}${location.hash}`)
})

test('The auth URL contains `code_challenge_method=S256`, a non-empty `code_challenge`, `callback_url` equal to the app origin, and a `state`.', async () => {
  const urls = captureExternalNavigation()

  await startOAuth({ limit: 10, remember: true, returnTo: '/c/chat-1' })

  expect(urls).toHaveLength(1)
  const authUrl = new URL(urls[0]!)
  expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authUrl.searchParams.get('code_challenge')).toBeTruthy()
  expect(authUrl.searchParams.get('callback_url')).toBe(location.origin)
  expect(authUrl.searchParams.get('state')).toBeTruthy()
  const pending = pendingOAuth()
  expect(pending?.state).toBe(authUrl.searchParams.get('state'))
  expect(pending?.verifier).toBeTruthy()
  expect(pending?.remember).toBe(true)
  expect(pending?.returnTo).toBe('/c/chat-1')
  expect(oauthOutcome()).toEqual({ status: 'redirecting' })
})

test('The URL contains `limit=<n>` exactly when the field holds a finite number above 0. With `10` it contains `limit=10`.', async () => {
  const urls = captureExternalNavigation()

  await startOAuth({ limit: 10, remember: true, returnTo: null })

  expect(new URL(urls[0]!).searchParams.get('limit')).toBe('10')
})

test('An empty field with the checkbox checked sends no `limit`.', async () => {
  const urls = captureExternalNavigation()

  await startOAuth({ limit: null, remember: true, returnTo: null })

  expect(new URL(urls[0]!).searchParams.has('limit')).toBe(false)
  expect(pendingOAuth()?.remember).toBe(true)
})

test('The values `0`, negatives, and non-numeric text keep the button disabled and show the inline error "Enter a limit above 0, or clear the field for no limit." No redirect happens.', async () => {
  const urls = captureExternalNavigation()

  await startOAuth({ limit: 0, remember: true, returnTo: null })
  await startOAuth({ limit: -5, remember: true, returnTo: null })
  await startOAuth({ limit: Number.NaN, remember: true, returnTo: null })

  expect(urls).toHaveLength(0)
  expect(sessionStorage.getItem(pendingOAuthStorageKey)).toBeNull()
  expect(oauthOutcome().status).not.toBe('redirecting')
})

test('After the callback, the address bar has no `code` or `state`, because the callback URL is replaced with `history.replaceState`.', async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: '/c/chat-1' })
  const pending = pendingOAuth()
  expect(pending).not.toBeNull()
  const callback = callbackUrl(pending!)
  history.pushState(null, '', `${callback.pathname}${callback.search}`)

  const outcome = await completeOAuthFromUrl(new URL(location.href))

  expect(outcome).toEqual({ status: 'connected', returnTo: '/c/chat-1' })
  expect(location.search).not.toContain('code')
  expect(location.search).not.toContain('state')
  expect(new URL(location.href).searchParams.has('code')).toBe(false)
  expect(new URL(location.href).searchParams.has('state')).toBe(false)
})

test('With "Remember" checked, a reload and a new tab both remain connected. With it unchecked, a reload of the same tab stays connected, and a new tab follows R-1 (the archive if chats exist).', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  sessionStorage.clear()
  context.reset()
  await readyLibrary()
  await initAuth()
  expect(sessionMode()).toBe('connected')
  expect(apiKey()).toBe(storedKey)

  context.reset()
  resetRepoBackend()
  await connectWithKey(storedKey, { remember: false })
  expect(sessionStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  context.reset()
  await readyLibrary()
  await initAuth()
  expect(sessionMode()).toBe('connected')

  sessionStorage.clear()
  context.reset()
  await readyLibrary()
  await initAuth()
  expect(sessionMode()).toBe('welcome')
})

test('The PKCE verifier is gone from sessionStorage after the exchange, whether it succeeded or failed.', async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  expect(sessionStorage.getItem(pendingOAuthStorageKey)).toBeNull()

  mockAuthExchange(expiredAuthCode)
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const failed = await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  expect(failed).toMatchObject({
    status: 'error',
    reason: 'expired',
    code: 403,
  })
  expect(sessionStorage.getItem(pendingOAuthStorageKey)).toBeNull()
})

test('A double click sends only one exchange request.', async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  mockRouteDelay('/auth/keys', 200)
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const callback = callbackUrl(pendingOAuth()!)

  const first = completeOAuthFromUrl(callback)
  let secondRejected = false
  try {
    await completeOAuthFromUrl(callback)
  } catch {
    secondRejected = true
  }
  await first

  expect(secondRejected).toBe(true)
  expect(authRequests()).toHaveLength(1)
})

test('Every successful OAuth creates a new OpenRouter key and does not revoke the previous one.', async () => {
  captureExternalNavigation()
  localStorage.setItem(keyStorageKey, storedKey)
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: null })

  await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))

  expect(apiKey()).toBe(exchangedKey.key)
  expect(authRequests()).toHaveLength(1)
  expect(authRequests()[0]?.method).toBe('POST')
  expect(openRouterRequests().some((entry) => entry.method === 'DELETE')).toBe(
    false,
  )
  expect(authRequests()[0]?.headers.authorization ?? '').not.toContain(
    storedKey,
  )
})

test("A key minted with no limit counts as acknowledged for F-03's unlimited-key warning, so no second warning appears.", async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(unlimitedKey)
  await startOAuth({ limit: null, remember: true, returnTo: null })

  await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  await keyMeta()
  await apiKeyHash()

  expect(unlimitedAckHashes()).toContain(await sha256Hex(exchangedKey.key))
  expect(unlimitedAckNeeded()).toBe(false)
})

test('Cancelled, or the callback has no `code`: existing key stays stored and no exchange is sent.', async () => {
  captureExternalNavigation()
  localStorage.setItem(keyStorageKey, storedKey)
  apiKey.set(storedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const pending = pendingOAuth()!
  const cancelled = new URL(location.origin)
  cancelled.searchParams.set('state', pending.state)

  const outcome = await completeOAuthFromUrl(cancelled)

  expect(outcome).toEqual({ status: 'error', reason: 'cancelled' })
  expect(authRequests()).toHaveLength(0)
  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
})

test('`state` mismatch, or no PKCE verifier in this tab: no exchange is sent and any existing key is kept.', async () => {
  captureExternalNavigation()
  localStorage.setItem(keyStorageKey, storedKey)
  apiKey.set(storedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const pending = pendingOAuth()
  const mismatch = new URL(location.origin)
  mismatch.searchParams.set('code', 'auth-code')
  mismatch.searchParams.set('state', 'other-tab')

  const mismatched = await completeOAuthFromUrl(mismatch)

  expect(mismatched).toEqual({ status: 'error', reason: 'state-mismatch' })
  expect(pendingOAuth()?.verifier).toBe(pending?.verifier)
  expect(authRequests()).toHaveLength(0)
  expect(apiKey()).toBe(storedKey)

  const missingVerifier = new URL(location.origin)
  missingVerifier.searchParams.set('code', 'auth-code')
  missingVerifier.searchParams.set('state', 'unused')
  sessionStorage.removeItem(pendingOAuthStorageKey)
  const missing = await completeOAuthFromUrl(missingVerifier)
  expect(missing).toEqual({ status: 'error', reason: 'state-mismatch' })
  expect(authRequests()).toHaveLength(0)
  expect(apiKey()).toBe(storedKey)
})

test('Exchange returns 400 or 5xx: outcome is exchange-failed with the code, and the old key is kept.', async () => {
  captureExternalNavigation()
  localStorage.setItem(keyStorageKey, storedKey)
  apiKey.set(storedKey)
  mockAuthExchange({
    status: 400,
    body: { error: { code: 400, message: 'bad code' } },
  })
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const bad = await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  expect(bad).toMatchObject({
    status: 'error',
    reason: 'exchange-failed',
    code: 400,
  })
  expect(apiKey()).toBe(storedKey)
  expect(sessionStorage.getItem(pendingOAuthStorageKey)).toBeNull()

  mockAuthExchange({
    status: 502,
    body: { error: { code: 502, message: 'down' } },
  })
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const down = await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  expect(down).toMatchObject({
    status: 'error',
    reason: 'exchange-failed',
    code: 502,
  })
  expect(apiKey()).toBe(storedKey)
})

test('Offline: OAuth does not navigate and does not exchange.', async () => {
  const urls = captureExternalNavigation()
  setOnline(false)

  await startOAuth({ limit: 10, remember: true, returnTo: null })

  expect(urls).toHaveLength(0)
  expect(oauthOutcome()).toEqual({ status: 'error', reason: 'offline' })
  expect(authRequests()).toHaveLength(0)
})

test('Callback while already signed in and `state` matches: the stored key is replaced only after the new key passes `GET /key`. If `GET /key` fails, the old key is kept.', async () => {
  captureExternalNavigation()
  localStorage.setItem(keyStorageKey, storedKey)
  apiKey.set(storedKey)
  mockAuthExchange(exchangedKey)
  mockKey({ status: 500, body: { error: { code: 500, message: 'down' } } })
  await startOAuth({ limit: 10, remember: true, returnTo: null })

  const failed = await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))

  expect(failed).toMatchObject({ status: 'error', reason: 'exchange-failed' })
  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()

  mockKey(limitedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: '/c/return' })
  const connected = await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  expect(connected).toEqual({ status: 'connected', returnTo: '/c/return' })
  expect(apiKey()).toBe(exchangedKey.key)
  expect(localStorage.getItem(keyStorageKey)).toBe(exchangedKey.key)
  expect(keyRequests().at(-1)?.headers.authorization).toContain(
    exchangedKey.key,
  )
  expect(keyRequests().at(-1)?.headers.authorization).not.toContain(storedKey)
})

test('New key fails `GET /key` with 401: the F-02 401 outcome, and nothing new is stored.', async () => {
  captureExternalNavigation()
  localStorage.setItem(keyStorageKey, storedKey)
  apiKey.set(storedKey)
  mockAuthExchange(exchangedKey)
  mockKey({
    status: 401,
    body: { error: { code: 401, message: 'User not found.' } },
  })
  await startOAuth({ limit: 10, remember: true, returnTo: null })

  const outcome = await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))

  expect(outcome).toMatchObject({ status: 'error', reason: 'unauthorized' })
  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).not.toBe(exchangedKey.key)
})

test('`GET /key` is sent with `Authorization: Bearer <trimmed key>`. No chat request is sent during validation.', async () => {
  mockKey(limitedKey)

  const result = await connectWithKey(`  ${pastedKey}  `, { remember: true })

  expect(result.ok).toBe(true)
  expect(keyRequests()).toHaveLength(1)
  expect(keyRequests()[0]?.headers.authorization).toBe(`Bearer ${pastedKey}`)
  expect(requestsTo('/chat/completions')).toHaveLength(0)
  expect(apiKey()).toBe(pastedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(pastedKey)
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
})

test('401: nothing is stored.', async () => {
  localStorage.setItem(keyStorageKey, storedKey)
  apiKey.set(storedKey)
  mockKey({
    status: 401,
    body: { error: { code: 401, message: 'User not found.' } },
  })

  const result = await connectWithKey(pastedKey, { remember: true })

  expect(result).toMatchObject({
    ok: false,
    reason: 'unauthorized',
    status: 401,
  })
  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(sessionStorage.getItem(keyStorageKey)).not.toBe(pastedKey)
})

test('`data.is_management_key: true`: nothing is stored.', async () => {
  mockKey({ ...limitedKey, is_management_key: true })

  const result = await connectWithKey('sk-or-v1-management', { remember: true })

  expect(result).toMatchObject({ ok: false, reason: 'management-key' })
  expect(apiKey()).toBeNull()
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
  expect(requestsTo('/chat/completions')).toHaveLength(0)
  expect(requestsTo('/credits')).toHaveLength(0)
})

test('403 without `is_management_key: true`: nothing is stored.', async () => {
  mockKey({ status: 403, body: { error: { code: 403, message: 'refused' } } })

  const result = await connectWithKey(pastedKey, { remember: true })

  expect(result).toMatchObject({ ok: false, reason: 'forbidden', status: 403 })
  expect(apiKey()).toBeNull()
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
})

test('Offline or network error: nothing is stored.', async () => {
  setOnline(false)
  const offline = await connectWithKey(pastedKey, { remember: true })
  expect(offline).toEqual({ ok: false, reason: 'offline' })
  expect(keyRequests()).toHaveLength(0)
  expect(apiKey()).toBeNull()
  setOnline(true)

  const previous = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).pathname.endsWith('/key')) {
      throw new TypeError('Failed to fetch')
    }
    return previous(input, init)
  }
  try {
    const network = await connectWithKey(pastedKey, { remember: true })
    expect(network).toEqual({ ok: false, reason: 'offline' })
    expect(localStorage.getItem(keyStorageKey)).toBeNull()
    expect(apiKey()).toBeNull()
  } finally {
    globalThis.fetch = previous
  }
})

test('429 or 5xx: busy, and `Retry-After` is the countdown in seconds.', async () => {
  mockKey({
    status: 429,
    headers: { 'retry-after': '12' },
    body: { error: { code: 429, message: 'slow' } },
  })
  const limited = await connectWithKey(pastedKey, { remember: true })
  expect(limited).toEqual({
    ok: false,
    reason: 'busy',
    status: 429,
    retryAfterSec: 12,
  })
  expect(apiKey()).toBeNull()

  mockKey({
    status: 503,
    headers: { 'retry-after': '9' },
    body: { error: { code: 503, message: 'down' } },
  })
  const down = await connectWithKey(pastedKey, { remember: true })
  expect(down).toEqual({
    ok: false,
    reason: 'busy',
    status: 503,
    retryAfterSec: 9,
  })
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
})

test('A `GET /key` response with `data.limit: null` opens the unlimited-key acknowledgement. A capped paste does not.', async () => {
  mockKey(unlimitedKey)
  await connectWithKey(pastedKey, { remember: true })
  await keyMeta()
  await apiKeyHash()
  expect(unlimitedAckNeeded()).toBe(true)
  expect(unlimitedAckHashes()).not.toContain(await sha256Hex(pastedKey))

  await acknowledgeUnlimited()
  expect(unlimitedAckNeeded()).toBe(false)

  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await keyMeta()
  await apiKeyHash()
  expect(keyMeta.data()).toMatchObject({
    label: limitedKey.label,
    limit: 100,
    limitRemaining: 74.5,
    limitReset: 'monthly',
    usageDaily: 1.2,
    usageWeekly: 4.4,
    usageMonthly: 25.5,
    byokUsageMonthly: 17.38,
    isFreeTier: false,
    isManagementKey: false,
  })
  expect(unlimitedAckNeeded()).toBe(false)
})

test('Change key while connected replaces storage only after the new key passes `GET /key`.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  mockKey({ status: 401, body: { error: { code: 401, message: 'nope' } } })

  await connectWithKey(pastedKey, { remember: false })

  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
})

test('Toggling "Remember" moves the key between localStorage and sessionStorage. Afterwards exactly one of the two holds it.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  expect(rememberKey()).toBe(true)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()

  rememberKey.set(false)
  expect(sessionStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBeNull()

  rememberKey.set(true)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
})

test('After Forget, neither storage holds the key.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })

  forgetKey()

  expect(apiKey()).toBeNull()
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
  expect(rememberKey()).toBe(true)
})

test('The app never calls `/credits`.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await keyMeta()
  refreshKeyMeta({ force: true })
  await keyMeta()

  expect(
    openRouterRequests().some((entry) => entry.url.includes('/credits')),
  ).toBe(false)
})

test('After each completed reply the chip re-fetches `GET /key`, at most once every 10 s.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  const baseline = keyRequests().length

  refreshKeyMeta()
  await expect.poll(() => keyRequests().length).toBe(baseline + 1)
  refreshKeyMeta()
  await sleep(20)
  expect(keyRequests().length).toBe(baseline + 1)

  refreshKeyMeta({ force: true })
  await expect.poll(() => keyRequests().length).toBe(baseline + 2)

  overrideTimings({ keyMetaThrottleMs: 40 })
  context.reset()
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  const again = keyRequests().length
  refreshKeyMeta()
  await expect.poll(() => keyRequests().length).toBe(again + 1)
  await sleep(50)
  refreshKeyMeta()
  await expect.poll(() => keyRequests().length).toBe(again + 2)
})

test('A `GET /key` 401 during an active stream does not abort the fetch. When the stream ends, the key is cleared.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  streamLifecycle({
    type: 'started',
    chatId: 'chat-1',
    messageId: 'message-1',
  })
  await sleep(0)

  mockChatStream({ hang: true, chunks: [plainTextScript[0]!] })
  const controller = new AbortController()
  const pending = openRouter().chat.send(
    {
      chatRequest: {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
    },
    { signal: controller.signal, retries: { strategy: 'none' } },
  )
  mockKey({ status: 401, body: { error: { code: 401, message: 'revoked' } } })
  refreshKeyMeta({ force: true })

  try {
    await expect.poll(() => revokedDuringStream()).toBe(true)
    expect(apiKey()).toBe(storedKey)
    expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
    expect(controller.signal.aborted).toBe(false)
    const stream = await pending
    expect(stream).toBeInstanceOf(ReadableStream)
    const reader = (stream as ReadableStream<unknown>).getReader()
    let closed = false
    void reader.closed.then(
      () => {
        closed = true
      },
      () => {
        closed = true
      },
    )
    await sleep(30)
    expect(closed).toBe(false)
    reader.releaseLock()

    streamLifecycle({
      type: 'completed',
      chatId: 'chat-1',
      messageId: 'message-1',
    })
    await expect.poll(() => apiKey()).toBeNull()
    expect(keyStatus()).toBe('revoked')
    expect(localStorage.getItem(keyStorageKey)).toBeNull()
    expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
    expect(revokedDuringStream()).toBe(false)
  } finally {
    controller.abort()
    await pending.catch(() => undefined)
  }
})

test('`GET /key` returns 401 later: the key is cleared.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  mockKey({ status: 401, body: { error: { code: 401, message: 'revoked' } } })

  refreshKeyMeta({ force: true })

  await expect.poll(() => apiKey()).toBeNull()
  expect(keyStatus()).toBe('revoked')
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(revokedDuringStream()).toBe(false)
})

test('`GET /key` fails with a network error or 5xx: key status is unavailable and the key stays.', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await keyMeta()
  mockKey({ status: 502, body: { error: { code: 502, message: 'down' } } })

  refreshKeyMeta({ force: true })

  await expect.poll(() => keyStatus()).toBe('unavailable')
  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
})

test('localStorage blocked while saving the key: `keyStorageFailed` and the session continues in memory.', async () => {
  mockKey(limitedKey)
  const nativeSetItem = localStorage.setItem.bind(localStorage)
  localStorage.setItem = () => {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  try {
    const result = await connectWithKey(storedKey, { remember: true })
    expect(result.ok).toBe(true)
    expect(keyStorageFailed()).toBe(true)
    expect(apiKey()).toBe(storedKey)
    expect(localStorage.getItem(keyStorageKey)).toBeNull()
  } finally {
    localStorage.setItem = nativeSetItem
  }
})

test('key meta maps a free-tier key and starts loading until `GET /key` settles.', async () => {
  mockKey(freeTierKey)
  await connectWithKey(storedKey, { remember: false })
  expect(keyStatus()).toBe('loading')
  await keyMeta()
  expect(keyStatus()).toBe('ok')
  expect(keyMeta.data()).toMatchObject({
    isFreeTier: true,
    label: freeTierKey.label,
    limit: 0,
  })
})

test('R-1: booting until auth storage and the library have both resolved.', async () => {
  expect(sessionMode()).toBe('booting')

  await readyLibrary()
  expect(sessionMode()).toBe('booting')

  localStorage.setItem(keyStorageKey, storedKey)
  await initAuth()
  expect(apiKey()).toBe(storedKey)
  expect(sessionMode()).toBe('connected')
})

test('R-1: no key and no saved chats shows welcome. Saved non-deleted chats show the archive. A deleted chat does not.', async () => {
  await readyLibrary()
  await initAuth()
  expect(sessionMode()).toBe('welcome')

  await repo.createChat(
    createChatRecord({ id: 'chat-1', at: 1, title: 'Kept' }),
  )
  await readyLibrary()
  expect(sessionMode()).toBe('archive')

  forgetKey()
  expect(sessionMode()).toBe('archive')
  expect(apiKey()).toBeNull()

  resetRepoBackend()
  const deleted = createChatRecord({ id: 'chat-2', at: 2, title: 'Gone' })
  await repo.createChat({ ...deleted, deletedAt: 3, deletedByTab: 'tab-a' })
  await readyLibrary()
  expect(sessionMode()).toBe('welcome')
})

test("R-1: a key in this tab's sessionStorage connects, and library loading stays booting.", async () => {
  sessionStorage.setItem(keyStorageKey, storedKey)
  await initAuth()
  expect(apiKey()).toBe(storedKey)
  expect(rememberKey()).toBe(false)
  expect(sessionMode()).toBe('booting')

  await readyLibrary()
  expect(sessionMode()).toBe('connected')
})

test('OAuth exchange sends the saved verifier and does not call `/credits`.', async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  await startOAuth({ limit: 25, remember: false, returnTo: null })
  const pending = pendingOAuth()!

  await completeOAuthFromUrl(callbackUrl(pending))

  expect(authRequests()[0]?.body).toMatchObject({
    code: 'auth-code',
    code_verifier: pending.verifier,
    code_challenge_method: 'S256',
  })
  expect(sessionStorage.getItem(keyStorageKey)).toBe(exchangedKey.key)
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
  expect(rememberKey()).toBe(false)
  expect(
    openRouterRequests().some((entry) => entry.url.includes('/credits')),
  ).toBe(false)
})

const verifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/

test('boot strips ?code=&state= synchronously, before storage awaits, and a second boot does not replay the code', async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(limitedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: null })
  const callback = callbackUrl(pendingOAuth()!)
  history.pushState(null, '', `${callback.pathname}${callback.search}`)

  const firstBoot = boot()
  expect(new URL(location.href).searchParams.has('code')).toBe(false)
  expect(new URL(location.href).searchParams.has('state')).toBe(false)
  await firstBoot

  expect(authRequests()).toHaveLength(1)
  expect(apiKey()).toBe(exchangedKey.key)

  await boot()
  expect(authRequests()).toHaveLength(1)
})

test('A stream-time 401 does not resolve with cached meta, and an unknown limit is not null', async () => {
  mockKey(unlimitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  expect(keyMeta.data()?.limit).toBeNull()

  streamLifecycle({
    type: 'started',
    chatId: 'chat-1',
    messageId: 'message-1',
  })
  await sleep(0)
  mockKey({ status: 401, body: { error: { code: 401, message: 'revoked' } } })
  apiKey.set('sk-or-v1-other')
  refreshKeyMeta({ force: true })

  await expect(keyMeta()).rejects.toThrow()
  expect(revokedDuringStream()).toBe(true)
  expect(apiKey()).toBe('sk-or-v1-other')
  expect(keyMeta.data()?.limit ?? 'unknown').not.toBeNull()
  expect(unlimitedAckNeeded()).toBe(false)
})

test('A double click on Connect starts one navigation, and the stored verifier matches that URL', async () => {
  const urls: string[] = []
  setExternalNavigator((url) => {
    const pending = pendingOAuth()
    const authUrl = new URL(url)
    expect(pending?.verifier).toMatch(verifierPattern)
    expect(pending?.state).toBe(authUrl.searchParams.get('state'))
    urls.push(url)
  })

  const first = startOAuth({ limit: 10, remember: true, returnTo: '/c/chat-1' })
  const second = Promise.resolve().then(() =>
    startOAuth({ limit: 10, remember: true, returnTo: '/c/other' }),
  )
  const settled = await Promise.allSettled([first, second])

  expect(settled[0]?.status).toBe('fulfilled')
  expect(settled[1]?.status).toBe('rejected')
  expect(urls).toHaveLength(1)
  expect(pendingOAuth()?.returnTo).toBe('/c/chat-1')
})

test('A key minted with a limit is not pre-acknowledged when GET /key reports limit null', async () => {
  captureExternalNavigation()
  mockAuthExchange(exchangedKey)
  mockKey(unlimitedKey)
  await startOAuth({ limit: 10, remember: true, returnTo: null })

  await completeOAuthFromUrl(callbackUrl(pendingOAuth()!))
  await keyMeta()
  await apiKeyHash()

  expect(unlimitedAckHashes()).not.toContain(await sha256Hex(exchangedKey.key))
  expect(unlimitedAckNeeded()).toBe(true)
})

test('validateKey aborts GET /key when its signal aborts', async () => {
  mockKey(limitedKey)
  mockRouteDelay('/key', 400)
  const controller = new AbortController()
  const pending = validateKey(pastedKey, controller.signal)
  await expect.poll(() => keyRequests().length).toBe(1)
  controller.abort()

  await expect(pending).rejects.toSatisfy(isRequestAbort)
  expect(apiKey()).toBeNull()
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
})

test('A completion 401 inside the 10s throttle force-clears the key or sets revokedDuringStream', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  refreshKeyMeta({ force: true })
  await expect.poll(() => keyRequests().length).toBeGreaterThan(0)

  mockKey({ status: 401, body: { error: { code: 401, message: 'revoked' } } })
  streamLifecycle({
    type: 'started',
    chatId: 'chat-1',
    messageId: 'message-1',
  })
  streamLifecycle({
    type: 'completed',
    chatId: 'chat-1',
    messageId: 'message-1',
  })

  await expect.poll(() => apiKey() === null || revokedDuringStream()).toBe(true)
  expect(localStorage.getItem(keyStorageKey)).toBeNull()
})

test('returnTo is stored only as a same-origin path', async () => {
  captureExternalNavigation()
  await startOAuth({
    limit: 10,
    remember: true,
    returnTo: 'https://evil.example/phish',
  })
  expect(pendingOAuth()?.returnTo ?? null).toBeNull()

  await startOAuth({
    limit: 10,
    remember: true,
    returnTo: '//evil.example/phish',
  })
  expect(pendingOAuth()?.returnTo ?? null).toBeNull()

  await startOAuth({
    limit: 10,
    remember: true,
    returnTo: '/\\evil.example',
  })
  expect(pendingOAuth()?.returnTo ?? null).toBeNull()

  await startOAuth({
    limit: 10,
    remember: true,
    returnTo: '/c/chat-1?tab=1#reply',
  })
  expect(pendingOAuth()?.returnTo).toBe('/c/chat-1?tab=1#reply')

  sessionStorage.setItem(
    pendingOAuthStorageKey,
    JSON.stringify({
      verifier: 'a'.repeat(43),
      state: 'state-1',
      remember: true,
      returnTo: 'https://evil.example/phish',
    }),
  )
  expect(readPendingOAuth()?.returnTo ?? null).toBeNull()
})

test('If both storages hold a key, local wins and the session copy is removed', () => {
  localStorage.setItem(keyStorageKey, 'sk-or-v1-local')
  sessionStorage.setItem(keyStorageKey, 'sk-or-v1-session')
  context.reset()

  expect(apiKey()).toBe('sk-or-v1-local')
  expect(rememberKey()).toBe(true)
  expect(localStorage.getItem(keyStorageKey)).toBe('sk-or-v1-local')
  expect(sessionStorage.getItem(keyStorageKey)).toBeNull()
})

test('A second initAuth does not zero an active stream, so a 401 stays non-blocking', async () => {
  mockKey(limitedKey)
  await connectWithKey(storedKey, { remember: true })
  await initAuth()
  await keyMeta()
  streamLifecycle({
    type: 'started',
    chatId: 'chat-1',
    messageId: 'message-1',
  })
  await sleep(0)
  await initAuth()

  mockKey({ status: 401, body: { error: { code: 401, message: 'revoked' } } })
  refreshKeyMeta({ force: true })

  await expect.poll(() => revokedDuringStream()).toBe(true)
  expect(apiKey()).toBe(storedKey)
  expect(localStorage.getItem(keyStorageKey)).toBe(storedKey)
})

test('Retry-After HTTP-date is the countdown in seconds', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  try {
    mockKey({
      status: 429,
      headers: { 'retry-after': 'Mon, 05 Oct 2026 12:00:12 GMT' },
      body: { error: { code: 429, message: 'slow' } },
    })
    const future = await connectWithKey(pastedKey, { remember: true })
    expect(future).toEqual({
      ok: false,
      reason: 'busy',
      status: 429,
      retryAfterSec: 12,
    })

    mockKey({
      status: 429,
      headers: { 'retry-after': 'Mon, 05 Oct 2026 11:00:00 GMT' },
      body: { error: { code: 429, message: 'slow' } },
    })
    const past = await connectWithKey(pastedKey, { remember: true })
    expect(past).toMatchObject({ ok: false, reason: 'busy', retryAfterSec: 0 })
  } finally {
    vi.useRealTimers()
  }
})

test('A lone ?error= or ?state= does not delete the PKCE verifier', async () => {
  captureExternalNavigation()
  await startOAuth({ limit: 10, remember: true, returnTo: '/c/chat-1' })
  const pending = pendingOAuth()
  expect(pending?.verifier).toMatch(verifierPattern)

  const errorOnly = new URL(location.origin)
  errorOnly.searchParams.set('error', 'access_denied')
  const cancelled = await completeOAuthFromUrl(errorOnly)
  expect(cancelled).toEqual({ status: 'error', reason: 'cancelled' })
  expect(authRequests()).toHaveLength(0)
  expect(pendingOAuth()?.verifier).toBe(pending?.verifier)

  const stateOnly = new URL(location.origin)
  stateOnly.searchParams.set('state', pending!.state)
  const mismatched = await completeOAuthFromUrl(stateOnly)
  expect(mismatched).toEqual({ status: 'error', reason: 'cancelled' })
  expect(pendingOAuth()?.verifier).toBe(pending?.verifier)
})

test('A PKCE verifier that is not 43-128 unreserved characters is ignored', () => {
  sessionStorage.setItem(
    pendingOAuthStorageKey,
    JSON.stringify({
      verifier: 'short',
      state: 'state-1',
      remember: true,
      returnTo: '/c/chat-1',
    }),
  )
  expect(readPendingOAuth()).toBeNull()
})
