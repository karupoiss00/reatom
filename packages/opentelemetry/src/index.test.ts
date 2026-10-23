import { expect, test } from 'vitest'

import * as pkg from './index.ts'

test('exposes the high-level factory and its types', () => {
  expect(typeof pkg.reatomOpentelemetry).toBe('function')
  expect('otlpTransport' in pkg).toBe(false)
})

test('does not export v1 resource override or writable trace IDs', () => {
  expect('traceIdVar' in pkg).toBe(false)
  expect('spanIdVar' in pkg).toBe(false)
  expect('resourceAttributesVar' in pkg).toBe(false)
  expect('SpanContext' in pkg).toBe(false)
})

test('does not export connectWebAnalytics from the root barrel', () => {
  expect('connectWebAnalytics' in pkg).toBe(false)
})

test('instance exposes traceVar instead of the v1 context helpers', () => {
  const otel = pkg.reatomOpentelemetry({
    name: 'index',
    serviceName: 'api',
  })
  try {
    expect(otel).not.toHaveProperty('startTrace')
    expect(otel).not.toHaveProperty('withContext')
    expect(otel).not.toHaveProperty('getCurrentContext')
    expect(otel.traceVar.get()).toBeUndefined()
  } finally {
    otel.dispose()
  }
})
