import { expect, test } from 'test'

import { atom, notify } from '../../core'
import { wrap } from '../../methods'
import { sleep } from '../../utils'
import {
  reatomPersistBroadcastChannel,
  withBroadcastChannel,
} from './broadcastChannel'

const uniqueKey = (label: string) =>
  `broadcast-${label}-${Date.now()}-${Math.random()}`

test('BroadcastChannel getter is called on first persist write', () => {
  let creates = 0
  const channel = new BroadcastChannel(uniqueKey('lazy-write'))
  const withLazy = reatomPersistBroadcastChannel(() => {
    creates++
    return channel
  })

  expect(creates).toBe(0)

  const testAtom = atom(0, 'lazyBroadcastWrite').extend(
    withLazy(uniqueKey('key')),
  )

  expect(creates).toBe(0)

  testAtom.set(1)
  expect(creates).toBe(1)
  expect(testAtom()).toBe(1)

  testAtom.set(2)
  expect(creates).toBe(1)

  channel.close()
})

test('BroadcastChannel getter is called on first persist subscribe', async () => {
  let creates = 0
  const channel = new BroadcastChannel(uniqueKey('lazy-subscribe'))
  const withLazy = reatomPersistBroadcastChannel(() => {
    creates++
    return channel
  })

  const testAtom = atom(0, 'lazyBroadcastSubscribe').extend(
    withLazy(uniqueKey('key')),
  )

  expect(creates).toBe(0)

  const unsubscribe = testAtom.subscribe()
  notify()
  await wrap(sleep())
  expect(creates).toBe(1)

  unsubscribe()
  channel.close()
})

test('default withBroadcastChannel opens a channel only on persist use', () => {
  const Original = globalThis.BroadcastChannel
  const created: string[] = []
  const channels: BroadcastChannel[] = []

  globalThis.BroadcastChannel = class extends Original {
    constructor(name: string) {
      super(name)
      created.push(name)
      channels.push(this)
    }
  } as typeof BroadcastChannel

  try {
    const testAtom = atom(0, 'lazyDefaultBroadcast').extend(
      withBroadcastChannel(uniqueKey('default')),
    )

    expect(created).toEqual([])

    testAtom.set(1)
    expect(created).toContain('reatom_withBroadcastChannel_default')
    expect(testAtom()).toBe(1)
  } finally {
    for (const channel of channels) channel.close()
    globalThis.BroadcastChannel = Original
  }
})
