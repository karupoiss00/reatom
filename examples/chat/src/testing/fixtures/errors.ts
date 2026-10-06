export const freeModelCapMessage =
  'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day.'

export const providerRateLimitMessage = 'Provider returned error'

const httpError = (
  status: number,
  message: string,
  metadata?: Record<string, unknown>,
  headers?: Record<string, string>,
) => ({
  status,
  headers,
  body: {
    error: {
      code: status,
      message,
      ...(metadata ? { metadata } : {}),
    },
  },
})

export const unauthorized401 = httpError(401, 'User not found.')

export const paymentCredits402 = httpError(402, 'Insufficient credits', {
  limit_source: 'openrouter_credits',
})

export const paymentKeyLimit402 = httpError(402, 'Key limit exceeded', {
  limit_source: 'openrouter_key_limit',
})

export const paymentInFlight402 = httpError(
  402,
  'Too many requests in flight for your budget',
  { limit_source: 'openrouter_in_flight_budget' },
  { 'Retry-After': '12', 'request-id': 'req_402_inflight' },
)

export const paymentRequired402 = httpError(402, 'Payment required')

export const moderation403 = httpError(403, 'Request blocked by moderation', {
  reasons: ['violence'],
  flagged_input: 'a flagged excerpt under one hundred characters',
  provider_name: 'Anthropic',
  model_slug: 'anthropic/claude-sonnet-4',
})

export const forbidden403 = httpError(403, 'OpenRouter refused this request')

export const timeout408 = httpError(408, 'Request timed out')

export const rateLimit429 = httpError(
  429,
  providerRateLimitMessage,
  { provider_name: 'OpenAI' },
  {
    'Retry-After': '23',
    'X-Provider-Name': 'OpenAI',
    'request-id': 'req_429',
  },
)

export const rateLimitFreeCap429 = httpError(
  429,
  freeModelCapMessage,
  { provider_name: 'OpenRouter' },
  { 'Retry-After': '23', 'request-id': 'req_429_free' },
)

export const badGateway502 = httpError(502, 'Provider disconnected')

export const unavailable503 = httpError(
  503,
  'No endpoints available matching your request',
  undefined,
  {
    'Retry-After': '8',
    'X-Provider-Name': 'OpenAI',
    'request-id': 'req_503',
  },
)

export const gatewayTimeout504 = httpError(504, 'Gateway timeout')

export const edgeTimeout524 = httpError(524, 'Edge timeout')

export const overloaded529 = httpError(529, 'Provider overloaded')

export const contextLength400 = httpError(
  400,
  "This endpoint's maximum context length is 128000 tokens. However, you requested about 210000 tokens.",
  { error_type: 'context_length_exceeded' },
)

export const maxTokens400 = httpError(400, 'max_tokens exceeds the model limit', {
  error_type: 'max_tokens_exceeded',
})

export const tokenLimit400 = httpError(400, 'Token limit exceeded', {
  error_type: 'token_limit_exceeded',
})

export const unknownModel400 = httpError(
  400,
  'The model `no-such/model` does not exist',
)

export const rejected400 = httpError(400, 'temperature must be between 0 and 2', {
  error_type: 'invalid_request',
})

export const unknownModel404 = httpError(
  404,
  'No endpoints found for no-such/model',
)

export const payload413 = httpError(413, 'Request entity too large')

export const unknown418 = httpError(418, 'Unknown teapot')
