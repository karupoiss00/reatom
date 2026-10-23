import { context, isAtom } from '@reatom/core'
import { afterEach, expect, test, vi } from 'vitest'

import { withBrowserNetworkMonkeypatch } from '../browser-network/index.ts'
import { withBrowserPerformance } from '../browser-performance/index.ts'
import { reatomTestTelemetry } from '../test-helpers.ts'
import { withWebVitals } from '../web-vitals/index.ts'
import { withBrowserConsoleMonkeypatch } from './index.ts'

afterEach(() => vi.unstubAllGlobals())

test('feature factories are inert until applied; SSR retains genuine requested-enable controls', () => {
  vi.stubGlobal('window', undefined)
  const nativeFetch = globalThis.fetch
  const nativeWarn = console.warn
  const observer = vi.fn()
  vi.stubGlobal('PerformanceObserver', observer)
  const extensions = [
    withBrowserConsoleMonkeypatch(),
    withBrowserNetworkMonkeypatch(),
    withWebVitals(),
    withBrowserPerformance(),
  ] as const
  expect(globalThis.fetch).toBe(nativeFetch)
  expect(console.warn).toBe(nativeWarn)
  expect(observer).not.toHaveBeenCalled()
  const otel = reatomTestTelemetry({
    name: 'ssr-browser-features',
    endpoint: null,
    skipGlobalExtension: true,
  }).extend(...extensions)
  try {
    expect(isAtom(otel)).toBe(true)
    expect(otel.instanceName).toBe('ssr-browser-features')
    expect(otel.otlp().endpoint).toBeNull()
    otel.set((config) => ({ ...config, signals: { logs: false } }))
    expect(otel().signals?.logs).toBe(false)
    for (const control of [
      otel.browserConsole,
      otel.browserNetwork,
      otel.webVitals,
      otel.browserPerformance,
    ]) {
      expect(isAtom(control)).toBe(true)
      expect(control()).toBe(true)
      control.setFalse()
      expect(control()).toBe(false)
      control.setTrue()
      expect(control()).toBe(true)
    }
    otel.browserNetwork.setFalse()
    expect(() => otel.extend(withBrowserNetworkMonkeypatch())).toThrow()
    expect(() => otel.extend(withBrowserConsoleMonkeypatch())).toThrow()
    expect(() => otel.extend(withWebVitals())).toThrow()
    expect(() => otel.extend(withBrowserPerformance())).toThrow()
    expect(observer).not.toHaveBeenCalled()
    expect(globalThis.fetch).toBe(nativeFetch)
    expect(console.warn).toBe(nativeWarn)
    otel.dispose()
    for (const control of [
      otel.browserConsole,
      otel.browserNetwork,
      otel.webVitals,
      otel.browserPerformance,
    ]) {
      expect(() => context.start(() => control.setTrue())).toThrow()
      expect(control()).toBe(false)
    }
    expect(() => otel.extend(withBrowserConsoleMonkeypatch())).toThrow()
  } finally {
    otel.dispose()
  }
})
