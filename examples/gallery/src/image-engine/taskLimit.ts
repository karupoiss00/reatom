export type TaskLimit = <T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
) => Promise<T>

function readAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Task aborted', 'AbortError')
}

export function createTaskLimit(maxParallel: number): TaskLimit {
  let activeTasks = 0
  const waitingGrants: Array<() => void> = []

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(readAbortReason(signal))
        return
      }
      if (activeTasks < maxParallel) {
        activeTasks += 1
        resolve()
        return
      }

      const abort = () => {
        const waitingIndex = waitingGrants.indexOf(grant)
        if (waitingIndex >= 0) waitingGrants.splice(waitingIndex, 1)
        reject(readAbortReason(signal!))
      }
      const grant = () => {
        signal?.removeEventListener('abort', abort)
        activeTasks += 1
        resolve()
      }
      signal?.addEventListener('abort', abort, { once: true })
      waitingGrants.push(grant)
    })

  const release = () => {
    activeTasks -= 1
    waitingGrants.shift()?.()
  }

  return async (task, signal) => {
    await acquire(signal)
    try {
      return await task()
    } finally {
      release()
    }
  }
}
