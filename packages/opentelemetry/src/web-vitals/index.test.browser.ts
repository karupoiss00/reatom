import { expect, test, vi } from 'vitest'

import { installBrowserCapture } from '../browserCapture.ts'
import type { BrowserCapture } from '../browserCapture.ts'
import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'
import { connectWebVitals } from './index.ts'

test('Chromium official web-vitals reports real buffered document TTFB without attribution payloads', async () => {
  const otel = {} as ReatomOpentelemetry
  const log = vi.fn()
  installBrowserCapture(otel, {
    enabled: () => true,
    snapshot: () => ({ context: {}, attributes: {} }),
    log,
    attach: (cleanup: () => void) => cleanup,
  } as unknown as BrowserCapture)
  const collector = connectWebVitals(otel)
  try {
    await expect
      .poll(() =>
        log.mock.calls.some(
          ([record]) => record.attributes['web_vital.name'] === 'TTFB',
        ),
      )
      .toBe(true)
    const ttfb = log.mock.calls.find(
      ([record]) => record.attributes['web_vital.name'] === 'TTFB',
    )![0]
    expect(ttfb.attributes['measurement.values'].ttfb).toBeGreaterThanOrEqual(0)
    expect(ttfb.attributes['measurement.values'].delta).toEqual(
      expect.any(Number),
    )
    expect(ttfb.attributes['measurement.values']).not.toHaveProperty('TTFB')
    expect(ttfb.attributes['measurement.unit']).toBe('ms')
    expect(ttfb.attributes).not.toHaveProperty('entries')
    expect(ttfb.attributes).not.toHaveProperty('attribution')
  } finally {
    collector.dispose()
  }
})
