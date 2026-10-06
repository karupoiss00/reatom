import { expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'

test('context ring draws a partial arc', async () => {
  await bootApp({
    key: 'sk-or-v1-ring',
    keyMeta: limitedKey,
    viewport: { width: 1280, height: 800 },
    timings: { flushMs: 40 },
  })
  activeChat().draft.text.set('x'.repeat(160_000))
  const ring = () => document.querySelector<HTMLElement>('[data-context-ring]')
  await expect.poll(() => ring()?.getAttribute('data-empty')).toBe('false')
  const offset = Number(
    document.querySelector('[data-context-fill]')?.getAttribute('stroke-dashoffset'),
  )
  expect(offset).toBeGreaterThan(50)
  expect(offset).toBeLessThan(90)
  document
    .querySelector('[data-slot="CostChip"]')
    ?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await page.screenshot({ path: '/tmp/context-ring.png' })
  unmountApp()
})
