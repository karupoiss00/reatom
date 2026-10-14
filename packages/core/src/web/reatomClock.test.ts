import { expect, test, vi } from 'test'

import { notify } from '../core'
import { wrap } from '../methods'
import { sleep } from '../utils'
import { reatomClock } from './reatomClock'

test('reatomClock ticks while subscribed and stops on disconnect', async () => {
  const seconds = reatomClock(20, 'clockConnection')
  const track = vi.fn()

  const unsubscribe = seconds.subscribe(track)
  await wrap(sleep())
  notify()

  const first = seconds()
  await wrap(sleep(50))

  expect(seconds()).toBeGreaterThan(first)
  expect(track.mock.calls.length).toBeGreaterThan(1)

  unsubscribe()
  await wrap(sleep())

  const afterUnsubscribe = seconds()
  await wrap(sleep(50))

  expect(seconds()).toBe(afterUnsubscribe)
})

test('reatomClock fresh refreshes the timestamp on reconnect', async () => {
  const seconds = reatomClock({
    interval: 1000,
    fresh: true,
    name: 'clockFreshReconnect',
  })

  seconds.subscribe(() => {})()
  const beforeIdle = seconds()
  await wrap(sleep(50))

  const track = vi.fn()
  const unsubscribe = seconds.subscribe(track)

  const [firstEmitted] = track.mock.lastCall!
  expect(firstEmitted - beforeIdle).toBeGreaterThanOrEqual(50)
  unsubscribe()
})

test('reatomClock fresh returns current time for idle reads', async () => {
  const seconds = reatomClock({
    interval: 1000,
    fresh: true,
    name: 'clockFreshIdle',
  })

  const first = seconds()
  await wrap(sleep(50))

  expect(seconds() - first).toBeGreaterThanOrEqual(50)
})

test('reatomClock fresh keeps the tick value stable while subscribed', async () => {
  const seconds = reatomClock({
    interval: 1000,
    fresh: true,
    name: 'clockFreshStable',
  })
  const unsubscribe = seconds.subscribe(() => {})
  await wrap(sleep())

  const first = seconds()
  await wrap(sleep(50))

  expect(seconds()).toBe(first)
  unsubscribe()
})

test('reatomClock does not tick without subscribers', async () => {
  const seconds = reatomClock(20, 'clockIdle')

  const first = seconds()
  await wrap(sleep(50))

  expect(seconds()).toBe(first)
})

test('reatomClock hot keeps ticking after disconnect', async () => {
  const seconds = reatomClock({ interval: 20, hot: true, name: 'clockHot' })

  const first = seconds()
  await wrap(sleep(50))
  expect(seconds()).toBeGreaterThan(first)

  const track = vi.fn()
  const unsubscribe = seconds.subscribe(track)
  await wrap(sleep(40))
  unsubscribe()
  await wrap(sleep())

  const afterUnsubscribe = seconds()
  await wrap(sleep(50))

  expect(seconds()).toBeGreaterThan(afterUnsubscribe)
})

test('reatomClock accepts options object without hot', async () => {
  const seconds = reatomClock({ interval: 20, name: 'clockOptions' })
  const track = vi.fn()

  const unsubscribe = seconds.subscribe(track)
  await wrap(sleep())
  notify()

  const first = seconds()
  await wrap(sleep(50))
  expect(seconds()).toBeGreaterThan(first)

  unsubscribe()
  await wrap(sleep())

  const afterUnsubscribe = seconds()
  await wrap(sleep(50))
  expect(seconds()).toBe(afterUnsubscribe)
})
