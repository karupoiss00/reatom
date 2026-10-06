import { action, atom, computed, wrap } from '@reatom/core'

import {
  connectWithKey,
  oauthOutcome,
  rememberKey,
  startOAuth,
  type OAuthOutcome,
  type ValidateResult,
} from '../../auth'

export { rememberKey }
import { isOnline } from '../../platform/env'
import { chatIdFromReturnTo, chatRoute, currentChatReturnTo } from '../../routes'

const limitPattern = /^(?:\d+|\d+\.\d+)$/

export type LimitDraft =
  | { state: 'empty' }
  | { state: 'invalid' }
  | { state: 'set'; amount: number }

const parseLimit = (raw: string): LimitDraft => {
  const text = raw.trim()
  if (text === '') return { state: 'empty' }
  if (!limitPattern.test(text)) return { state: 'invalid' }
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount <= 0) return { state: 'invalid' }
  return { state: 'set', amount }
}

const compactAmount = (amount: number) =>
  Number.isInteger(amount) ? String(amount) : String(amount)

export const limitDraft = atom('10', 'welcome.limitDraft')
export const unlimitedAccepted = atom(false, 'welcome.unlimitedAccepted')
export const connectPending = atom(false, 'welcome.connectPending')
export const connectOpen = atom(false, 'welcome.connectOpen')

export const pasteKeyOpen = atom(false, 'welcome.pasteKeyOpen')
export const pasteIntent = atom<'paste' | 'change'>('paste', 'welcome.pasteIntent')
export const pasteDraft = atom('', 'welcome.pasteDraft')
export const pasteRevealed = atom(false, 'welcome.pasteRevealed')
export const pastePending = atom(false, 'welcome.pastePending')
export const pasteError = atom<string | null>(null, 'welcome.pasteError')
export const pasteProblem = atom<
  Extract<ValidateResult, { ok: false }>['reason'] | null
>(null, 'welcome.pasteProblem')
export const busyCountdown = atom<number | null>(null, 'welcome.busyCountdown')

export const browserOnline = computed(
  () => isOnline() && navigator.onLine !== false,
  'welcome.browserOnline',
)

export const limitState = computed(
  () => parseLimit(limitDraft()),
  'welcome.limitState',
)

export const connectLabel = computed(() => {
  const limit = limitState()
  if (limit.state === 'empty') return 'Connect with no limit'
  if (limit.state === 'set') {
    return `Connect with a $${compactAmount(limit.amount)} limit`
  }
  return 'Connect with OpenRouter'
}, 'welcome.connectLabel')

export const canConnect = computed(() => {
  if (!browserOnline()) return false
  if (connectPending()) return false
  if (oauthOutcome().status === 'redirecting') return false
  const limit = limitState()
  if (limit.state === 'invalid') return false
  if (limit.state === 'empty' && !unlimitedAccepted()) return false
  return true
}, 'welcome.canConnect')

export const connectBusy = computed(
  () => connectPending() || oauthOutcome().status === 'redirecting',
  'welcome.connectBusy',
)

export const followReturnTo = (returnTo: string | null) => {
  if (!returnTo) return
  const chatId = chatIdFromReturnTo(returnTo)
  if (!chatId) return
  chatRoute.go({ chatId })
}

export const connect = action(async () => {
  if (!canConnect()) return
  const limit = limitState()
  if (limit.state === 'invalid') return
  if (limit.state === 'empty' && !unlimitedAccepted()) return
  connectPending.set(true)
  try {
    await wrap(
      startOAuth({
        limit: limit.state === 'empty' ? null : limit.amount,
        remember: rememberKey(),
        returnTo: currentChatReturnTo(),
      }),
    )
  } finally {
    connectPending.set(false)
  }
}, 'welcome.connect')

export const openConnect = action(() => {
  connectOpen.set(true)
}, 'welcome.openConnect')

let pasteField: HTMLInputElement | null = null
let countdownTimer: ReturnType<typeof setInterval> | undefined

export const bindPasteField = (input: HTMLInputElement) => {
  pasteField = input
  return () => {
    if (pasteField === input) pasteField = null
  }
}

const stopCountdown = () => {
  if (countdownTimer === undefined) return
  clearInterval(countdownTimer)
  countdownTimer = undefined
}

const armCountdown = (seconds: number) => {
  stopCountdown()
  if (seconds <= 0) {
    busyCountdown.set(null)
    return
  }
  busyCountdown.set(seconds)
  const tick = wrap(() => {
    const left = busyCountdown()
    if (left === null || left <= 1) {
      busyCountdown.set(null)
      stopCountdown()
      return
    }
    busyCountdown.set(left - 1)
  })
  countdownTimer = setInterval(tick, 1000)
}

