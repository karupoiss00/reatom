import { describe, expect, subscribe, test, vi } from 'test'

import { action, notify } from '../core'
import { withAbort } from '../extensions'
import { wrap } from '../methods'
import { isAbort, sleep } from '../utils'
import { reatomTimer } from './reatomTimer'

describe('reatomTimer', () => {
  test('countdown resolves with complete and reaches progress 1', async () => {
    const timer = reatomTimer({ interval: 20, name: 'countdownResolve' })

    expect(timer.status()).toBe('idle')
    expect(timer.remains()).toBe(0)
    expect(timer.progress()).toBe(0)

    const startPromise = timer.start(60)
    expect(timer.status()).toBe('running')
    expect(timer.isRunning()).toBe(true)
    expect(timer.remains()).toBeGreaterThan(0)
    expect(timer.progress()).toBeLessThan(1)

    expect(await wrap(startPromise)).toBe('complete')

    expect(timer.status()).toBe('idle')
    expect(timer.remains()).toBe(0)
    expect(timer.progress()).toBe(1)
  })

  test('progress advances during countdown', async () => {
    const timer = reatomTimer({ interval: 20, name: 'progressSteps' })
    const progressTrack = vi.fn()

    timer.progress.subscribe(progressTrack)
    timer.start(100)

    await wrap(sleep(50))

    expect(progressTrack.mock.calls.length).toBeGreaterThan(1)
    const lastProgress = progressTrack.mock.calls.at(-1)?.[0] as number
    expect(lastProgress).toBeGreaterThan(0)
    expect(lastProgress).toBeLessThan(1)

    timer.stop()
  })

  test('pause freezes remains and resume shifts the end', async () => {
    const timer = reatomTimer({ interval: 20, name: 'pauseResume' })

    timer.start(200)
    await wrap(sleep(30))

    expect(timer.remains()).toBeGreaterThan(0)

    timer.pause()
    notify()
    expect(timer.status()).toBe('paused')
    expect(timer.isPaused()).toBe(true)
    const remainsWhilePaused = timer.remains()
    await wrap(sleep(80))

    expect(timer.remains()).toBe(remainsWhilePaused)

    timer.resume()
    notify()
    expect(timer.status()).toBe('running')
    await wrap(sleep(30))

    expect(timer.remains()).toBeLessThan(remainsWhilePaused)
    expect(timer.remains()).toBeGreaterThan(0)

    timer.stop()
  })

  test('toggle pauses and resumes while counting', async () => {
    const timer = reatomTimer({ interval: 20, name: 'toggle' })

    timer.toggle()
    expect(timer.status()).toBe('idle')

    timer.start(200)
    timer.toggle()
    expect(timer.status()).toBe('paused')

    timer.toggle()
    expect(timer.status()).toBe('running')

    timer.stop()
  })

  test('restart settles previous start as replaced', async () => {
    const timer = reatomTimer({ interval: 20, name: 'restartCancels' })

    const first = timer.start(200)
    await wrap(sleep(30))

    const second = timer.start(60)
    expect(await wrap(first)).toBe('replaced')
    expect(timer.remains()).toBeGreaterThan(0)

    expect(await wrap(second)).toBe('complete')
    expect(timer.remains()).toBe(0)
    expect(timer.progress()).toBe(1)
  })

  test('stop settles start as stopped and resets progress', async () => {
    const timer = reatomTimer({ interval: 20, name: 'stopReset' })

    const startPromise = timer.start(200)
    await wrap(sleep(40))

    expect(timer.progress()).toBeGreaterThan(0)

    timer.stop()

    expect(await wrap(startPromise)).toBe('stopped')
    expect(timer.remains()).toBe(0)
    expect(timer.progress()).toBe(0)
    expect(timer.paused()).toBe(false)
    expect(timer.status()).toBe('idle')
  })

  test('stop settles immediately without waiting for the next tick', async () => {
    const timer = reatomTimer({ interval: 200, name: 'stopImmediate' })

    const startPromise = timer.start(1000)
    timer.stop()

    expect(await wrap(startPromise)).toBe('stopped')
  })

  test('stop can keep the last progress', async () => {
    const timer = reatomTimer({
      interval: 20,
      resetProgress: false,
      name: 'stopKeepProgress',
    })

    timer.start(200)
    await wrap(sleep(50))

    const progressBeforeStop = timer.progress()
    expect(progressBeforeStop).toBeGreaterThan(0)

    timer.stop()

    expect(timer.remains()).toBe(0)
    expect(timer.progress()).toBe(progressBeforeStop)
  })

  test('rejects invalid duration', async () => {
    const timer = reatomTimer({ interval: 100, name: 'invalidDuration' })

    const tooShort = await wrap(timer.start(50).catch((error: Error) => error))
    expect(tooShort).toBeInstanceOf(Error)
    expect(tooShort.message).toBe('delay less than interval')

    const tooMuchPassed = await wrap(
      timer.start(100, 150).catch((error: Error) => error),
    )
    expect(tooMuchPassed).toBeInstanceOf(Error)
    expect(tooMuchPassed.message).toBe('passed more than delay')
  })

  test('interval change mid-run is picked up', async () => {
    const timer = reatomTimer({ interval: 40, name: 'intervalChange' })
    const track = subscribe(timer.remains)

    timer.start(200)
    await wrap(sleep(50))

    const callsBefore = track.mock.calls.length
    timer.interval.set(15)
    await wrap(sleep(50))

    expect(track.mock.calls.length).toBeGreaterThan(callsBefore)
    timer.stop()
  })

  test('settle reason does not depend on the timer name', async () => {
    const timer = reatomTimer({ interval: 20, name: 'stopped-job' })

    const first = timer.start(200)
    await wrap(sleep(10))
    const second = timer.start(200)

    expect(await wrap(first)).toBe('replaced')

    timer.stop()
    expect(await wrap(second)).toBe('stopped')
  })

  test('caller abort rejects start and resets the countdown', async () => {
    const timer = reatomTimer({ interval: 20, name: 'callerAbort' })
    const host = action(async () => {
      return await wrap(timer.start(200))
    }, 'callerAbort.host').extend(withAbort())

    const hostResult = host().catch((error: Error) => error)
    await wrap(sleep(30))
    host.abort('external')

    const error = await wrap(hostResult)
    expect(isAbort(error)).toBe(true)
    expect(timer.status()).toBe('idle')
    expect(timer.remains()).toBe(0)
  })

  test('rejects non-finite or negative arguments', async () => {
    const timer = reatomTimer({ interval: 20, name: 'invalidArgs' })

    for (const [durationMs, passedMs] of [
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      [100, -10],
    ] as const) {
      const error = await wrap(
        timer.start(durationMs, passedMs).catch((error: Error) => error),
      )
      expect(error).toBeInstanceOf(Error)
      expect(timer.status()).toBe('idle')
    }
  })

  test('invalid interval rejects start and resets the countdown', async () => {
    const timer = reatomTimer({ interval: 20, name: 'invalidInterval' })

    const startResult = timer.start(200).catch((error: Error) => error)
    await wrap(sleep(10))
    timer.interval.set(0)

    const error = await wrap(startResult)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(
      'interval must be a positive finite number',
    )
    expect(timer.status()).toBe('idle')

    const rejected = await wrap(timer.start(200).catch((error: Error) => error))
    expect(rejected).toBeInstanceOf(Error)
  })

  test('durations above the max timeout are not truncated', () => {
    const timer = reatomTimer({ name: 'longDuration' })
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

    timer.start(thirtyDaysMs)
    expect(timer.remains()).toBe(thirtyDaysMs)

    timer.stop()
  })

  test('start while paused begins a running countdown', async () => {
    const timer = reatomTimer({ interval: 20, name: 'startWhilePaused' })

    const first = timer.start(200)
    timer.pause()
    expect(timer.status()).toBe('paused')

    const second = timer.start(60)
    expect(await wrap(first)).toBe('replaced')
    expect(timer.status()).toBe('running')
    expect(await wrap(second)).toBe('complete')
  })

  test('stop while paused resets the countdown', async () => {
    const timer = reatomTimer({ interval: 20, name: 'stopWhilePaused' })

    const startPromise = timer.start(200)
    timer.pause()
    timer.stop()

    expect(await wrap(startPromise)).toBe('stopped')
    expect(timer.paused()).toBe(false)
    expect(timer.status()).toBe('idle')
  })

  test('passedMs advances the initial progress', async () => {
    const timer = reatomTimer({ interval: 20, name: 'passedMs' })

    timer.start(100, 50)

    expect(timer.progress()).toBeCloseTo(0.5, 1)
    expect(timer.remains()).toBeLessThanOrEqual(50)

    timer.stop()
  })
})
