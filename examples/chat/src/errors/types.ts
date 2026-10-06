export type ErrorKind =
  | 'auth-rejected'
  | 'out-of-credits'
  | 'key-limit'
  | 'in-flight-budget'
  | 'payment-required'
  | 'moderation'
  | 'refused-403'
  | 'timeout'
  | 'rate-limited'
  | 'unavailable'
  | 'context-too-long'
  | 'unknown-model'
  | 'bad-request'
  | 'param-rejected'
  | 'too-large'
  | 'web-search-zdr'
  | 'unknown'
  | 'provider-disconnected'
  | 'connection-lost'
  | 'empty-reasoning'
  | 'empty-reply'
  | 'cut-off'
  | 'refusal'
export type ErrorActionId =
  | 'retry'
  | 'reconnect'
  | 'add-credits'
  | 'raise-limit'
  | 'edit-message'
  | 'pick-model'
  | 'switch-longer-context'
  | 'new-chat-last-4'
  | 'use-paid'
  | 'try-fallback'
  | 'loosen-privacy'
  | 'loosen-routing'
  | 'reset-params-retry'
  | 'retry-lower-effort'
  | 'retry-higher-max-tokens'
  | 'send-without-web-search'
export interface ErrorAction {
  id: ErrorActionId
  label: string
  modelId?: string
  disabled?: boolean
}
export interface ErrorInfo {
  kind: ErrorKind
  code: number | null
  title: string
  sentence: string // never just "Provider returned error"
  primary: ErrorAction | null
  secondary: ErrorAction[]
  retryAfterSec: number | null // countdown; Retry disabled until 0
  notice: boolean // inline notice (F-18) rather than a card
  details: {
    code: number | null
    message: string | null
    requestId: string | null
  }
  suggestions?: Array<{ id: string; name: string; contextLength: number }>
  flaggedInput?: string
}
export type CompletionFailure =
  | {
      source: 'http'
      status: number
      body: unknown
      headers: Record<string, string>
    }
  | {
      source: 'stream-error'
      code: number | null
      message: string
      metadata?: Record<string, unknown>
      contentReceived?: boolean
    }
  | { source: 'network' }
  | { source: 'timeout' }
  | {
      source: 'finish'
      finishReason: 'length' | 'stop' | 'content_filter'
      hasContent: boolean
      reasoningTokens: number
      refusal: string | null
    }
export interface ClassifyContext {
  modelId: string
  modelName: string
  provider: string | null
  paidVariant: { id: string; name: string } | null
  fallbackModel: { id: string; name: string } | null
  longerContextModels: Array<{
    id: string
    name: string
    contextLength: number
  }>
  privacyRestrictive: boolean
  routingRestrictive: boolean
  keyLimit: { limit: number | null; reset: string | null } | null
  estimatedInputTokens: number
  contextLength: number | null
  effortSupported: boolean
  maxTokensSet: boolean
  webSearchOn: boolean
  zdrOn: boolean
  attachmentName: string | null
  contentReceived?: boolean
  modelInCatalog?: boolean
}