const focusPasteField = () => {
  queueMicrotask(() => pasteField?.focus())
}

const failureMessage = (
  result: Extract<ValidateResult, { ok: false }>,
): string => {
  if (result.reason === 'unauthorized') {
    return "OpenRouter didn't accept this key. It may be mistyped, disabled, or deleted."
  }
  if (result.reason === 'management-key') {
    return 'This is a management key. For safety, create a regular API key and paste that instead.'
  }
  if (result.reason === 'forbidden') {
    return `OpenRouter refused this key (${result.status ?? 403}).`
  }
  if (result.reason === 'offline') {
    return "Couldn't reach OpenRouter. Check your connection and try again."
  }
  return `OpenRouter is busy (code ${result.status ?? 429}). Try again in a moment.`
}

export const openPasteKey = action((intent: 'paste' | 'change' = 'paste') => {
  pasteIntent.set(intent)
  pasteError.set(null)
  pasteProblem.set(null)
  stopCountdown()
  busyCountdown.set(null)
  connectOpen.set(false)
  pasteKeyOpen.set(true)
}, 'welcome.openPasteKey')

export const openChangeKey = action(() => {
  openPasteKey('change')
}, 'welcome.openChangeKey')

export const closePasteKey = action(() => {
  pasteKeyOpen.set(false)
  pastePending.set(false)
  stopCountdown()
  busyCountdown.set(null)
}, 'welcome.closePasteKey')

export const submitPaste = action(async () => {
  const trimmed = pasteDraft().trim()
  if (!trimmed || pastePending()) return
  pasteError.set(null)
  pasteProblem.set(null)
  stopCountdown()
  busyCountdown.set(null)
  if (!browserOnline()) {
    pasteProblem.set('offline')
    pasteError.set(
      "Couldn't reach OpenRouter. Check your connection and try again.",
    )
    return
  }
  pastePending.set(true)
  try {
    const result = await wrap(
      connectWithKey(trimmed, { remember: rememberKey() }),
    )
    if (!result.ok) {
      pasteProblem.set(result.reason)
      pasteError.set(failureMessage(result))
      if (result.reason === 'busy' && result.retryAfterSec !== undefined) {
        armCountdown(result.retryAfterSec)
      }
      focusPasteField()
      return
    }
    pasteDraft.set('')
    pasteKeyOpen.set(false)
  } finally {
    pastePending.set(false)
  }
}, 'welcome.submitPaste')

export const leaveOAuthError = action(() => {
  oauthOutcome.set({ status: 'idle' })
}, 'welcome.leaveOAuthError')

export const pasteInstead = action(() => {
  oauthOutcome.set({ status: 'idle' })
  openPasteKey('paste')
}, 'welcome.pasteInstead')

export const rememberHint =
  "Uncheck on shared computers: you'll reconnect in every new\u00A0tab."

export const oauthErrorCopy = (
  reason: Extract<OAuthOutcome, { status: 'error' }>['reason'],
): { title: string; detail: string } => {
  if (reason === 'cancelled') {
    return {
      title: 'Connection cancelled',
      detail: 'Nothing was changed. Connect again whenever you want a new key.',
    }
  }
  if (reason === 'state-mismatch') {
    return {
      title: "This sign-in didn't start in this tab",
      detail: 'Please connect again from this window.',
    }
  }
  if (reason === 'expired') {
    return {
      title: 'The sign-in link expired',
      detail: 'Connect again to mint a new key.',
    }
  }
  if (reason === 'offline') {
    return {
      title: "You're offline",
      detail: "Connect when you're back online.",
    }
  }
  if (reason === 'unauthorized') {
    return {
      title: "OpenRouter didn't accept this key",
      detail: 'It may be mistyped, disabled, or deleted.',
    }
  }
  return {
    title: "OpenRouter couldn't create a key",
    detail:
      'Nothing was changed. Try again, or paste a\u00A0key\u00A0you\u00A0already\u00A0have.',
  }
}

export const keyHint = computed(() => {
  const value = pasteDraft().trim()
  if (value === '' || value.startsWith('sk-or-')) return null
  return 'OpenRouter keys usually start with sk-or-'
}, 'welcome.keyHint')

export const canSubmitPaste = computed(() => {
  if (pastePending()) return false
  if (!browserOnline()) return false
  return pasteDraft().trim() !== ''
}, 'welcome.canSubmitPaste')

export const pasteErrorText = computed(() => {
  const message = pasteError()
  if (!message) return null
  const left = busyCountdown()
  return left === null ? message : `${message} ${left}s`
}, 'welcome.pasteErrorText')
