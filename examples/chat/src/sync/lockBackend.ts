export interface HeldLock {
  release(): Promise<void>
}

export interface LockBackend {
  /**
   * Exclusive and non-blocking: resolves `null` when anyone already holds
   * `name`.
   */
  acquireExclusive(name: string): Promise<HeldLock | null>
  /**
   * Shared presence that other tabs can observe, granted without contention
   * checks.
   */
  hold(name: string): HeldLock
  isHeld(name: string): Promise<boolean>
  waitUntilFree(name: string, signal: AbortSignal): Promise<void>
  dispose(): void
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

export const once = <Result>(run: () => Result): (() => Result) => {
  let done = false
  let result: Result
  return () => {
    if (!done) {
      done = true
      result = run()
    }
    return result
  }
}
