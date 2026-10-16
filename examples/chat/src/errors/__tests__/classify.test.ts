import {
  ConnectionError,
  OpenRouterDefaultError,
  OpenRouterError,
  PaymentRequiredResponseError,
  RequestAbortedError,
  RequestTimeoutError,
  SDKValidationError,
  UnauthorizedResponseError,
} from '@openrouter/sdk/models/errors'
import { expect, test, vi } from 'vitest'

import { classifyFailure, fromSdkError, fromStreamErrorChunk } from '../index'
import type {
  ClassifyContext,
  CompletionFailure,
  ErrorAction,
  ErrorInfo,
  ErrorKind,
} from '../types'

type ClassifiableContext = ClassifyContext & {
  contentReceived?: boolean
  modelInCatalog?: boolean
}
type ClassifiableFailure =
  | Exclude<CompletionFailure, { source: 'stream-error' }>
  | (Extract<CompletionFailure, { source: 'stream-error' }> & {
      contentReceived?: boolean
    })

const context = (
  patch: Partial<ClassifiableContext> = {},
): ClassifiableContext => ({
  modelId: 'anthropic/claude-sonnet-4.5',
  modelName: 'Claude Sonnet 4.5',
  provider: 'Anthropic',
  paidVariant: null,
  fallbackModel: null,
  longerContextModels: [],
  privacyRestrictive: false,
  routingRestrictive: false,
  keyLimit: null,
  estimatedInputTokens: 210_000,
  contextLength: 128_000,
  effortSupported: false,
  maxTokensSet: false,
  webSearchOn: false,
  zdrOn: false,
  attachmentName: null,
  ...patch,
})

const http = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): CompletionFailure => ({
  source: 'http',
  status,
  body,
  headers,
})

const wire = (
  message: string,
  metadata?: Record<string, unknown>,
  code?: number,
) => ({
  error: {
    code,
    message,
    ...(metadata ? { metadata } : {}),
  },
})

const retry = (disabled?: boolean): ErrorAction => ({
  id: 'retry',
  label: 'Retry',
  ...(disabled ? { disabled: true } : {}),
})

type Row = {
  name: string
  failure: ClassifiableFailure
  context?: Partial<ClassifiableContext>
  kind: ErrorKind
  title: string
  sentence: string
  primary: ErrorAction | null
  retryAfterSec: number | null
  notice: boolean
  secondary?: ErrorAction[]
  flaggedInput?: string
  suggestions?: ErrorInfo['suggestions']
}

const longer = [
  {
    id: 'google/gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    contextLength: 1_000_000,
  },
  { id: 'openai/gpt-4o', name: 'GPT-4o', contextLength: 128_000 },
  { id: 'meta/llama-3.1-405b', name: 'Llama 3.1 405B', contextLength: 128_000 },
  { id: 'extra/fourth', name: 'Fourth', contextLength: 200_000 },
]

