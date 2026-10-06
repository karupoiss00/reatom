import { addCallHook, context } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { seedChats } from '../../testing/seed'
import { closeAllTabs, openTab } from '../../testing/tabs/harness'
import { initStorage } from '../../storage'
import { createSyncChannel, initSync, syncBus, syncReceived } from '../bus'
import { reloadFromStorage } from '../fallback'
import { channelLockTimings } from '../channelLocks'
import { createSyncLocks, holdTombstone, isTombstoneHeld } from '../locks'
import type { SyncEvent } from '../types'

const releaseWindowMs = 1000
const pollWithin = { timeout: releaseWindowMs, interval: 25 }

const cleanups: Array<() => void> = []
const onCleanup = (cleanup: () => void) => {
  cleanups.push(cleanup)
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  closeAllTabs()
  vi.unstubAllGlobals()
})

const withoutWebLocks = () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  })
  onCleanup(() => {
    delete (navigator as { locks?: LockManager }).locks
  })
}

const collect = (channel: ReturnType<typeof createSyncChannel>) => {
  const received: SyncEvent[] = []
  onCleanup(channel.subscribe((event) => received.push(event)))
  return received
}

const twoChannels = () => {
  const channelName = `atelier.test.${crypto.randomUUID()}`
  const tabA = createSyncChannel({ name: channelName, tabId: () => 'tab-a' })
  const tabB = createSyncChannel({ name: channelName, tabId: () => 'tab-b' })
  onCleanup(() => {
    tabA.close()
    tabB.close()
  })
  return { tabA, tabB, channelName }
}

const twoTabsOfLocks = () => {
  const channelName = `atelier.locks.test.${crypto.randomUUID()}`
  const tabA = createSyncLocks({ tabId: () => 'tab-a', channelName })
  const tabB = createSyncLocks({ tabId: () => 'tab-b', channelName })
  onCleanup(() => {
    tabA.dispose()
    tabB.dispose()
  })
  return { tabA, tabB }
}

const watchHeldElsewhere = (
  locks: ReturnType<typeof createSyncLocks>,
  chatId: string,
) => {
  const heldElsewhere = locks.streamHeldElsewhere(chatId)
  onCleanup(heldElsewhere.subscribe(() => {}))
  return heldElsewhere
}

test('two bus instances exchange typed events, including message-deleted', async () => {
  const { tabA, tabB } = twoChannels()
  const receivedByB = collect(tabB)
  const receivedByA = collect(tabA)

  tabA.publish({ type: 'chat-purged', chatId: 'chat-1' })
  tabA.publish({
    type: 'message-deleted',
    chatId: 'chat-1',
    messageId: 'message-1',
  })
  tabB.publish({ type: 'stream', chatId: 'chat-1', tabId: 'tab-b', active: true })

  await expect.poll(() => receivedByB.length).toBe(2)
  expect(receivedByB).toEqual([
    { type: 'chat-purged', chatId: 'chat-1' },
    { type: 'message-deleted', chatId: 'chat-1', messageId: 'message-1' },
  ])
  await expect.poll(() => receivedByA.length).toBe(1)
  expect(receivedByA[0]).toMatchObject({ type: 'stream', active: true })
})

test('the bus ignores own-tab echoes, unknown event types and foreign payloads', async () => {
  const { tabA, tabB, channelName } = twoChannels()
  const sameTabTwin = createSyncChannel({
    name: channelName,
    tabId: () => 'tab-a',
  })
  onCleanup(() => sameTabTwin.close())
  const receivedByTwin = collect(sameTabTwin)
  const receivedByB = collect(tabB)
  const raw = new BroadcastChannel(channelName)
  onCleanup(() => raw.close())

  tabA.publish({ type: 'all-deleted' })
  raw.postMessage({ app: 'atelier', from: 'tab-z', event: { type: 'from-the-future', x: 1 } })
  raw.postMessage('not an envelope')
  raw.postMessage({ app: 'atelier', from: 'tab-z', event: null })
  raw.postMessage({ app: 'atelier', from: 'tab-z', event: { type: 'chat-purged', chatId: 'chat-2' } })

  await expect.poll(() => receivedByB.length).toBe(2)
  expect(receivedByB).toEqual([
    { type: 'all-deleted' },
    { type: 'chat-purged', chatId: 'chat-2' },
  ])
  expect(receivedByTwin).toEqual([{ type: 'chat-purged', chatId: 'chat-2' }])
})

