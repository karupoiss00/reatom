import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { afterAll, expect, test } from 'vitest'

import { analytics, consent, otel } from '../../setup'
import { ConsentBanner } from './ConsentBanner'

const countPageViews = (value: unknown, seen = new Set<object>()): number => {
  if (value === 'app.page_view') return 1
  if (value === null || typeof value !== 'object') return 0
  if (seen.has(value)) return 0
  seen.add(value)
  const nested = Array.isArray(value) ? value : Object.values(value)
  return nested.reduce<number>(
    (total, item) => total + countPageViews(item, seen),
    0,
  )
}

const pageViewCount = () => countPageViews(otel.records())

afterAll(() => {
  context.start(() => {
    analytics.dispose()
    otel.dispose()
  })
})

test('web analytics uses the chat tracer and waits for consent', async () => {
  expect(analytics.otel).toBe(otel)
  expect(otel.name).toBe('chat')
  expect(pageViewCount()).toBe(0)

  const host = document.createElement('div')
  document.body.append(host)
  const view = mount(host, <ConsentBanner />)

  try {
    const checkbox = host.querySelector<HTMLInputElement>(
      '[data-testid="consent-analytics"]',
    )
    const save = host.querySelector<HTMLButtonElement>(
      '[data-testid="consent-save"]',
    )
    expect(checkbox).toBeInstanceOf(HTMLInputElement)
    expect(save).toBeInstanceOf(HTMLButtonElement)
    expect(host.textContent).toContain('Analytics stay off until you save.')
    expect(host.querySelector('[data-testid="consent-withdraw"]')).toBeNull()

    checkbox!.click()
    save!.click()
    await expect.poll(() => consent.snapshot()?.categories.analytics).toBe(true)
    analytics.pageView()
    await expect.poll(pageViewCount).toBeGreaterThan(0)
    expect(host.textContent).toContain('Analytics is on.')
    expect(host.querySelector('[data-testid="consent-save"]')).toBeNull()

    const withdraw = host.querySelector<HTMLButtonElement>(
      '[data-testid="consent-withdraw"]',
    )
    expect(withdraw).toBeInstanceOf(HTMLButtonElement)
    const viewsWhileGranted = pageViewCount()
    withdraw!.click()
    await expect
      .poll(() => consent.snapshot()?.categories.analytics)
      .toBe(false)
    expect(host.textContent).toContain('Analytics is off.')
    analytics.pageView()
    expect(pageViewCount()).toBe(viewsWhileGranted)
  } finally {
    view.unmount()
    host.remove()
  }
})