const rows: Row[] = [
  {
    name: 'F-17 401: Your OpenRouter key was rejected.',
    failure: http(401, wire('User not found.', undefined, 401), {
      'request-id': 'req-401',
    }),
    kind: 'auth-rejected',
    title: 'Your OpenRouter key was rejected.',
    sentence: '',
    primary: { id: 'reconnect', label: 'Reconnect' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: "F-17 402 openrouter_credits: You're out of OpenRouter credits.",
    failure: http(
      402,
      wire('Insufficient credits', { limit_source: 'openrouter_credits' }, 402),
      { 'retry-after': '30' },
    ),
    kind: 'out-of-credits',
    title: "You're out of OpenRouter credits.",
    sentence: '',
    primary: { id: 'add-credits', label: 'Add credits' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17 402 openrouter_key_limit: spending limit from GET /key',
    failure: http(
      402,
      wire('Key limit exceeded', { limit_source: 'openrouter_key_limit' }, 402),
    ),
    context: { keyLimit: { limit: 10, reset: 'monthly' } },
    kind: 'key-limit',
    title: 'This key reached its spending limit ($10.00, resets monthly).',
    sentence: '',
    primary: { id: 'raise-limit', label: 'Raise limit on OpenRouter' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17 402 openrouter_in_flight_budget: Retry in 12s',
    failure: http(
      402,
      wire(
        'In-flight budget',
        { limit_source: 'openrouter_in_flight_budget' },
        402,
      ),
      { 'Retry-After': '12' },
    ),
    kind: 'in-flight-budget',
    title: 'Too many requests in flight for your budget. Retry in 12s.',
    sentence: '',
    primary: retry(true),
    retryAfterSec: 12,
    notice: false,
  },
  {
    name: 'F-17 402 in-flight budget enables Retry at 0',
    failure: http(
      402,
      wire(
        'In-flight budget',
        { limitSource: 'openrouter_in_flight_budget' },
        402,
      ),
      { 'retry-after': '0' },
    ),
    kind: 'in-flight-budget',
    title: 'Too many requests in flight for your budget. Retry in 0s.',
    sentence: '',
    primary: retry(),
    retryAfterSec: 0,
    notice: false,
  },
  {
    name: 'F-17 402 without limit_source: Payment required by OpenRouter.',
    failure: http(402, wire('Payment required', undefined, 402)),
    kind: 'payment-required',
    title: 'Payment required by OpenRouter.',
    sentence: '',
    primary: { id: 'add-credits', label: 'Add credits' },
    secondary: [{ id: 'raise-limit', label: 'Raise limit on OpenRouter' }],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17 403 moderation: blocked by provider, Edit message, no Retry',
    failure: http(
      403,
      wire(
        'flagged',
        {
          reasons: ['violence', 'self-harm'],
          flagged_input: 'a flagged excerpt',
          provider_name: 'Anthropic',
        },
        403,
      ),
    ),
    kind: 'moderation',
    title:
      "The request was blocked by Anthropic's moderation: violence, self-harm.",
    sentence: '',
    primary: { id: 'edit-message', label: 'Edit message' },
    retryAfterSec: null,
    notice: false,
    flaggedInput: 'a flagged excerpt',
  },
  {
    name: 'F-17 403 without reasons or flagged_input',
    failure: http(403, wire('Forbidden', undefined, 403)),
    kind: 'refused-403',
    title: 'OpenRouter refused this request (403).',
    sentence: '',
    primary: null,
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b 408: The model took too long to respond.',
    failure: http(408, wire('Request timed out', undefined, 408)),
    kind: 'timeout',
    title: 'The model took too long to respond.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b 504: The model took too long to respond.',
    failure: http(504, wire('Gateway timeout', undefined, 504)),
    kind: 'timeout',
    title: 'The model took too long to respond.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b 524: The model took too long to respond.',
    failure: http(524, wire('Edge timeout', undefined, 524)),
    kind: 'timeout',
    title: 'The model took too long to respond.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b client timeout: The model took too long to respond.',
    failure: { source: 'timeout' },
    kind: 'timeout',
    title: 'The model took too long to respond.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b 429: Rate limited. Retry in 23s',
    failure: http(429, wire('Provider rate limit exceeded', undefined, 429), {
      'retry-after': '23',
    }),
    kind: 'rate-limited',
    title: 'Rate limited. Retry in 23s',
    sentence: '',
    primary: retry(true),
    retryAfterSec: 23,
    notice: false,
  },
  {
    name: 'F-17b 429 daily free-model cap adds the quota sentence',
    failure: http(
      429,
      wire('You hit the daily free-model cap', { limit_type: 'daily' }, 429),
      { 'retry-after': '23' },
    ),
    kind: 'rate-limited',
    title: 'Rate limited. Retry in 23s',
    sentence:
      'Free models are also capped per day (50/day under 10 credits purchased, 1,000/day otherwise).',
    primary: retry(true),
    retryAfterSec: 23,
    notice: false,
  },
  {
    name: 'F-17b 429 on a :free model offers Use paid version',
    failure: http(429, wire('Rate limit exceeded', undefined, 429), {
      'retry-after': '23',
    }),
    context: {
      modelId: 'meta/llama-3.1-8b:free',
      modelName: 'Llama 3.1 8B (free)',
      paidVariant: { id: 'meta/llama-3.1-8b', name: 'Llama 3.1 8B' },
    },
    kind: 'rate-limited',
    title: 'Rate limited. Retry in 23s',
    sentence: '',
    primary: retry(true),
    secondary: [
      {
        id: 'use-paid',
        label: 'Use paid version',
        modelId: 'meta/llama-3.1-8b',
      },
    ],
    retryAfterSec: 23,
    notice: false,
  },
  {
    name: 'F-17b 502: model is unavailable, Try fallback, Retry-After honored',
    failure: http(502, wire('Bad gateway', undefined, 502), {
      'retry-after': '8',
    }),
    context: {
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: '',
    primary: {
      id: 'try-fallback',
      label: 'Try GPT-4o mini',
      modelId: 'openai/gpt-4o-mini',
    },
    secondary: [retry(true)],
    retryAfterSec: 8,
    notice: false,
  },
  {
    name: 'F-17b 503: model is unavailable right now.',
    failure: http(503, wire('No provider', undefined, 503)),
    context: {
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: '',
    primary: {
      id: 'try-fallback',
      label: 'Try GPT-4o mini',
      modelId: 'openai/gpt-4o-mini',
    },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b 529: model is unavailable right now.',
    failure: http(529, wire('Overloaded', undefined, 529)),
    context: {
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: '',
    primary: {
      id: 'try-fallback',
      label: 'Try GPT-4o mini',
      modelId: 'openai/gpt-4o-mini',
    },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b privacy or routing may exclude all providers',
    failure: http(503, wire('No allowed providers', undefined, 503)),
    context: {
      privacyRestrictive: true,
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: 'Your privacy or routing settings may exclude all providers.',
    primary: {
      id: 'try-fallback',
      label: 'Try GPT-4o mini',
      modelId: 'openai/gpt-4o-mini',
    },
    secondary: [
      { id: 'loosen-privacy', label: 'Loosen privacy for this chat' },
    ],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-19b 503 routing: Loosen routing is the primary action',
    failure: http(503, wire('No provider matches routing', undefined, 503)),
    context: {
      routingRestrictive: true,
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: 'Your privacy or routing settings may exclude all providers.',
    primary: { id: 'loosen-routing', label: 'Loosen routing' },
    secondary: [
      {
        id: 'try-fallback',
        label: 'Try GPT-4o mini',
        modelId: 'openai/gpt-4o-mini',
      },
    ],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17b no fallback model: Pick another model',
    failure: http(503, wire('Unavailable', undefined, 503)),
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: '',
    primary: { id: 'pick-model', label: 'Pick another model' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c context_length_exceeded',
    failure: http(
      400,
      wire(
        'Context length exceeded',
        { error_type: 'context_length_exceeded' },
        400,
      ),
    ),
    context: { longerContextModels: longer },
    kind: 'context-too-long',
    title:
      'This conversation is too long for Claude Sonnet 4.5 (≈210k of 128k tokens).',
    sentence: '',
    primary: {
      id: 'switch-longer-context',
      label: 'Switch to a longer-context model',
    },
    secondary: [
      { id: 'new-chat-last-4', label: 'New chat with the last 4 messages' },
    ],
    suggestions: longer.slice(0, 3),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c max_tokens_exceeded',
    failure: http(
      400,
      wire('max tokens', { errorType: 'max_tokens_exceeded' }, 400),
    ),
    kind: 'context-too-long',
    title:
      'This conversation is too long for Claude Sonnet 4.5 (≈210k of 128k tokens).',
    sentence: '',
    primary: {
      id: 'switch-longer-context',
      label: 'No larger-context model available',
      disabled: true,
    },
    secondary: [
      { id: 'new-chat-last-4', label: 'New chat with the last 4 messages' },
    ],
    suggestions: [],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c token_limit_exceeded',
    failure: http(400, wire('token_limit_exceeded', undefined, 400)),
    context: {
      longerContextModels: [
        {
          id: 'google/gemini-2.5-flash',
          name: 'Gemini 2.5 Flash',
          contextLength: 1_000_000,
        },
      ],
    },
    kind: 'context-too-long',
    title:
      'This conversation is too long for Claude Sonnet 4.5 (≈210k of 128k tokens).',
    sentence: '',
    primary: {
      id: 'switch-longer-context',
      label: 'Switch to a longer-context model',
    },
    secondary: [
      { id: 'new-chat-last-4', label: 'New chat with the last 4 messages' },
    ],
    suggestions: [
      {
        id: 'google/gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        contextLength: 1_000_000,
      },
    ],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c 400 unknown model',
    failure: http(
      400,
      wire('No such model openai/missing', { error_type: 'not_found' }, 400),
    ),
    context: { modelId: 'openai/missing', modelName: 'openai/missing' },
    kind: 'unknown-model',
    title: "OpenRouter doesn't know model `openai/missing`.",
    sentence: '',
    primary: { id: 'pick-model', label: 'Pick another model' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c 404 unknown model',
    failure: http(404, wire('Model not found', undefined, 404)),
    context: { modelId: 'openai/missing', modelName: 'openai/missing' },
    kind: 'unknown-model',
    title: "OpenRouter doesn't know model `openai/missing`.",
    sentence: '',
    primary: { id: 'pick-model', label: 'Pick another model' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c other 400: OpenRouter rejected the request',
    failure: http(400, wire('Missing messages', undefined, 400)),
    kind: 'bad-request',
    title: 'OpenRouter rejected the request: Missing messages.',
    sentence: '',
    primary: { id: 'edit-message', label: 'Edit message' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c 413: This request is too large.',
    failure: http(413, wire('Payload too large', undefined, 413)),
    kind: 'too-large',
    title: 'This request is too large.',
    sentence: '',
    primary: { id: 'edit-message', label: 'Edit message' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c unknown code never shows Provider returned error alone',
    failure: http(500, wire('Provider returned error', undefined, 500), {
      'request-id': 'req-500',
    }),
    kind: 'unknown',
    title: 'Something went wrong (code 500).',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-16 400 rejected parameter',
    failure: http(
      400,
      wire('Unsupported parameter: temperature', undefined, 400),
    ),
    kind: 'param-rejected',
    title: 'Claude Sonnet 4.5 rejected parameter temperature.',
    sentence: '',
    primary: { id: 'reset-params-retry', label: 'Reset parameters and retry' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: "F-21 Web search isn't available with zero data retention.",
    failure: http(
      400,
      wire(
        'Web search cannot be used with zero data retention',
        undefined,
        400,
      ),
    ),
    context: { webSearchOn: true, zdrOn: true },
    kind: 'web-search-zdr',
    title: "Web search isn't available with zero data retention.",
    sentence: '',
    primary: {
      id: 'send-without-web-search',
      label: 'Send without web search',
    },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 mid-stream 402 uses the credits card, not Connection lost',
    failure: {
      source: 'stream-error',
      code: 402,
      message: 'Insufficient credits',
      metadata: { limit_source: 'openrouter_credits' },
    },
    kind: 'out-of-credits',
    title: "You're out of OpenRouter credits.",
    sentence: '',
    primary: { id: 'add-credits', label: 'Add credits' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 error-only 200 with 401 is the auth card, not an empty reply',
    failure: {
      source: 'stream-error',
      code: 401,
      message: 'User not found.',
    },
    kind: 'auth-rejected',
    title: 'Your OpenRouter key was rejected.',
    sentence: '',
    primary: { id: 'reconnect', label: 'Reconnect' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 mid-stream 502: The provider disconnected mid-reply (502).',
    failure: {
      source: 'stream-error',
      code: 502,
      message: 'Provider disconnected',
      metadata: { error_type: 'server' },
      contentReceived: true,
    },
    kind: 'provider-disconnected',
    title: 'The provider disconnected mid-reply (502).',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 mid-stream 503: The provider disconnected mid-reply (503).',
    failure: {
      source: 'stream-error',
      code: 503,
      message: 'Provider overloaded',
      contentReceived: true,
    },
    kind: 'provider-disconnected',
    title: 'The provider disconnected mid-reply (503).',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 mid-stream 529: The provider disconnected mid-reply (529).',
    failure: {
      source: 'stream-error',
      code: 529,
      message: 'Overloaded',
      contentReceived: true,
    },
    kind: 'provider-disconnected',
    title: 'The provider disconnected mid-reply (529).',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 mid-stream error with no code: provider disconnected',
    failure: {
      source: 'stream-error',
      code: null,
      message: 'stream died',
      contentReceived: true,
    },
    kind: 'provider-disconnected',
    title: 'The provider disconnected mid-reply.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 empty content, length, reasoning tokens',
    failure: {
      source: 'finish',
      finishReason: 'length',
      hasContent: false,
      reasoningTokens: 3900,
      refusal: null,
    },
    context: { effortSupported: true, maxTokensSet: true },
    kind: 'empty-reasoning',
    title:
      'Claude Sonnet 4.5 used its whole token budget on thinking (3,900 reasoning tokens) and wrote no answer.',
    sentence: '',
    primary: { id: 'retry-lower-effort', label: 'Retry with lower effort' },
    secondary: [
      { id: 'retry-higher-max-tokens', label: 'Retry with higher max tokens' },
    ],
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-18 empty reasoning omits effort when the model has none',
    failure: {
      source: 'finish',
      finishReason: 'length',
      hasContent: false,
      reasoningTokens: 3900,
      refusal: null,
    },
    context: { effortSupported: false, maxTokensSet: true },
    kind: 'empty-reasoning',
    title:
      'Claude Sonnet 4.5 used its whole token budget on thinking (3,900 reasoning tokens) and wrote no answer.',
    sentence: '',
    primary: {
      id: 'retry-higher-max-tokens',
      label: 'Retry with higher max tokens',
    },
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-18 empty content, stop, no reasoning tokens',
    failure: {
      source: 'finish',
      finishReason: 'stop',
      hasContent: false,
      reasoningTokens: 0,
      refusal: null,
    },
    kind: 'empty-reply',
    title: 'The model returned an empty reply.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-18 length with content: Reply cut off at the length limit.',
    failure: {
      source: 'finish',
      finishReason: 'length',
      hasContent: true,
      reasoningTokens: 0,
      refusal: null,
    },
    kind: 'cut-off',
    title: 'Reply cut off at the length limit.',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-18 content_filter: Refused by provider, with Edit',
    failure: {
      source: 'finish',
      finishReason: 'content_filter',
      hasContent: false,
      reasoningTokens: 0,
      refusal: 'I cannot help with that.',
    },
    kind: 'refusal',
    title: 'Refused by Anthropic',
    sentence: 'I cannot help with that.',
    primary: { id: 'edit-message', label: 'Edit message' },
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-18 message.refusal on a stop finish',
    failure: {
      source: 'finish',
      finishReason: 'stop',
      hasContent: true,
      reasoningTokens: 0,
      refusal: 'I cannot help with that.',
    },
    kind: 'refusal',
    title: 'Refused by Anthropic',
    sentence: 'I cannot help with that.',
    primary: { id: 'edit-message', label: 'Edit message' },
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-18 network drop: Connection lost',
    failure: { source: 'network' },
    kind: 'connection-lost',
    title: 'Connection lost',
    sentence: '',
    primary: retry(),
    retryAfterSec: null,
    notice: true,
  },
  {
    name: 'F-17b 404 data policy on a known model is the privacy card',
    failure: http(
      404,
      wire('No endpoints found matching your data policy', undefined, 404),
    ),
    context: {
      modelId: 'openai/gpt-4o-mini',
      modelName: 'GPT-4o mini',
      zdrOn: true,
      privacyRestrictive: true,
      modelInCatalog: true,
    },
    kind: 'unavailable',
    title: 'GPT-4o mini is unavailable right now.',
    sentence: 'Your privacy or routing settings may exclude all providers.',
    primary: { id: 'pick-model', label: 'Pick another model' },
    secondary: [
      { id: 'loosen-privacy', label: 'Loosen privacy for this chat' },
    ],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-21 404 web search rejected under ZDR',
    failure: http(
      404,
      wire(
        'Web search cannot be used with zero data retention',
        undefined,
        404,
      ),
    ),
    context: {
      modelId: 'openai/gpt-4o-mini',
      modelName: 'GPT-4o mini',
      webSearchOn: true,
      zdrOn: true,
      modelInCatalog: true,
    },
    kind: 'web-search-zdr',
    title: "Web search isn't available with zero data retention.",
    sentence: '',
    primary: {
      id: 'send-without-web-search',
      label: 'Send without web search',
    },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-18 error-only 503 is the unavailable card, not mid-reply',
    failure: {
      source: 'stream-error',
      code: 503,
      message: 'No provider available',
      metadata: { retry_after: 5 },
      contentReceived: false,
    },
    context: {
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: '',
    primary: {
      id: 'try-fallback',
      label: 'Try GPT-4o mini',
      modelId: 'openai/gpt-4o-mini',
    },
    secondary: [retry(true)],
    retryAfterSec: 5,
    notice: false,
  },
  {
    name: 'F-17b 429 free-models-per-min does not add the daily cap sentence',
    failure: http(429, wire('free-models-per-min', undefined, 429), {
      'retry-after': '20',
    }),
    kind: 'rate-limited',
    title: 'Rate limited. Retry in 20s',
    sentence: '',
    primary: retry(true),
    retryAfterSec: 20,
    notice: false,
  },
  {
    name: 'F-16 parameter temperature does not exist is not an unknown model',
    failure: http(
      400,
      wire(
        'parameter temperature does not exist for this model',
        { error_type: 'not_found' },
        400,
      ),
    ),
    kind: 'param-rejected',
    title: 'Claude Sonnet 4.5 rejected parameter temperature.',
    sentence: '',
    primary: { id: 'reset-params-retry', label: 'Reset parameters and retry' },
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-19b 404 routingRestrictive: Loosen routing',
    failure: http(404, wire('Not Found', undefined, 404)),
    context: {
      routingRestrictive: true,
      fallbackModel: { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
    },
    kind: 'unavailable',
    title: 'Claude Sonnet 4.5 is unavailable right now.',
    sentence: 'Your privacy or routing settings may exclude all providers.',
    primary: { id: 'loosen-routing', label: 'Loosen routing' },
    secondary: [
      {
        id: 'try-fallback',
        label: 'Try GPT-4o mini',
        modelId: 'openai/gpt-4o-mini',
      },
    ],
    retryAfterSec: null,
    notice: false,
  },
  {
    name: 'F-17c known catalog model 404 is not an unknown-model card',
    failure: http(404, wire('Not Found', undefined, 404)),
    context: {
      modelId: 'openai/gpt-4o-mini',
      modelName: 'GPT-4o mini',
      modelInCatalog: true,
    },
    kind: 'unavailable',
    title: 'GPT-4o mini is unavailable right now.',
    sentence: '',
    primary: { id: 'pick-model', label: 'Pick another model' },
    retryAfterSec: null,
    notice: false,
  },
]

test.each(rows)('$name', (row) => {
  const info = classifyFailure(row.failure, context(row.context))
  expect(info).not.toBeNull()
  if (!info) return
  expect(info.kind).toBe(row.kind)
  expect(info.title).toBe(row.title)
  expect(info.sentence).toBe(row.sentence)
  expect(info.primary).toEqual(row.primary)
  expect(info.retryAfterSec).toBe(row.retryAfterSec)
  expect(info.notice).toBe(row.notice)
  expect(info.secondary).toEqual(row.secondary ?? [])
  if (row.flaggedInput) expect(info.flaggedInput).toBe(row.flaggedInput)
  if (row.suggestions !== undefined)
    expect(info.suggestions).toEqual(row.suggestions)
  expect(info.sentence).not.toBe('Provider returned error')
  expect(info.title).not.toBe('Provider returned error')
  const actionIds = [info.primary, ...info.secondary].flatMap((action) =>
    action ? [action.id] : [],
  )
  if (row.kind === 'moderation' || row.kind === 'too-large') {
    expect(actionIds).not.toContain('retry')
  }
})

test('F-18 normal stop with content is not an error', () => {
  expect(
    classifyFailure(
      {
        source: 'finish',
        finishReason: 'stop',
        hasContent: true,
        reasoningTokens: 12,
        refusal: null,
      },
      context(),
    ),
  ).toBeNull()
})

test('F-17 429 without a daily-cap signal quotes the raw message in Details', () => {
  const info = classifyFailure(
    http(429, wire('Provider rate limit exceeded', undefined, 429), {
      'retry-after': '23',
      'request-id': 'req-429',
    }),
    context(),
  )
  expect(info?.sentence).not.toContain('Free models are also capped')
  expect(info?.details).toEqual({
    code: 429,
    message: 'Provider rate limit exceeded',
    requestId: 'req-429',
  })
})

test('F-17 moderation with only flagged_input still edits and does not retry', () => {
  const info = classifyFailure(
    http(
      403,
      wire('blocked', { flaggedInput: 'excerpt under 100 chars' }, 403),
    ),
    context({ provider: null }),
  )
  expect(info?.kind).toBe('moderation')
  expect(info?.flaggedInput).toBe('excerpt under 100 chars')
  expect(info?.primary).toEqual({ id: 'edit-message', label: 'Edit message' })
  expect(info?.secondary.map((action) => action.id)).not.toContain('retry')
})

test('classifyFailure is pure', () => {
  const failure = http(401, wire('User not found.', undefined, 401))
  const input = context()
  const before = JSON.stringify({ failure, input })
  const first = classifyFailure(failure, input)
  const second = classifyFailure(failure, input)
  expect(JSON.stringify({ failure, input })).toBe(before)
  expect(second).toEqual(first)
})

const sdkHttpError = <T>(
  Ctor: new (
    err: T,
    httpMeta: { response: Response; request: Request; body: string },
  ) => Error,
  status: number,
  err: T,
  headers: Record<string, string>,
) => {
  const body = JSON.stringify(err)
  return new Ctor(err, {
    response: new Response(body, { status, headers }),
    request: new Request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
    }),
    body,
  })
}

test('fromSdkError maps RequestAbortedError to aborted', () => {
  expect(fromSdkError(new RequestAbortedError('stopped'))).toBe('aborted')
})

test('fromSdkError maps ConnectionError to network', () => {
  expect(fromSdkError(new ConnectionError('failed to fetch'))).toEqual({
    source: 'network',
  })
})

test('fromSdkError maps RequestTimeoutError to timeout', () => {
  expect(fromSdkError(new RequestTimeoutError('timed out'))).toEqual({
    source: 'timeout',
  })
})

test('fromSdkError maps UnauthorizedResponseError status, body, and headers', () => {
  const error = sdkHttpError(
    UnauthorizedResponseError,
    401,
    { error: { code: 401, message: 'User not found.' } },
    { 'request-id': 'req-auth', 'retry-after': '9' },
  )
  const failure = fromSdkError(error)
  expect(failure).toMatchObject({
    source: 'http',
    status: 401,
    headers: { 'request-id': 'req-auth', 'retry-after': '9' },
  })
  if (failure === 'aborted' || failure.source !== 'http') return
  const info = classifyFailure(failure, context())
  expect(info?.title).toBe('Your OpenRouter key was rejected.')
  expect(info?.details.requestId).toBe('req-auth')
})

test('fromSdkError keeps 402 limit_source metadata for classification', () => {
  const error = sdkHttpError(
    PaymentRequiredResponseError,
    402,
    {
      error: {
        code: 402,
        message: 'Insufficient credits',
        metadata: { limit_source: 'openrouter_credits' },
      },
    },
    {},
  )
  const failure = fromSdkError(error)
  if (failure === 'aborted' || failure.source !== 'http') {
    throw new Error('expected an http failure')
  }
  expect(classifyFailure(failure, context())?.kind).toBe('out-of-credits')
})

test('fromSdkError maps SDKValidationError raw limit_source to the key-limit card', () => {
  const raw = {
    provider: 'Anthropic',
    error: {
      code: 402,
      message: 'Key limit exceeded',
      metadata: { limit_source: 'openrouter_key_limit' },
    },
  }
  const failure = fromSdkError(new SDKValidationError('zod', null, raw))
  expect(failure).toMatchObject({
    source: 'stream-error',
    code: 402,
    metadata: {
      limit_source: 'openrouter_key_limit',
      provider_name: 'Anthropic',
    },
  })
  const info = classifyFailure(
    failure as ClassifiableFailure,
    context({ keyLimit: { limit: 10, reset: 'monthly' } }),
  )
  expect(info?.kind).toBe('key-limit')
  expect(info?.title).toBe(
    'This key reached its spending limit ($10.00, resets monthly).',
  )
  expect(info?.sentence).toBe('')
})

test('fromStreamErrorChunk reads snake_case limit_source from a raw error-only chunk', () => {
  const failure = fromStreamErrorChunk(
    {
      error: {
        code: 402,
        message: 'Key limit exceeded',
        metadata: { limit_source: 'openrouter_key_limit' },
      },
    },
    { contentReceived: false },
  )
  expect(failure).toMatchObject({
    source: 'stream-error',
    code: 402,
    contentReceived: false,
    metadata: { limit_source: 'openrouter_key_limit' },
  })
  if (!failure || failure.source !== 'stream-error') return
  expect(
    classifyFailure(
      failure,
      context({ keyLimit: { limit: 10, reset: 'monthly' } }),
    )?.kind,
  ).toBe('key-limit')
})

test('fromSdkError converts Retry-After HTTP-dates to seconds and leaves integers', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
  try {
    const future = fromSdkError(
      new OpenRouterError('rate', {
        response: new Response(
          JSON.stringify({
            error: { code: 429, message: 'Rate limit exceeded' },
          }),
          {
            status: 429,
            headers: { 'retry-after': 'Mon, 05 Oct 2026 12:00:12 GMT' },
          },
        ),
        request: new Request('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
        }),
        body: JSON.stringify({
          error: { code: 429, message: 'Rate limit exceeded' },
        }),
      }),
    )
    const past = fromSdkError(
      new OpenRouterError('rate', {
        response: new Response(
          JSON.stringify({
            error: { code: 429, message: 'Rate limit exceeded' },
          }),
          {
            status: 429,
            headers: { 'retry-after': 'Mon, 05 Oct 2026 11:00:00 GMT' },
          },
        ),
        request: new Request('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
        }),
        body: JSON.stringify({
          error: { code: 429, message: 'Rate limit exceeded' },
        }),
      }),
    )
    const integer = fromSdkError(
      new OpenRouterError('rate', {
        response: new Response(
          JSON.stringify({
            error: { code: 429, message: 'Rate limit exceeded' },
          }),
          { status: 429, headers: { 'retry-after': '23' } },
        ),
        request: new Request('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
        }),
        body: JSON.stringify({
          error: { code: 429, message: 'Rate limit exceeded' },
        }),
      }),
    )
    expect(future).toMatchObject({
      source: 'http',
      headers: { 'retry-after': '12' },
    })
    expect(past).toMatchObject({
      source: 'http',
      headers: { 'retry-after': '0' },
    })
    expect(integer).toMatchObject({
      source: 'http',
      headers: { 'retry-after': '23' },
    })
    if (future === 'aborted' || future.source !== 'http') return
    if (past === 'aborted' || past.source !== 'http') return
    expect(classifyFailure(future, context())).toMatchObject({
      title: 'Rate limited. Retry in 12s',
      sentence: '',
      retryAfterSec: 12,
      primary: retry(true),
    })
    expect(classifyFailure(past, context())).toMatchObject({
      title: 'Rate limited. Retry in 0s',
      sentence: '',
      retryAfterSec: 0,
      primary: retry(),
    })
  } finally {
    vi.useRealTimers()
  }
})

test('OpenRouterDefaultError statusCode 504 is the timeout card', () => {
  const body = JSON.stringify({
    error: { code: 504, message: 'Gateway timeout' },
  })
  const failure = fromSdkError(
    new OpenRouterDefaultError('Gateway timeout', {
      response: new Response(body, { status: 504 }),
      request: new Request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
      }),
      body,
    }),
  )
  expect(failure).toMatchObject({ source: 'http', status: 504 })
  if (failure === 'aborted' || failure.source !== 'http') return
  expect(classifyFailure(failure, context())).toMatchObject({
    kind: 'timeout',
    title: 'The model took too long to respond.',
    sentence: '',
    primary: retry(),
  })
})
