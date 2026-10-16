import {
  connectionLostLabel,
  creditsSentence,
  cutOffSentence,
  dailyFreeCapSentence,
  disconnectedSentence,
  emptyReasoningSentence,
  emptyReplySentence,
  inFlightSentence,
  keyRejectedSentence,
  moderationSentence,
  parameterRejectedSentence,
  paymentRequiredSentence,
  privacyExcludeSentence,
  rateLimitedTitle,
  refused403Sentence,
  refusedTitle,
  rejectedRequestSentence,
  spendingLimitSentence,
  tooLargeSentence,
  tooLongSentence,
  tookTooLongSentence,
  unavailableTitle,
  unknownCodeSentence,
  unknownModelSentence,
  webSearchZdrSentence,
} from './copy'
import type {
  ClassifiableContext,
  ClassifiableFailure,
  ClassifiableStreamError,
} from './input'
import type {
  CompletionFailure,
  ErrorAction,
  ErrorActionId,
  ErrorInfo,
  ErrorKind,
} from './types'

const CONTEXT_CODES = [
  'context_length_exceeded',
  'max_tokens_exceeded',
  'token_limit_exceeded',
] as const

const PARAMETER_NAMES = [
  'temperature',
  'top_p',
  'max_tokens',
  'reasoning_effort',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'min_p',
  'top_k',
  'seed',
  'logit_bias',
] as const

type ParsedError = {
  code: number | null
  message: string | null
  metadata: Record<string, unknown>
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const parsePayload = (body: unknown): ParsedError => {
  let value = body
  if (typeof value === 'string') {
    const text = value
    try {
      value = JSON.parse(text) as unknown
    } catch {
      return { code: null, message: text, metadata: {} }
    }
  }
  const record = asRecord(value)
  if (!record) return { code: null, message: null, metadata: {} }
  const error = asRecord(record.error) ?? record
  const metadata = asRecord(error.metadata) ?? {}
  return {
    code: typeof error.code === 'number' ? error.code : null,
    message: typeof error.message === 'string' ? error.message : null,
    metadata,
  }
}

const metaString = (
  metadata: Record<string, unknown>,
  ...keys: string[]
): string | null => {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

const headerValue = (
  headers: Record<string, string>,
  name: string,
): string | null => {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && value !== '') return value
  }
  return null
}

const requestId = (headers: Record<string, string>): string | null =>
  headerValue(headers, 'request-id') ?? headerValue(headers, 'x-request-id')

const retryAfterSeconds = (raw: string | null): number | null => {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

const action = (
  id: ErrorActionId,
  label: string,
  extra?: Pick<ErrorAction, 'modelId' | 'disabled'>,
): ErrorAction => ({ id, label, ...extra })

const retryAction = (retryAfterSec: number | null): ErrorAction =>
  action(
    'retry',
    'Retry',
    retryAfterSec !== null && retryAfterSec > 0
      ? { disabled: true }
      : undefined,
  )

const detailsOf = (
  code: number | null,
  message: string | null,
  requestId: string | null,
): ErrorInfo['details'] => ({ code, message, requestId })

const card = (fields: {
  kind: ErrorKind
  code: number | null
  title: string
  sentence: string
  primary: ErrorAction | null
  secondary?: ErrorAction[]
  retryAfterSec?: number | null
  notice?: boolean
  details: ErrorInfo['details']
  suggestions?: ErrorInfo['suggestions']
  flaggedInput?: string
}): ErrorInfo => ({
  kind: fields.kind,
  code: fields.code,
  title: fields.title,
  sentence: fields.sentence,
  primary: fields.primary,
  secondary: fields.secondary ?? [],
  retryAfterSec: fields.retryAfterSec ?? null,
  notice: fields.notice ?? false,
  details: fields.details,
  ...(fields.suggestions ? { suggestions: fields.suggestions } : {}),
  ...(fields.flaggedInput ? { flaggedInput: fields.flaggedInput } : {}),
})

const sameLine = (
  kind: ErrorKind,
  text: string,
  primary: ErrorAction | null,
  code: number | null,
  parsed: ParsedError,
  headers: Record<string, string>,
  extra?: {
    secondary?: ErrorAction[]
    retryAfterSec?: number | null
    notice?: boolean
    suggestions?: ErrorInfo['suggestions']
    flaggedInput?: string
  },
): ErrorInfo =>
  card({
    kind,
    code,
    title: text,
    sentence: '',
    primary,
    secondary: extra?.secondary,
    retryAfterSec: extra?.retryAfterSec,
    notice: extra?.notice,
    details: detailsOf(code, parsed.message, requestId(headers)),
    suggestions: extra?.suggestions,
    flaggedInput: extra?.flaggedInput,
  })

const reasonsText = (metadata: Record<string, unknown>): string | null => {
  const value = metadata.reasons ?? metadata.reason
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!Array.isArray(value)) return null
  const parts = value.filter(
    (item): item is string =>
      typeof item === 'string' && item.trim().length > 0,
  )
  return parts.length > 0 ? parts.join(', ') : null
}

