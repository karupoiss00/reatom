import type { ClassifyContext, CompletionFailure } from './types'

export type ClassifiableContext = ClassifyContext & {
  contentReceived?: boolean
  modelInCatalog?: boolean
}

export type ClassifiableStreamError = Extract<
  CompletionFailure,
  { source: 'stream-error' }
> & {
  contentReceived?: boolean
}

export type ClassifiableFailure =
  | Exclude<CompletionFailure, { source: 'stream-error' }>
  | ClassifiableStreamError
