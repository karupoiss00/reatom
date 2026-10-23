import { peek, STACK } from '@reatom/core'

const key = Symbol.for('@reatom/opentelemetry/observation')
const host = globalThis as typeof globalThis & { [key]?: { depth: number } }
const observation = (host[key] ??= { depth: 0 })
export const isObserving = () => observation.depth !== 0

/** Suppress synchronous tracing without changing application dependencies. */
export const suppressTracing = <T>(callback: () => T): T => {
  observation.depth++
  try {
    return callback()
  } finally {
    observation.depth--
  }
}

/** Isolate dependency tracking and swallow telemetry callback failures. */
export const observe = <T>(callback: () => T): T | undefined => {
  try {
    return suppressTracing(() => (STACK.length ? peek(callback) : callback()))
  } catch {
    return undefined
  }
}
