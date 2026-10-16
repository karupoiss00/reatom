import { top } from '@reatom/core'

/**
 * Hosts (the admin) register roots that must never appear in traces or exports.
 *
 * `globalThis[UNTRACED_ROOTS]` is a `WeakSet` of Reatom roots (`frame.root`
 * from `context.start()`). A host creates the set when it is missing and adds
 * its root. It does not need to import this package. While `top().root` is in
 * that set, recording paths write nothing and do not open a session span.
 */
export const UNTRACED_ROOTS = Symbol.for('reatom.opentelemetry.untracedRoots')

type UntracedHolder = typeof globalThis & {
  [UNTRACED_ROOTS]?: WeakSet<object>
}

export const isUntracedRoot = (): boolean => {
  const roots = (globalThis as UntracedHolder)[UNTRACED_ROOTS]
  if (!roots) return false
  try {
    return roots.has(top().root)
  } catch {
    return false
  }
}