const errorType = (parsed: ParsedError): string =>
  metaString(parsed.metadata, 'error_type', 'errorType', 'type') ?? ''

const isContextTooLong = (parsed: ParsedError): boolean => {
  const blob = `${parsed.message ?? ''} ${errorType(parsed)}`
  return CONTEXT_CODES.some((code) => blob.includes(code))
}

const clearUnknownModelMessage = (message: string): boolean =>
  /unknown model|model not found|no such model|not a valid model|invalid model|\bmodel does not exist\b/i.test(
    message,
  )

const isDataPolicyMessage = (message: string): boolean =>
  /data policy|zero data retention|\bdata_collection\b/i.test(message)

const isUnknownModel = (
  parsed: ParsedError,
  context: ClassifiableContext,
  status: number,
): boolean => {
  if (namedParameter(parsed)) return false
  const message = parsed.message ?? ''
  if (isDataPolicyMessage(message)) return false
  if (context.modelInCatalog === true) return clearUnknownModelMessage(message)
  if (clearUnknownModelMessage(message)) return true
  if (errorType(parsed) === 'not_found') return true
  if (context.modelInCatalog === false && (status === 400 || status === 404))
    return true
  return status === 404
}

const mentionsZdr = (message: string): boolean =>
  /\bzdr\b|zero data retention/i.test(message)

const mentionsWebSearch = (message: string): boolean =>
  /web[_\s-]?search/i.test(message)

const isWebSearchZdr = (
  parsed: ParsedError,
  context: ClassifiableContext,
): boolean => {
  const message = parsed.message ?? ''
  if (
    mentionsZdr(message) &&
    (mentionsWebSearch(message) || context.webSearchOn)
  ) {
    return true
  }
  return mentionsWebSearch(message) && context.zdrOn
}

const namedParameter = (parsed: ParsedError): string | null => {
  const fromMetadata = metaString(
    parsed.metadata,
    'parameter',
    'param',
    'parameter_name',
    'parameterName',
  )
  if (fromMetadata) return fromMetadata
  const message = parsed.message ?? ''
  let found: { name: string; index: number } | null = null
  for (const name of PARAMETER_NAMES) {
    const match = new RegExp(`\\b${name}\\b`, 'i').exec(message)
    if (!match) continue
    if (found === null || match.index < found.index)
      found = { name, index: match.index }
  }
  return found?.name ?? null
}

const identifiesDailyFreeCap = (parsed: ParsedError): boolean => {
  const type =
    metaString(parsed.metadata, 'limit_type', 'limitType', 'quota') ?? ''
  return /\bdaily\b|per day|per-day|free-models-per-day/i.test(
    `${parsed.message ?? ''} ${type}`,
  )
}

const tookTooLong = (
  code: number | null,
  parsed: ParsedError,
  headers: Record<string, string>,
): ErrorInfo =>
  sameLine(
    'timeout',
    tookTooLongSentence,
    retryAction(null),
    code,
    parsed,
    headers,
  )

const rejectedKey = (
  parsed: ParsedError,
  headers: Record<string, string>,
): ErrorInfo =>
  sameLine(
    'auth-rejected',
    keyRejectedSentence,
    action('reconnect', 'Reconnect'),
    401,
    parsed,
    headers,
  )

