import { once, sleep, type HeldLock, type LockBackend } from './lockBackend'

const recheckAfterEarlyGrantMs = 100

/**
 * Waiters never queue on the exclusive lock itself, so a waiting tab can never
 * make the holder's next `ifAvailable` request fail. The holder also keeps a
 * companion watch lock that waiters request in shared mode.
 */
export const watchLockName = (name: string) => `watch:${name}`

export const createWebLockBackend = (manager: LockManager): LockBackend => {
  const activeHolds = new Set<() => Promise<void>>()

  const holdUntilReleased = (
    name: string,
    options: { ifAvailable?: boolean },
  ): { granted: Promise<boolean>; release: () => Promise<void> } => {
    const pendingRequest = new AbortController()
    let endHold = () => {}
    const heldUntil = new Promise<void>((resolve) => {
      endHold = resolve
    })
    const requestOptions: LockOptions = options.ifAvailable
      ? { ifAvailable: true }
      : { signal: pendingRequest.signal }
    let grantSettled = false
    let resolveGranted = (_held: boolean) => {}
    const granted = new Promise<boolean>((resolve) => {
      resolveGranted = resolve
    })
    const finishGranted = (held: boolean) => {
      if (grantSettled) return
      grantSettled = true
      resolveGranted(held)
    }
    // `locks.request()` settles only after the browser has dropped the hold.
    const requestSettled = manager
      .request(name, requestOptions, async (lock) => {
        finishGranted(lock !== null)
        if (lock) await heldUntil
      })
      .then(
        () => {
          finishGranted(false)
        },
        () => {
          finishGranted(false)
        },
      )
    const release = once(() => {
      activeHolds.delete(release)
      endHold()
      pendingRequest.abort()
      return requestSettled
    })
    activeHolds.add(release)
    return { granted, release }
  }

  const isHeld = async (name: string) => {
    const snapshot = await manager.query()
    const locks = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])]
    return locks.some((lock) => lock.name === name)
  }

  return {
    async acquireExclusive(name) {
      const exclusive = holdUntilReleased(name, { ifAvailable: true })
      if (!(await exclusive.granted)) {
        await exclusive.release()
        return null
      }
      const watch = holdUntilReleased(watchLockName(name), {})
      return {
        release: once(() =>
          Promise.all([exclusive.release(), watch.release()]).then(
            () => undefined,
          ),
        ),
      }
    },
    hold(name): HeldLock {
      return { release: holdUntilReleased(name, {}).release }
    },
    isHeld,
    async waitUntilFree(name, signal) {
      while (!signal.aborted) {
        await manager.request(
          watchLockName(name),
          { mode: 'shared', signal },
          () => undefined,
        )
        if (!(await isHeld(name))) return
        await sleep(recheckAfterEarlyGrantMs, signal)
      }
    },
    dispose() {
      for (const release of [...activeHolds]) void release()
    },
  }
}