test('initSync wires the shared channel into syncReceived', async () => {
  const received: SyncEvent[] = []
  onCleanup(addCallHook(syncReceived, (event) => received.push(event)))
  initSync()
  expect(syncBus.supported).toBe(true)

  const otherTab = createSyncChannel({ tabId: () => 'tab-other' })
  onCleanup(() => otherTab.close())
  otherTab.publish({ type: 'preset-purged', presetId: 'preset-1' })

  await expect.poll(() => received).toEqual([
    { type: 'preset-purged', presetId: 'preset-1' },
  ])
})

test('without BroadcastChannel the tab reloads from storage on focus and visibilitychange', async () => {
  vi.stubGlobal('BroadcastChannel', undefined)
  context.reset()
  const reloads: number[] = []
  onCleanup(addCallHook(reloadFromStorage, () => reloads.push(1)))
  const channel = createSyncChannel()
  expect(channel.supported).toBe(false)
  expect(() => channel.publish({ type: 'all-deleted' })).not.toThrow()

  initSync()
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))

  await expect.poll(() => reloads.length).toBe(2)
})

test('Web Lock chat-stream:<id> blocks a second acquirer and releases within 1 s', async () => {
  const { tabA, tabB } = twoTabsOfLocks()
  const heldElsewhereInB = watchHeldElsewhere(tabB, 'chat-1')

  const lockA = await tabA.acquireStreamLock('chat-1')
  expect(lockA).not.toBeNull()
  expect(await tabA.acquireStreamLock('chat-1')).toBeNull()
  expect(await tabB.acquireStreamLock('chat-1')).toBeNull()
  const heldNames = (await navigator.locks.query()).held?.map((lock) => lock.name)
  expect(heldNames).toContain('chat-stream:chat-1')

  await expect.poll(() => heldElsewhereInB(), pollWithin).toBe(true)
  expect(tabA.streamHeldElsewhere('chat-1')()).toBe(false)

  const otherChatLock = await tabB.acquireStreamLock('chat-2')
  expect(otherChatLock).not.toBeNull()
  otherChatLock!.release()

  const releasedAt = performance.now()
  lockA!.release()
  await expect.poll(() => heldElsewhereInB(), pollWithin).toBe(false)
  const lockB = await tabB.acquireStreamLock('chat-1')
  expect(lockB).not.toBeNull()
  expect(performance.now() - releasedAt).toBeLessThan(releaseWindowMs)
  lockB!.release()
})

test('the releasing tab re-acquires successfully right after await release()', async () => {
  const { tabA, tabB } = twoTabsOfLocks()
  const lock = await tabA.acquireStreamLock('chat-1')
  expect(lock).not.toBeNull()

  await lock!.release()
  const again = await tabA.acquireStreamLock('chat-1')
  expect(again).not.toBeNull()

  const started = performance.now()
  expect(await tabB.acquireStreamLock('chat-1')).toBeNull()
  expect(performance.now() - started).toBeLessThan(200)
  await again!.release()
})

test('acquireStreamLock waits for this tab pending release and does not retry another tab', async () => {
  const { tabA, tabB } = twoTabsOfLocks()
  const lock = await tabA.acquireStreamLock('chat-1')
  expect(lock).not.toBeNull()

  const freeing = lock!.release()
  expect(freeing).toBeInstanceOf(Promise)
  expect(await tabA.acquireStreamLock('chat-1')).not.toBeNull()
  await freeing

  const started = performance.now()
  expect(await tabB.acquireStreamLock('chat-1')).toBeNull()
  expect(performance.now() - started).toBeLessThan(200)
})

test('unsubscribing streamHeldElsewhere aborts the watch waiter', async () => {
  const { tabA, tabB } = twoTabsOfLocks()
  const chatId = 'chat-watch'
  const lock = await tabA.acquireStreamLock(chatId)
  expect(lock).not.toBeNull()

  const held = tabB.streamHeldElsewhere(chatId)
  let unsubscribe = held.subscribe(() => {})
  onCleanup(() => unsubscribe())

  const watchName = `watch:chat-stream:${chatId}`
  const pendingSharedWatch = async () => {
    const snapshot = await navigator.locks.query()
    return (snapshot.pending ?? []).some(
      (entry) => entry.name === watchName && entry.mode === 'shared',
    )
  }

  await expect.poll(pendingSharedWatch, pollWithin).toBe(true)
  unsubscribe()
  unsubscribe = () => {}
  await expect.poll(pendingSharedWatch, pollWithin).toBe(false)
  await lock!.release()
})

