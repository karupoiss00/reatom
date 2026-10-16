import { context } from '@reatom/core'

export const ADMIN_FRAME = context.start()

const untracedRootsKey = Symbol.for('reatom.opentelemetry.untracedRoots')

type UntracedRootsHolder = typeof globalThis & {
  [untracedRootsKey]?: WeakSet<object>
}

const untracedRoots = () => {
  const holder = globalThis as UntracedRootsHolder
  return (holder[untracedRootsKey] ??= new WeakSet())
}

/** Puts the current `ADMIN_FRAME.root` in the untraced-root set. */
export function registerAdminRoot(): void {
  untracedRoots().add(ADMIN_FRAME.root)
}

registerAdminRoot()

const afterAdminReset = new Set<() => void>()

/**
 * Runs after `resetAdminFrame` swaps in a new root. Used to rebind the shadow
 * stylesheet. Returns an unsubscribe function.
 */
export function onAdminReset(listener: () => void): () => void {
  afterAdminReset.add(listener)
  return () => {
    afterAdminReset.delete(listener)
  }
}

/**
 * Resets `ADMIN_FRAME` and registers the replacement root so admin writes stay
 * untraced. Rebinds one shadow stylesheet for that frame.
 */
export function resetAdminFrame(): void {
  ADMIN_FRAME.run(() => {
    context.reset()
  })
  registerAdminRoot()
  for (const listener of afterAdminReset) listener()
}
