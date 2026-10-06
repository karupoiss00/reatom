import { classifyFailure as classifyFailureImpl } from './classify'
import {
  fromSdkError,
  fromStreamErrorChunk as fromStreamErrorChunkImpl,
} from './sdk'

export type {
  ClassifiableContext,
  ClassifiableFailure,
  ClassifiableStreamError,
} from './input'
export { fromSdkError }

export const errorAdapters = {
  classifyFailure: classifyFailureImpl,
  fromStreamErrorChunk: fromStreamErrorChunkImpl,
}

export const classifyFailure: typeof classifyFailureImpl = (failure, context) =>
  errorAdapters.classifyFailure(failure, context)

export const fromStreamErrorChunk: typeof fromStreamErrorChunkImpl = (
  rawChunk,
  opts,
) => errorAdapters.fromStreamErrorChunk(rawChunk, opts)
