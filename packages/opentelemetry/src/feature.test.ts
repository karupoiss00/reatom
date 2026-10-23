import { action, atom, context } from '@reatom/core'
import { expect, test } from 'vitest'
import { featureControl } from './feature.ts'
import { reatomOpentelemetry } from './reatomOpentelemetry.ts'

test('feature controls eagerly install, synchronously toggle, reject duplicates and end with parent', () => {
  const otel = reatomOpentelemetry({ name: 'feature-controls', endpoint: null })
  let installed = 0,
    stopped = 0
  const control = featureControl(otel, 'fixture', () => {
    installed++
    return {
      dispose() {
        stopped++
      },
    }
  })
  expect(installed).toBe(1)
  expect(() =>
    featureControl(otel, 'fixture', () => {
      installed++
      return { dispose() {} }
    }),
  ).toThrow(/already installed/)
  expect(installed).toBe(1)
  control.setFalse()
  expect(stopped).toBe(1)
  control.setTrue()
  expect(installed).toBe(2)
  otel.dispose()
  expect(stopped).toBe(2)
  expect(control()).toBe(false)
  expect(() => control.setTrue()).toThrow(/disposed/)
  expect(() => featureControl(otel, 'after', () => ({ dispose() {} }))).toThrow(
    /disposed/,
  )
})

test('feature setup and teardown bind the attachment context and discard reentrant stale handles', () => {
  const contextValue = atom('default', 'fixture.context')
  const contexts: string[] = []
  let stopped = 0
  const owned = context.start(() => {
    contextValue.set('owner')
    const otel = reatomOpentelemetry({ name: 'feature-owner', endpoint: null })
    const control = featureControl(otel, 'fixture', () => {
      contexts.push(contextValue())
      return {
        dispose() {
          contexts.push(contextValue())
          stopped++
        },
      }
    })
    return { otel, control }
  })
  owned.control.setFalse()
  owned.control.setTrue()
  owned.otel.dispose()
  expect(contexts).toEqual(['owner', 'owner', 'owner', 'owner'])
  expect(stopped).toBe(2)
  const otel = reatomOpentelemetry({
    name: 'feature-reentrant',
    endpoint: null,
  })
  let staleStopped = 0
  const control = featureControl(otel, 'fixture', () => {
    ;(otel as any).fixture.setFalse()
    return {
      dispose() {
        staleStopped++
      },
    }
  })
  expect(control()).toBe(false)
  expect(staleStopped).toBe(1)
  otel.dispose()
})

test('aggregate observable view updates from isolated capture roots while isolated streams stay disjoint', async () => {
  const otel = reatomOpentelemetry({ name: 'observable-roots', endpoint: null })
  const observed: number[] = []
  const stop = otel.records.subscribe((records) =>
    observed.push(records.length),
  )
  const run = action(() => 'ok', 'app.isolated-capture').extend(otel.withOTel())
  const first = context.start(() => {
    run()
    return otel.records() as any[]
  })
  const second = context.start(() => {
    run()
    return otel.records() as any[]
  })
  expect(first).toHaveLength(1)
  expect(second).toHaveLength(1)
  expect(first[0].spanId).not.toBe(second[0].spanId)
  expect(otel.records()).toHaveLength(2)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(observed.some((size) => size === 2)).toBe(true)
  stop()
  otel.dispose()
})

test('cross-context writes drive one requested lifecycle and synchronize known native atom views', () => {
  let installs = 0,
    stops = 0
  const owner = context.start()
  const owned = owner.run(() => {
    const otel = reatomOpentelemetry({
      name: 'cross-context-feature-control',
      endpoint: null,
    })
    const control = featureControl(otel, 'fixture', () => {
      installs++
      return {
        dispose() {
          stops++
        },
      }
    })
    expect(control()).toBe(true)
    return { otel, control }
  })
  owned.control.setFalse()
  expect(owner.run(() => owned.control())).toBe(false)
  expect(stops).toBe(1)
  owner.run(() => owned.control.setTrue())
  expect(installs).toBe(2)
  expect(owned.control()).toBe(true)
  const fresh = context.start()
  owned.control.setFalse()
  expect(fresh.run(() => owned.control())).toBe(false)
  expect(installs).toBe(2)
  owner.run(() => owned.control.setTrue())
  expect(fresh.run(() => owned.control())).toBe(true)
  expect(installs).toBe(3)
  owned.otel.dispose()
  expect(stops).toBe(3)
  expect(owner.run(() => owned.control())).toBe(false)
  expect(fresh.run(() => owned.control())).toBe(false)
})