test('a stream event from another tab marks the chat held and reports the release back', async () => {
  const released: Array<[string, string]> = []
  const channelName = `atelier.locks.test.${crypto.randomUUID()}`
  const tabA = createSyncLocks({ tabId: () => 'tab-a', channelName })
  const tabB = createSyncLocks({
    tabId: () => 'tab-b',
    channelName,
    onRemoteReleased: (chatId, holderTab) => released.push([chatId, holderTab]),
  })
  onCleanup(() => {
    tabA.dispose()
    tabB.dispose()
  })

  const lockA = await tabA.acquireStreamLock('chat-1')
  tabB.noteRemoteStream({ chatId: 'chat-1', tabId: 'tab-a', active: true })
  expect(tabB.streamHeldElsewhere('chat-1')()).toBe(true)

  lockA!.release()
  await expect.poll(() => tabB.streamHeldElsewhere('chat-1')(), pollWithin).toBe(false)
  expect(released).toEqual([['chat-1', 'tab-a']])
})

test('without Web Locks a BroadcastChannel claim with heartbeat blocks, releases and expires', async () => {
  withoutWebLocks()
  const { tabA, tabB } = twoTabsOfLocks()
  const heldElsewhereInB = watchHeldElsewhere(tabB, 'chat-1')

  const lockA = await tabA.acquireStreamLock('chat-1')
  expect(lockA).not.toBeNull()
  expect(await tabB.acquireStreamLock('chat-1')).toBeNull()
  await expect.poll(() => heldElsewhereInB(), pollWithin).toBe(true)

  await new Promise((resolve) => setTimeout(resolve, 1200))
  expect(heldElsewhereInB()).toBe(true)
  expect(await tabB.acquireStreamLock('chat-1')).toBeNull()

  lockA!.release()
  await expect.poll(() => heldElsewhereInB(), pollWithin).toBe(false)
  const lockB = await tabB.acquireStreamLock('chat-1')
  expect(lockB).not.toBeNull()

  const heldElsewhereInA = watchHeldElsewhere(tabA, 'chat-1')
  await expect.poll(() => heldElsewhereInA(), pollWithin).toBe(true)
  const closedAt = performance.now()
  tabB.dispose()
  await expect.poll(() => heldElsewhereInA(), pollWithin).toBe(false)
  expect(await tabA.acquireStreamLock('chat-1')).not.toBeNull()
  expect(performance.now() - closedAt).toBeLessThan(releaseWindowMs)
})

test('without Web Locks two simultaneous claims grant exactly one', async () => {
  withoutWebLocks()
  const { tabA, tabB } = twoTabsOfLocks()
  const [lockA, lockB] = await Promise.all([
    tabA.acquireStreamLock('chat-1'),
    tabB.acquireStreamLock('chat-1'),
  ])
  expect([lockA, lockB].filter(Boolean)).toHaveLength(1)
})

test('without Web Locks the releasing tab re-acquires as soon as release() resolves', async () => {
  withoutWebLocks()
  const { tabA } = twoTabsOfLocks()
  const lock = await tabA.acquireStreamLock('chat-1')
  expect(lock).not.toBeNull()

  const freeing = lock!.release()
  expect(freeing).toBeInstanceOf(Promise)
  await freeing
  expect(await tabA.acquireStreamLock('chat-1')).not.toBeNull()
})

const waitForLockKind = (
  channel: BroadcastChannel,
  kind: string,
  timeoutMs: number,
) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      channel.removeEventListener('message', onMessage)
      resolve(false)
    }, timeoutMs)
    const onMessage = (event: MessageEvent) => {
      const messageKind = (event.data as { kind?: string } | null)?.kind
      if (messageKind !== kind) return
      clearTimeout(timer)
      channel.removeEventListener('message', onMessage)
      resolve(true)
    }
    channel.addEventListener('message', onMessage)
  })