const payment = (
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const source = metaString(parsed.metadata, 'limit_source', 'limitSource')
  if (source === 'openrouter_credits') {
    return sameLine(
      'out-of-credits',
      creditsSentence,
      action('add-credits', 'Add credits'),
      402,
      parsed,
      headers,
    )
  }
  if (source === 'openrouter_key_limit') {
    const text = spendingLimitSentence(context.keyLimit)
    return sameLine(
      'key-limit',
      text,
      action('raise-limit', 'Raise limit on OpenRouter'),
      402,
      parsed,
      headers,
    )
  }
  if (source === 'openrouter_in_flight_budget') {
    const wait = retryAfterSeconds(headerValue(headers, 'retry-after'))
    const text = inFlightSentence(wait)
    return sameLine(
      'in-flight-budget',
      text,
      retryAction(wait),
      402,
      parsed,
      headers,
      {
        retryAfterSec: wait,
      },
    )
  }
  return sameLine(
    'payment-required',
    paymentRequiredSentence,
    action('add-credits', 'Add credits'),
    402,
    parsed,
    headers,
    { secondary: [action('raise-limit', 'Raise limit on OpenRouter')] },
  )
}

const forbidden = (
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const reasons = reasonsText(parsed.metadata)
  const flagged =
    metaString(parsed.metadata, 'flagged_input', 'flaggedInput') ?? undefined
  if (reasons || flagged) {
    const provider =
      metaString(parsed.metadata, 'provider_name', 'providerName') ??
      context.provider ??
      'the provider'
    const text = moderationSentence(provider, reasons)
    return sameLine(
      'moderation',
      text,
      action('edit-message', 'Edit message'),
      403,
      parsed,
      headers,
      { flaggedInput: flagged },
    )
  }
  return sameLine('refused-403', refused403Sentence, null, 403, parsed, headers)
}

const rateLimited = (
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const wait = retryAfterSeconds(headerValue(headers, 'retry-after'))
  const title = rateLimitedTitle(wait)
  const sentence = identifiesDailyFreeCap(parsed) ? dailyFreeCapSentence : ''
  const secondary: ErrorAction[] = []
  if (context.modelId.endsWith(':free') && context.paidVariant) {
    secondary.push(
      action('use-paid', 'Use paid version', {
        modelId: context.paidVariant.id,
      }),
    )
  }
  return card({
    kind: 'rate-limited',
    code: 429,
    title,
    sentence,
    primary: retryAction(wait),
    secondary,
    retryAfterSec: wait,
    details: detailsOf(429, parsed.message, requestId(headers)),
  })
}

const fallbackAction = (context: ClassifiableContext): ErrorAction | null =>
  context.fallbackModel
    ? action('try-fallback', `Try ${context.fallbackModel.name}`, {
        modelId: context.fallbackModel.id,
      })
    : null

const unavailable = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const wait =
    status === 502 || status === 503 || status === 529
      ? retryAfterSeconds(headerValue(headers, 'retry-after'))
      : null
  const title = unavailableTitle(context.modelName)
  const excluded = context.privacyRestrictive || context.routingRestrictive
  const alternative =
    fallbackAction(context) ?? action('pick-model', 'Pick another model')
  const secondary: ErrorAction[] = []
  let primary: ErrorAction
  if (context.routingRestrictive) {
    primary = action('loosen-routing', 'Loosen routing')
    secondary.push(alternative)
  } else {
    primary = alternative
  }
  if (context.privacyRestrictive) {
    secondary.push(action('loosen-privacy', 'Loosen privacy for this chat'))
  }
  if (wait !== null) secondary.push(retryAction(wait))
  return card({
    kind: 'unavailable',
    code: status,
    title,
    sentence: excluded ? privacyExcludeSentence : '',
    primary,
    secondary,
    retryAfterSec: wait,
    details: detailsOf(status, parsed.message, requestId(headers)),
  })
}

const tooLong = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const suggestions = context.longerContextModels.slice(0, 3)
  const primary =
    suggestions.length > 0
      ? action('switch-longer-context', 'Switch to a longer-context model')
      : action('switch-longer-context', 'No larger-context model available', {
          disabled: true,
        })
  const text = tooLongSentence(context)
  return sameLine('context-too-long', text, primary, status, parsed, headers, {
    secondary: [action('new-chat-last-4', 'New chat with the last 4 messages')],
    suggestions,
  })
}

