import { formatContextLength, formatUsd } from '../money/format'
import type { ClassifyContext } from './types'

export const dailyFreeCapSentence =
  'Free models are also capped per day (50/day under 10 credits purchased, 1,000/day otherwise).'

export const privacyExcludeSentence =
  'Your privacy or routing settings may exclude all providers.'

export const tookTooLongSentence = 'The model took too long to respond.'

export const emptyReplySentence = 'The model returned an empty reply.'

export const cutOffSentence = 'Reply cut off at the length limit.'

export const connectionLostLabel = 'Connection lost'

export const webSearchZdrSentence =
  "Web search isn't available with zero data retention."

export const tooLargeSentence = 'This request is too large.'

export const creditsSentence = "You're out of OpenRouter credits."

export const paymentRequiredSentence = 'Payment required by OpenRouter.'

export const keyRejectedSentence = 'Your OpenRouter key was rejected.'

export const refused403Sentence = 'OpenRouter refused this request (403).'

const resetPhrase = (reset: string): string =>
  reset.startsWith('resets ') ? reset : `resets ${reset}`

export const spendingLimitSentence = (
  keyLimit: ClassifyContext['keyLimit'],
): string => {
  const limit = keyLimit?.limit ?? null
  const reset = keyLimit?.reset ?? null
  const amount = limit === null ? null : formatUsd(limit)
  const period = reset ? resetPhrase(reset) : null
  if (amount && period) {
    return `This key reached its spending limit (${amount}, ${period}).`
  }
  if (amount) return `This key reached its spending limit (${amount}).`
  if (period) return `This key reached its spending limit (${period}).`
  return 'This key reached its spending limit.'
}

export const inFlightSentence = (retryAfterSec: number | null): string =>
  retryAfterSec === null
    ? 'Too many requests in flight for your budget.'
    : `Too many requests in flight for your budget. Retry in ${retryAfterSec}s.`

export const rateLimitedTitle = (retryAfterSec: number | null): string =>
  retryAfterSec === null
    ? 'Rate limited.'
    : `Rate limited. Retry in ${retryAfterSec}s`

export const unavailableTitle = (modelName: string): string =>
  `${modelName} is unavailable right now.`

export const tooLongSentence = (context: ClassifyContext): string => {
  const input = formatContextLength(context.estimatedInputTokens)
  const limit =
    context.contextLength === null
      ? 'unknown'
      : formatContextLength(context.contextLength)
  return `This conversation is too long for ${context.modelName} (≈${input} of ${limit} tokens).`
}

export const unknownModelSentence = (modelId: string): string =>
  `OpenRouter doesn't know model \`${modelId}\`.`

export const rejectedRequestSentence = (
  message: string | null,
  attachmentName: string | null,
): string => {
  const text = (message ?? '').replace(/\.+$/, '').trim()
  const namesAttachment =
    attachmentName !== null && !text.includes(attachmentName)
  const detail = [namesAttachment ? attachmentName : null, text]
    .filter((part) => part)
    .join(' — ')
  return detail
    ? `OpenRouter rejected the request: ${detail}.`
    : 'OpenRouter rejected the request.'
}

export const parameterRejectedSentence = (
  modelName: string,
  parameter: string,
): string => `${modelName} rejected parameter ${parameter}.`

export const moderationSentence = (
  provider: string,
  reasons: string | null,
): string =>
  reasons
    ? `The request was blocked by ${provider}'s moderation: ${reasons}.`
    : `The request was blocked by ${provider}'s moderation.`

export const unknownCodeSentence = (code: number): string =>
  `Something went wrong (code ${code}).`

export const disconnectedSentence = (code: number | null): string =>
  code === null
    ? 'The provider disconnected mid-reply.'
    : `The provider disconnected mid-reply (${code}).`

export const emptyReasoningSentence = (
  modelName: string,
  reasoningTokens: number,
): string => {
  const count = Math.round(reasoningTokens).toLocaleString('en-US')
  return `${modelName} used its whole token budget on thinking (${count} reasoning tokens) and wrote no answer.`
}

export const refusedTitle = (provider: string | null): string =>
  `Refused by ${provider ?? 'the provider'}`