test('without Web Locks equal nonces and equal tab ids grant exactly one', async () => {
  withoutWebLocks()
  const channelName = `atelier.locks.test.${crypto.randomUUID()}`
  const randomUUID = vi
    .spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValue('00000000-0000-4000-8000-000000000001')
  onCleanup(() => randomUUID.mockRestore())

  const tabA = createSyncLocks({ tabId: () => 'tab-same', channelName })
  const tabB = createSyncLocks({ tabId: () => 'tab-same', channelName })
  onCleanup(() => {
    tabA.dispose()
    tabB.dispose()
  })

  const lockBPromise = tabB.acquireStreamLock('chat-1')
  await new Promise((resolve) => setTimeout(resolve, 40))
  const lockA = await tabA.acquireStreamLock('chat-1')
  const lockB = await lockBPromise
  expect(randomUUID).toHaveBeenCalled()
  expect([lockA, lockB].filter(Boolean)).toHaveLength(1)
})

test('without Web Locks a persisted pagehide keeps the claim and a real close announces it', async () => {
  withoutWebLocks()
  const channelName = `atelier.locks.test.${crypto.randomUUID()}`
  const tabA = createSyncLocks({ tabId: () => 'tab-a', channelName })
  const tabB = createSyncLocks({ tabId: () => 'tab-b', channelName })
  onCleanup(() => {
    tabA.dispose()
    tabB.dispose()
  })
  const spy = new BroadcastChannel(channelName)
  onCleanup(() => spy.close())

  const lock = await tabA.acquireStreamLock('chat-1')
  expect(lock).not.toBeNull()

  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
  expect(await waitForLockKind(spy, 'released', 50)).toBe(false)

  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }))
  expect(await waitForLockKind(spy, 'released', 50)).toBe(true)
  expect(
    await waitForLockKind(spy, 'held', channelLockTimings.heartbeatMs + 50),
  ).toBe(false)
  expect(await tabB.acquireStreamLock('chat-1')).not.toBeNull()
})

test('without Web Locks dispose announces the release instead of waiting out expiry', async () => {
  withoutWebLocks()
  const { tabA, tabB } = twoTabsOfLocks()
  const heldElsewhere = watchHeldElsewhere(tabB, 'chat-1')
  expect(await tabA.acquireStreamLock('chat-1')).not.toBeNull()
  expect(await tabB.acquireStreamLock('chat-1')).toBeNull()
  await expect.poll(() => heldElsewhere(), pollWithin).toBe(true)
  const started = performance.now()
  tabA.dispose()
  await expect
    .poll(async () => (await tabB.acquireStreamLock('chat-1')) !== null, {
      timeout: 400,
      interval: 25,
    })
    .toBe(true)
  expect(performance.now() - started).toBeLessThan(channelLockTimings.expiryMs)
})

test('the tombstone lock is visible to isTombstoneHeld until released or expired', async () => {
  const hold = holdTombstone('chat-gone', 10_000)
  expect(await isTombstoneHeld('chat-gone')).toBe(true)
  const heldNames = (await navigator.locks.query()).held?.map((lock) => lock.name)
  expect(heldNames).toContain('tombstone:chat-gone')

  const { tabB } = twoTabsOfLocks()
  expect(await tabB.isTombstoneHeld('chat-gone')).toBe(true)
  expect(await tabB.isTombstoneHeld('chat-never-deleted')).toBe(false)

  hold.release()
  await expect.poll(() => tabB.isTombstoneHeld('chat-gone'), pollWithin).toBe(false)
  expect(await isTombstoneHeld('chat-gone')).toBe(false)

  holdTombstone('chat-short', 50)
  expect(await isTombstoneHeld('chat-short')).toBe(true)
  await expect.poll(() => isTombstoneHeld('chat-short'), pollWithin).toBe(false)
})

test('without Web Locks the tombstone hold is announced to other tabs', async () => {
  withoutWebLocks()
  const { tabA, tabB } = twoTabsOfLocks()
  const hold = tabA.holdTombstone('chat-gone', 10_000)
  expect(await tabA.isTombstoneHeld('chat-gone')).toBe(true)
  expect(await tabB.isTombstoneHeld('chat-gone')).toBe(true)
  hold.release()
  await expect.poll(() => tabB.isTombstoneHeld('chat-gone'), pollWithin).toBe(false)
})

