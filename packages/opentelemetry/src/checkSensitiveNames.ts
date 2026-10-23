import {
  addGlobalExtension,
  EXTENSIONS,
  isSkip,
  removeItem,
  type AtomLike,
  type Ext,
  type Unsubscribe,
} from '@reatom/core'

import { tracerSignalEnabled } from './consentPolicy.ts'
import { isDevelopment } from './devWarnings.ts'
import { observe } from './observation.ts'
import type { ReatomOpentelemetry } from './reatomOpentelemetry.ts'

const SENSITIVE_NAME =
  /pass(word)?|secret|token|auth|cookie|session|crypto|card|cvv|iban|ssn/i

const toPatterns = (
  patterns: CheckSensitiveNamesOptions['patterns'],
): readonly RegExp[] => {
  if (patterns == null) return [SENSITIVE_NAME]
  if (patterns instanceof RegExp) return [patterns]
  return patterns
}

const matchesName = (name: string, patterns: readonly RegExp[]): boolean => {
  for (const pattern of patterns) {
    if (pattern.global) pattern.lastIndex = 0
    if (pattern.test(name)) return true
  }
  return false
}

const capturesValues = (otel: ReatomOpentelemetry): boolean => {
  const options = observe(() => otel())
  if (!options) return false
  const tracesOpen = tracerSignalEnabled(options, 'traces')
  const logsOpen = tracerSignalEnabled(options, 'logs')
  if (!tracesOpen && !logsOpen) return false
  if (options.captureValues === false) return false
  const serialize = (options as { serialize?: unknown }).serialize
  return typeof serialize !== 'function'
}

const admits = (otel: ReatomOpentelemetry, target: AtomLike): boolean => {
  const options = observe(() => otel())
  const filter = options?.filter
  if (typeof filter !== 'function') return true
  return observe(() => filter(target)) === true
}

export interface CheckSensitiveNamesOptions {
  patterns?: RegExp | readonly RegExp[]
}

const installed = new WeakMap<ReatomOpentelemetry, Unsubscribe>()

/**
 * DEV helper: warn once per atom or action name that looks sensitive while the
 * instance is capturing values. No-op unless development is detected
 * (`NODE_ENV` of `development` or `test`, or `import.meta.env.DEV` when
 * `NODE_ENV` is unset). Call from `setup.ts` before application atoms are
 * created.
 */
export const checkSensitiveNames = (
  otel: ReatomOpentelemetry,
  options?: CheckSensitiveNamesOptions,
): Unsubscribe => {
  if (!isDevelopment()) return () => {}
  const existing = installed.get(otel)
  if (existing) return existing

  const patterns = toPatterns(options?.patterns)
  const warned = new Set<string>()

  const inspect: Ext = (target) => {
    if (isSkip(target)) return target
    if (!capturesValues(otel)) return target
    if (!admits(otel, target)) return target
    const name = target.name
    if (warned.has(name) || !matchesName(name, patterns)) return target
    warned.add(name)
    console.warn(
      `[@reatom/opentelemetry] checkSensitiveNames: "${name}" matches a sensitive pattern while values are captured. Set captureValues: false or a custom serialize, or rename the target.`,
    )
    return target
  }

  addGlobalExtension(inspect)
  const stop: Unsubscribe = () => {
    removeItem(EXTENSIONS, inspect)
    installed.delete(otel)
  }
  installed.set(otel, stop)
  return stop
}