const withPrivacy = (context: ClassifiableContext): ClassifiableContext =>
  context.privacyRestrictive
    ? context
    : { ...context, privacyRestrictive: true }

const unknownModelCard = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo =>
  sameLine(
    'unknown-model',
    unknownModelSentence(context.modelId),
    action('pick-model', 'Pick another model'),
    status,
    parsed,
    headers,
  )

const webSearchZdrCard = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
): ErrorInfo =>
  sameLine(
    'web-search-zdr',
    webSearchZdrSentence,
    action('send-without-web-search', 'Send without web search'),
    status,
    parsed,
    headers,
  )

const parameterCard = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
  parameter: string,
): ErrorInfo =>
  sameLine(
    'param-rejected',
    parameterRejectedSentence(context.modelName, parameter),
    action('reset-params-retry', 'Reset parameters and retry'),
    status,
    parsed,
    headers,
  )

const badRequest = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const message = parsed.message ?? ''
  if (isContextTooLong(parsed)) return tooLong(status, parsed, headers, context)
  if (isWebSearchZdr(parsed, context))
    return webSearchZdrCard(status, parsed, headers)
  if (isDataPolicyMessage(message)) {
    return unavailable(status, parsed, headers, withPrivacy(context))
  }
  if (status === 404 && context.routingRestrictive) {
    return unavailable(status, parsed, headers, context)
  }
  const parameter = namedParameter(parsed)
  if (parameter)
    return parameterCard(status, parsed, headers, context, parameter)
  if (isUnknownModel(parsed, context, status)) {
    return unknownModelCard(status, parsed, headers, context)
  }
  if (
    status === 404 &&
    (context.privacyRestrictive || context.zdrOn) &&
    context.modelInCatalog !== false
  ) {
    return unavailable(status, parsed, headers, withPrivacy(context))
  }
  if (status === 404) return unavailable(status, parsed, headers, context)
  return sameLine(
    'bad-request',
    rejectedRequestSentence(parsed.message, context.attachmentName),
    action('edit-message', 'Edit message'),
    status,
    parsed,
    headers,
  )
}

const tooLarge = (
  parsed: ParsedError,
  headers: Record<string, string>,
): ErrorInfo =>
  sameLine(
    'too-large',
    tooLargeSentence,
    action('edit-message', 'Edit message'),
    413,
    parsed,
    headers,
  )

const unknownStatus = (
  status: number,
  parsed: ParsedError,
  headers: Record<string, string>,
): ErrorInfo =>
  sameLine(
    'unknown',
    unknownCodeSentence(status),
    retryAction(null),
    status,
    parsed,
    headers,
  )

const classifyStatus = (
  status: number,
  body: unknown,
  headers: Record<string, string>,
  context: ClassifiableContext,
): ErrorInfo => {
  const parsed = parsePayload(body)
  switch (status) {
    case 401:
      return rejectedKey(parsed, headers)
    case 402:
      return payment(parsed, headers, context)
    case 403:
      return forbidden(parsed, headers, context)
    case 408:
    case 504:
    case 524:
      return tookTooLong(status, parsed, headers)
    case 429:
      return rateLimited(parsed, headers, context)
    case 413:
      return tooLarge(parsed, headers)
    case 502:
    case 503:
    case 529:
      return unavailable(status, parsed, headers, context)
    case 400:
    case 404:
      return badRequest(status, parsed, headers, context)
    default:
      return unknownStatus(status, parsed, headers)
  }
}

const streamHeaders = (
  failure: ClassifiableStreamError,
): Record<string, string> => {
  const metadata = failure.metadata ?? {}
  const retryAfter = metadata.retry_after ?? metadata.retryAfter
  if (typeof retryAfter !== 'number' && typeof retryAfter !== 'string')
    return {}
  return { 'retry-after': String(retryAfter) }
}

const hadStreamContent = (
  failure: ClassifiableStreamError,
  context: ClassifiableContext,
): boolean =>
  failure.contentReceived === true || context.contentReceived === true

