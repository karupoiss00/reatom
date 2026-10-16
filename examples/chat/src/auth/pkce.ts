export const pendingOAuthStorageKey = 'atelier.oauth'

const verifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/

export interface PendingOAuth {
  verifier: string
  state: string
  remember: boolean
  returnTo: string | null
  unlimitedAck: boolean
}

export const sameOriginReturnTo = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  ) {
    return null
  }
  if (/[\u0000-\u001F\u007F]/.test(value)) return null
  let url: URL
  try {
    url = new URL(value, location.origin)
  } catch {
    return null
  }
  if (url.origin !== location.origin) return null
  if (!url.pathname.startsWith('/') || url.pathname.startsWith('//'))
    return null
  return `${url.pathname}${url.search}${url.hash}`
}

const isPendingOAuth = (value: Partial<PendingOAuth>): value is PendingOAuth =>
  typeof value.verifier === 'string' &&
  verifierPattern.test(value.verifier) &&
  typeof value.state === 'string' &&
  value.state.length > 0

export const readPendingOAuth = (): PendingOAuth | null => {
  try {
    const raw = sessionStorage.getItem(pendingOAuthStorageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingOAuth>
    if (!isPendingOAuth(parsed)) return null
    return {
      verifier: parsed.verifier,
      state: parsed.state,
      remember: parsed.remember === true,
      returnTo: sameOriginReturnTo(parsed.returnTo),
      unlimitedAck: parsed.unlimitedAck === true,
    }
  } catch {
    return null
  }
}

export const writePendingOAuth = (pending: PendingOAuth): void => {
  sessionStorage.setItem(
    pendingOAuthStorageKey,
    JSON.stringify({
      ...pending,
      returnTo: sameOriginReturnTo(pending.returnTo),
    }),
  )
}

export const clearPendingOAuth = (): void => {
  try {
    sessionStorage.removeItem(pendingOAuthStorageKey)
  } catch {
    return
  }
}
