import { action, bind, context } from '@reatom/core'
import { expect, test } from 'vitest'

import { resourceAttributesVar } from './resourceAttributesVar.ts'
import {
  parseLogRecords,
  parseSpans,
  reatomTestTelemetry,
} from './test-helpers.ts'
import type { OtlpAnyValue, OtlpAttrValue } from './toOtlpValue.ts'

const setup = (traced: boolean, captureValues?: false) => {
  const bodies: string[] = []
  const run = context.start(() => bind(<T>(callback: () => T) => callback()))
  const otel = traced
    ? reatomTestTelemetry({
        name: 'captureDefaults',
        endpoint: 'https://collector.invalid',
        serviceName: 'capture-defaults',
        filter: (target) => target.name.startsWith('capture-default.'),
        retry: { maxRetries: 0 },
        ...(captureValues === undefined ? {} : { captureValues }),
        fetch: async (_url, init) => {
          bodies.push(String(init?.body))
          return new Response(null)
        },
      })
    : undefined
  return { run, otel, bodies, spans: () => bodies.flatMap(parseSpans) }
}

const expectGettersUntouched = async (
  kind: 'params' | 'payload' | 'async-payload',
  traced: boolean,
) => {
  const { run, otel, spans } = setup(traced)
  let getterCalls = 0
  let bodyCalls = 0
  const value = {
    get privateValue() {
      getterCalls++
      return 'getter-private-sentinel'
    },
  }
  const input = kind === 'params' ? value : 7
  const applicationPromise = Promise.resolve(value)
  const output =
    kind === 'params'
      ? 7
      : kind === 'async-payload'
        ? applicationPromise
        : value
  try {
    const invoke = run(() => {
      const target = action((received: unknown) => {
        bodyCalls++
        expect(received).toBe(input)
        return output
      }, `capture-default.${kind}`)
      return () => target(input)
    })
    const result = run(invoke)
    if (kind === 'async-payload') {
      expect(result).toBeInstanceOf(Promise)
      expect(result).not.toBe(applicationPromise)
      expect(await result).toBe(value)
      expect(await applicationPromise).toBe(value)
    } else {
      expect(result).toBe(output)
    }
    expect(bodyCalls).toBe(1)
    await otel?.flush()
    expect(spans().map((span) => span.name)).toEqual(
      traced ? [`capture-default.${kind}`] : [],
    )
    expect(getterCalls).toBe(0)
  } finally {
    otel?.dispose()
  }
}

for (const kind of ['params', 'payload', 'async-payload'] as const) {
  test(`default capture leaves ${kind} getters untouched`, () =>
    expectGettersUntouched(kind, true))
}

// One untraced control: the traced variants carry the real contract that a
// default adapter never evaluates application getters.
test('without an adapter, application getters stay untouched', () =>
  expectGettersUntouched('params', false))

test('default span captures params and payload without an opt-in flag', async () => {
  const { run, otel, bodies, spans } = setup(true)
  const input = {
    sku: 'parameter-public-sentinel',
    password: 'parameter-private-sentinel',
  }
  const output = { ok: true, token: 'result-private-sentinel' }
  try {
    const target = run(() =>
      action((received: typeof input) => {
        expect(received).toBe(input)
        return output
      }, 'capture-default.metadata'),
    )
    expect(run(() => target(input))).toBe(output)
    await otel!.flush()
    expect(spans().map((span) => span.name)).toEqual([
      'capture-default.metadata',
    ])
    const wire = bodies.join('')
    expect(wire).toContain('parameter-public-sentinel')
    expect(wire).toContain('[redacted]')
    expect(wire).not.toContain('parameter-private-sentinel')
    expect(wire).not.toContain('result-private-sentinel')
    expect(spans()[0]!.attributes).toHaveProperty('reatom.params')
    expect(spans()[0]!.attributes).toHaveProperty('reatom.payload')
  } finally {
    otel!.dispose()
  }
})

