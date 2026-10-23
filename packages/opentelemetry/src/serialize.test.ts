import { action, bind, context } from '@reatom/core'
import { expect, test } from 'vitest'

import { parseSpans, reatomTestTelemetry } from './test-helpers.ts'

type FactoryInput = Parameters<typeof reatomTestTelemetry>[0] & {
  name?: string
  serialize?: (value: unknown, key: string) => unknown
}

const start = (extra: Partial<FactoryInput> = {}) => {
  const bodies: string[] = []
  const run = context.start(() => bind(<T>(callback: () => T) => callback()))
  const otel = reatomTestTelemetry({
    name: 'serialize-f05',
    endpoint: 'https://collector.invalid',
    serviceName: 'serialize-f05',
    filter: (target) => target.name.startsWith('serialize.'),
    retry: { maxRetries: 0 },
    batchInterval: 100_000,
    fetch: async (_url, init) => {
      bodies.push(String(init?.body))
      return new Response(null)
    },
    ...extra,
  } as Parameters<typeof reatomTestTelemetry>[0])
  const wire = () => bodies.join('')
  const spans = () => bodies.flatMap(parseSpans)
  return { run, otel, bodies, wire, spans }
}

const capturedField = (
  span: ReturnType<typeof parseSpans>[number] | undefined,
  field: 'params' | 'payload',
) => span?.attributes[`reatom.${field}`]

test('capture is on by default: params and payload appear without an opt-in flag', async () => {
  const { run, otel, wire, spans } = start()
  const input = {
    sku: 'sku-public-sentinel',
    password: 'password-private-sentinel',
    nested: {
      secret: 'nested-secret-sentinel',
      public: 'nested-public-sentinel',
    },
  }
  const output = { ok: true, token: 'token-private-sentinel' }
  try {
    const purchase = run(() =>
      action((received: typeof input) => {
        expect(received).toBe(input)
        return output
      }, 'serialize.purchase'),
    )
    expect(run(() => purchase(input))).toBe(output)
    await otel.flush()
    expect(spans().map((span) => span.name)).toEqual(['serialize.purchase'])
    expect(wire()).toContain('sku-public-sentinel')
    expect(capturedField(spans()[0], 'params')).toBeDefined()
    expect(capturedField(spans()[0], 'payload')).toBeDefined()
    expect(String(capturedField(spans()[0], 'params'))).toContain(
      'sku-public-sentinel',
    )
  } finally {
    otel.dispose()
  }
})

test('masked keys are visible as redacted markers in the exported JSON', async () => {
  const { run, otel, wire, spans } = start()
  const input = {
    sku: 'sku-public-sentinel',
    password: 'password-private-sentinel',
    nested: {
      secret: 'nested-secret-sentinel',
      public: 'nested-public-sentinel',
    },
  }
  const output = { ok: true, token: 'token-private-sentinel' }
  try {
    const purchase = run(() =>
      action(
        (received: typeof input) => received && output,
        'serialize.redact',
      ),
    )
    expect(run(() => purchase(input))).toBe(output)
    await otel.flush()
    expect(spans().map((span) => span.name)).toEqual(['serialize.redact'])
    expect(wire()).toContain('sku-public-sentinel')
    expect(wire()).toContain('[redacted]')
    expect(wire()).not.toContain('password-private-sentinel')
    expect(wire()).not.toContain('nested-secret-sentinel')
    expect(wire()).not.toContain('token-private-sentinel')
  } finally {
    otel.dispose()
  }
})

test('oversized capture still produces a record or dropped.oversized; app result is unchanged', async () => {
  const { run, otel, wire, spans } = start()
  const output = `oversized-public-sentinel-${'x'.repeat(4000)}`
  try {
    const target = run(() => action(() => output, 'serialize.oversized'))
    expect(run(target)).toBe(output)
    await otel.flush()
    const truncated = wire().includes('[Truncated]')
    const droppedOversized = otel.otlp.stats().droppedByReason.oversized > 0
    expect(truncated || droppedOversized).toBe(true)
    if (!droppedOversized) {
      expect(spans().map((span) => span.name)).toEqual(['serialize.oversized'])
    }
  } finally {
    otel.dispose()
  }
})

test('throwing custom serializer records [Failed] and does not throw into the app', async () => {
  const { run, otel, wire, spans } = start({
    serialize: () => {
      throw new Error('custom-serializer-boom')
    },
  })
  const output = { ok: 'serialize-app-result' }
  try {
    const target = run(() =>
      action(() => output, 'serialize.throwing-serializer'),
    )
    expect(run(target)).toBe(output)
    expect(otel.otlp.stats()).toMatchObject({
      droppedByReason: { observation: 0 },
    })
    await otel.flush()
    expect(spans().map((span) => span.name)).toEqual([
      'serialize.throwing-serializer',
    ])
    expect(wire()).toContain('[Failed]')
    expect(wire()).not.toContain('serialize-app-result')
    expect(wire()).not.toContain('custom-serializer-boom')
  } finally {
    otel.dispose()
  }
})
