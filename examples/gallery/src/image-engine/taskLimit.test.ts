import { describe, expect, test } from 'vitest'

import { createTaskLimit } from './taskLimit'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createTaskLimit', () => {
  test('runs at most maxParallel tasks and starts waiters in order', async () => {
    const limit = createTaskLimit(2)
    const deferreds = [createDeferred(), createDeferred(), createDeferred()]
    const started: number[] = []

    const runs = deferreds.map((deferred, index) =>
      limit(async () => {
        started.push(index)
        await deferred.promise
        return index
      }),
    )

    await Promise.resolve()
    expect(started).toEqual([0, 1])

    deferreds[1]!.resolve()
    await runs[1]
    await Promise.resolve()
    expect(started).toEqual([0, 1, 2])

    deferreds[0]!.resolve()
    deferreds[2]!.resolve()
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2])
  })

  test('releases the slot when a task throws', async () => {
    const limit = createTaskLimit(1)
    const failing = limit(async () => {
      throw new Error('decode failed')
    })
    await expect(failing).rejects.toThrow('decode failed')
    await expect(limit(async () => 'next')).resolves.toBe('next')
  })

  test('aborting a waiting task removes it from the queue', async () => {
    const limit = createTaskLimit(1)
    const blocker = createDeferred()
    const running = limit(() => blocker.promise)

    const controller = new AbortController()
    let abortedTaskStarted = false
    const aborted = limit(async () => {
      abortedTaskStarted = true
    }, controller.signal)
    const queued = limit(async () => 'queued')

    controller.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })

    blocker.resolve()
    await running
    await expect(queued).resolves.toBe('queued')
    expect(abortedTaskStarted).toBe(false)
  })

  test('rejects immediately when the signal is already aborted', async () => {
    const limit = createTaskLimit(1)
    const controller = new AbortController()
    controller.abort()
    await expect(
      limit(async () => 'never', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(limit(async () => 'free')).resolves.toBe('free')
  })
})