test('default exception preserves the throw and captures message and stack', async () => {
  const { run, otel, bodies, spans } = setup(true)
  const error = new Error('message-private-sentinel')
  Object.defineProperty(error, 'stack', {
    configurable: true,
    value: 'stack-private-sentinel',
  })
  error.name = 'name-private-sentinel'
  try {
    const target = run(() =>
      action(() => {
        throw error
      }, 'capture-default.exception'),
    )
    let caughtFlag = false
    let caught: unknown
    try {
      run(target)
    } catch (thrown) {
      caughtFlag = true
      caught = thrown
    }
    expect(caughtFlag).toBe(true)
    expect(caught).toBe(error)
    await otel!.flush()
    expect(spans().map((span) => span.name)).toEqual([
      'capture-default.exception',
    ])
    expect(spans()[0]!.events).toEqual([])
    const exceptions = bodies
      .flatMap(parseLogRecords)
      .filter((record) => record.eventName === 'exception')
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0]!.severityNumber).toBe(17)
    expect(exceptions[0]!.traceId).toBe(spans()[0]!.traceId)
    expect(exceptions[0]!.spanId).toBe(spans()[0]!.spanId)
    expect(exceptions[0]!.attributes).toMatchObject({
      'exception.type': 'Error',
      'exception.message': 'message-private-sentinel',
      'exception.stacktrace': 'stack-private-sentinel',
    })
    expect(bodies.join('')).not.toContain('name-private-sentinel')
    expect(spans()[0]!.status?.message).toBe('message-private-sentinel')
  } finally {
    otel!.dispose()
  }
})

const resourceFixture = (
  kind: 'literal' | 'object' | 'array' | 'bytes',
): {
  attributes: Record<string, OtlpAttrValue>
  mutate: () => void
  expected: OtlpAnyValue
} => {
  if (kind === 'literal') {
    const attributes = { tenant: 'original' }
    return {
      attributes,
      mutate: () => {
        attributes.tenant = 'mutated'
      },
      expected: { stringValue: 'original' },
    }
  }
  if (kind === 'object') {
    const value = { name: 'original' }
    return {
      attributes: { tenant: value },
      mutate: () => {
        value.name = 'mutated'
      },
      expected: {
        kvlistValue: {
          values: [{ key: 'name', value: { stringValue: 'original' } }],
        },
      },
    }
  }
  if (kind === 'array') {
    const value = ['original']
    return {
      attributes: { tenant: value },
      mutate: () => {
        value[0] = 'mutated'
      },
      expected: { arrayValue: { values: [{ stringValue: 'original' }] } },
    }
  }
  const value = new Uint8Array([1, 2, 3])
  return {
    attributes: { tenant: value },
    mutate: () => {
      value.fill(9)
    },
    expected: { bytesValue: 'AQID' },
  }
}

for (const source of ['factory', 'ambient'] as const) {
  test.each(['literal', 'object', 'array', 'bytes'] as const)(
    `${source} resource owns its %s snapshot before later mutation`,
    async (kind: 'literal' | 'object' | 'array' | 'bytes') => {
      const { attributes, mutate, expected } = resourceFixture(kind)
      const bodies: string[] = []
      const run = context.start(() =>
        bind(<T>(callback: () => T) => callback()),
      )
      const otel = reatomTestTelemetry({
        name: 'captureDefaults',
        endpoint: 'https://collector.invalid',
        serviceName: 'resource-snapshot',
        resourceAttributes: source === 'factory' ? attributes : undefined,
        filter: (target) => target.name === 'capture-default.resource',
        retry: { maxRetries: 0 },
        fetch: async (_url, init) => {
          bodies.push(String(init?.body))
          return new Response(null)
        },
      })
      try {
        // Factory data must already be owned before any execution starts.
        if (source === 'factory') mutate()
        const target = run(() => action(() => 7, 'capture-default.resource'))
        expect(
          run(() =>
            source === 'ambient'
              ? resourceAttributesVar.run(attributes, target)
              : target(),
          ),
        ).toBe(7)
        if (source === 'ambient') mutate()
        expect(bodies).toHaveLength(0)
        expect(otel.otlp.stats().queued).toBe(1)
        await otel.flush()
        expect(bodies.flatMap(parseSpans).map((span) => span.name)).toEqual([
          'capture-default.resource',
        ])
        const exported = JSON.parse(bodies[0]!) as {
          resourceSpans: {
            resource: {
              attributes: { key: string; value: OtlpAnyValue }[]
            }
          }[]
        }
        expect(exported.resourceSpans).toHaveLength(1)
        const resource = exported.resourceSpans[0]!.resource.attributes
        expect(
          resource.find(({ key }) => key === 'service.name')?.value,
        ).toEqual({
          stringValue: 'resource-snapshot',
        })
        expect(resource.find(({ key }) => key === 'tenant')?.value).toEqual(
          expected,
        )
      } finally {
        otel.dispose()
      }
    },
  )
}