test('iframe harness: the second tab boots the full app and reports its sidebar text', async () => {
  await initStorage()
  await seedChats([{ id: 'chat-plans', title: 'Trip plans' }])

  const tab = await openTab()
  const booted = await tab.call({ type: 'boot', key: 'sk-or-v1-second-tab' })
  expect(booted.tabId).toBeTruthy()

  await expect
    .poll(() => tab.call({ type: 'read', selector: '[data-slot="Sidebar"]' }))
    .toContain('New chat')
  const state = await tab.call({ type: 'state' })
  expect(state.chats.map((chat) => chat.title)).toContain('Trip plans')
})

test('iframe harness: a BroadcastChannel event from the second tab reaches this tab', async () => {
  await initStorage()
  await seedChats([{ id: 'chat-plans', title: 'Trip plans' }])
  const thisTab = createSyncChannel({ tabId: () => 'tab-main' })
  onCleanup(() => thisTab.close())
  const received = collect(thisTab)

  const tab = await openTab()
  await tab.call({ type: 'boot', key: 'sk-or-v1-second-tab' })
  await tab.call({ type: 'rename', chatId: 'chat-plans', title: 'Lisbon trip' })

  await expect
    .poll(
      () =>
        received.find(
          (event) => event.type === 'chat' && event.chat.title === 'Lisbon trip',
        ),
      pollWithin,
    )
    .toBeTruthy()

  thisTab.publish({ type: 'chat-purged', chatId: 'chat-plans' })
  await expect
    .poll(async () => (await tab.call({ type: 'state' })).received)
    .toContain('chat-purged')
})

test('iframe harness: a lock held by the second tab blocks here and releases within 1 s of removing the iframe', async () => {
  const { tabA: thisTab } = twoTabsOfLocks()
  const heldElsewhere = watchHeldElsewhere(thisTab, 'chat-1')

  const tab = await openTab()
  expect(await tab.call({ type: 'acquire-lock', chatId: 'chat-1' })).toBe(true)
  expect(await thisTab.acquireStreamLock('chat-1')).toBeNull()
  await expect.poll(() => heldElsewhere(), pollWithin).toBe(true)

  const removedAt = performance.now()
  tab.remove()
  await expect.poll(() => heldElsewhere(), pollWithin).toBe(false)
  const lock = await thisTab.acquireStreamLock('chat-1')
  expect(lock).not.toBeNull()
  expect(performance.now() - removedAt).toBeLessThan(releaseWindowMs)
  lock!.release()
})

test('iframe harness without Web Locks: the claim of a closed tab expires within 1 s', async () => {
  withoutWebLocks()
  const thisTab = createSyncLocks({ tabId: () => 'tab-main' })
  onCleanup(() => thisTab.dispose())
  const heldElsewhere = watchHeldElsewhere(thisTab, 'chat-1')

  const tab = await openTab({ webLocks: false })
  expect(await tab.call({ type: 'acquire-lock', chatId: 'chat-1' })).toBe(true)
  expect(await thisTab.acquireStreamLock('chat-1')).toBeNull()
  await expect.poll(() => heldElsewhere(), pollWithin).toBe(true)

  const removedAt = performance.now()
  tab.remove()
  await expect.poll(() => heldElsewhere(), pollWithin).toBe(false)
  expect(await thisTab.acquireStreamLock('chat-1')).not.toBeNull()
  expect(performance.now() - removedAt).toBeLessThan(releaseWindowMs)
})

test('iframe harness: release in the second tab unblocks here within 1 s', async () => {
  const { tabA: thisTab } = twoTabsOfLocks()
  const tab = await openTab()
  expect(await tab.call({ type: 'acquire-lock', chatId: 'chat-1' })).toBe(true)
  expect(await thisTab.acquireStreamLock('chat-1')).toBeNull()

  const lock = await thisTab.acquireStreamLock('chat-2')
  expect(lock).not.toBeNull()
  expect(await tab.call({ type: 'acquire-lock', chatId: 'chat-2' })).toBe(false)
  await expect
    .poll(() => tab.call({ type: 'held-elsewhere', chatId: 'chat-2' }), pollWithin)
    .toBe(true)
  lock!.release()
  await expect
    .poll(() => tab.call({ type: 'held-elsewhere', chatId: 'chat-2' }), pollWithin)
    .toBe(false)

  await tab.call({ type: 'release-lock', chatId: 'chat-1' })
  await expect
    .poll(async () => {
      const acquired = await thisTab.acquireStreamLock('chat-1')
      acquired?.release()
      return acquired !== null
    }, pollWithin)
    .toBe(true)
})
