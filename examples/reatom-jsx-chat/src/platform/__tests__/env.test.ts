import { afterEach, expect, test } from 'vitest'

import * as env from '../env'
import { resetRuntime } from '../runtime'

const tabChannelName = 'atelier.tabs'

type ClaimMessage = { type: 'claim' | 'taken'; tabId: string; nonce: string }

const openOtherTab = (ownedTabId: () => string) => {
  const channel = new BroadcastChannel(tabChannelName)
  const claims: ClaimMessage[] = []
  channel.addEventListener('message', (event: MessageEvent<ClaimMessage>) => {
    const message = event.data
    if (message.type !== 'claim') return
    claims.push(message)
    if (message.tabId === ownedTabId()) {
      channel.postMessage({ ...message, type: 'taken' })
    }
  })
  return { channel, claims }
}

let otherTab: BroadcastChannel | null = null

afterEach(() => {
  otherTab?.close()
  otherTab = null
  resetRuntime()
})

test('keeps the tab id when no other live tab owns it', async () => {
  const before = env.tabId
  const other = openOtherTab(() => 'some-other-tab')
  otherTab = other.channel

  await expect(env.claimTabId()).resolves.toBe(before)
  expect(env.tabId).toBe(before)
  expect(other.claims.map((claim) => claim.tabId)).toEqual([before])
})

test('takes a fresh tab id when a duplicated tab already owns it', async () => {
  const duplicated = env.tabId
  const other = openOtherTab(() => duplicated)
  otherTab = other.channel

  const claimed = await env.claimTabId()

  expect(claimed).not.toBe(duplicated)
  expect(env.tabId).toBe(claimed)
  expect(sessionStorage.getItem('atelier.tab')).toBe(claimed)
})

test('answers claims for its own id so a later duplicate regenerates', async () => {
  await env.claimTabId()
  const probe = new BroadcastChannel(tabChannelName)
  otherTab = probe
  const answered = new Promise<ClaimMessage>((resolve) => {
    probe.addEventListener('message', (event: MessageEvent<ClaimMessage>) => {
      if (event.data.type === 'taken') resolve(event.data)
    })
  })

  probe.postMessage({ type: 'claim', tabId: env.tabId, nonce: 'duplicate' })

  await expect(answered).resolves.toEqual({
    type: 'taken',
    tabId: env.tabId,
    nonce: 'duplicate',
  })
})

test('resetRuntime lets the next claim announce again', async () => {
  await env.claimTabId()
  resetRuntime()
  const other = openOtherTab(() => 'some-other-tab')
  otherTab = other.channel

  await env.claimTabId()

  expect(other.claims).toHaveLength(1)
})