const classifyStream = (
  failure: ClassifiableStreamError,
  context: ClassifiableContext,
): ErrorInfo => {
  const disconnectCode =
    failure.code === null ||
    failure.code === 502 ||
    failure.code === 503 ||
    failure.code === 529
  if (disconnectCode && hadStreamContent(failure, context)) {
    const text = disconnectedSentence(failure.code)
    return card({
      kind: 'provider-disconnected',
      code: failure.code,
      title: text,
      sentence: '',
      primary: retryAction(null),
      details: detailsOf(failure.code, failure.message, null),
    })
  }
  if (failure.code === null) {
    return card({
      kind: 'provider-disconnected',
      code: null,
      title: 'The provider disconnected.',
      sentence: '',
      primary: retryAction(null),
      details: detailsOf(null, failure.message, null),
    })
  }
  const metadata = failure.metadata ?? {}
  return classifyStatus(
    failure.code,
    {
      error: {
        code: failure.code,
        message: failure.message,
        metadata,
      },
    },
    streamHeaders(failure),
    context,
  )
}

const emptyReasoning = (
  context: ClassifiableContext,
  reasoningTokens: number,
): ErrorInfo => {
  const text = emptyReasoningSentence(context.modelName, reasoningTokens)
  const actions: ErrorAction[] = []
  if (context.effortSupported) {
    actions.push(action('retry-lower-effort', 'Retry with lower effort'))
  }
  if (context.maxTokensSet) {
    actions.push(
      action('retry-higher-max-tokens', 'Retry with higher max tokens'),
    )
  }
  if (actions.length === 0) actions.push(retryAction(null))
  const [primary, ...secondary] = actions
  return card({
    kind: 'empty-reasoning',
    code: null,
    title: text,
    sentence: '',
    primary: primary ?? null,
    secondary,
    notice: true,
    details: detailsOf(null, null, null),
  })
}

const refusal = (
  context: ClassifiableContext,
  text: string | null,
): ErrorInfo =>
  card({
    kind: 'refusal',
    code: null,
    title: refusedTitle(context.provider),
    sentence: text ?? 'The model refused this request.',
    primary: action('edit-message', 'Edit message'),
    notice: true,
    details: detailsOf(null, text, null),
  })

const classifyFinish = (
  failure: Extract<CompletionFailure, { source: 'finish' }>,
  context: ClassifiableContext,
): ErrorInfo | null => {
  if (failure.finishReason === 'content_filter' || failure.refusal) {
    return refusal(context, failure.refusal)
  }
  if (failure.finishReason === 'stop' && failure.hasContent) return null
  if (failure.finishReason === 'length' && failure.hasContent) {
    return card({
      kind: 'cut-off',
      code: null,
      title: cutOffSentence,
      sentence: '',
      primary: retryAction(null),
      notice: true,
      details: detailsOf(null, null, null),
    })
  }
  if (
    failure.finishReason === 'length' &&
    !failure.hasContent &&
    failure.reasoningTokens > 0
  ) {
    return emptyReasoning(context, failure.reasoningTokens)
  }
  return card({
    kind: 'empty-reply',
    code: null,
    title: emptyReplySentence,
    sentence: '',
    primary: retryAction(null),
    notice: true,
    details: detailsOf(null, null, null),
  })
}

const connectionLost = (): ErrorInfo =>
  card({
    kind: 'connection-lost',
    code: null,
    title: connectionLostLabel,
    sentence: '',
    primary: retryAction(null),
    notice: true,
    details: detailsOf(null, null, null),
  })

export const classifyFailure = (
  failure: ClassifiableFailure,
  context: ClassifiableContext,
): ErrorInfo | null => {
  switch (failure.source) {
    case 'finish':
      return classifyFinish(failure, context)
    case 'network':
      return connectionLost()
    case 'timeout':
      return tookTooLong(null, { code: null, message: null, metadata: {} }, {})
    case 'stream-error':
      return classifyStream(failure, context)
    case 'http':
      return classifyStatus(
        failure.status,
        failure.body,
        failure.headers,
        context,
      )
  }
}
