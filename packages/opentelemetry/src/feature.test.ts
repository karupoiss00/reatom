import { action, atom, context } from '@reatom/core'
import { expect, test } from 'vitest'

import { featureControl } from './feature.ts'
import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { reatomTestTelemetry } from './test-helpers.ts'

test('feature controls eagerly install, synchronously toggle, reject duplicates and end with parent', () => {
  const otel = reatomTestTelemetry({ name: 'feature-controls', endpoint: null })
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
    const otel = reatomTestTelemetry({ name: 'feature-owner', endpoint: null })
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
  const otel = reatomTestTelemetry({
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
  const otel = reatomTestTelemetry({ name: 'observable-roots', endpoint: null })
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
    const otel = reatomTestTelemetry({
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

test('native capture snapshots stay stable between writes and replace synchronously across roots', () => {
  const otel = reatomOpentelemetry({
    name: 'snapshot-stability',
    serviceName: 'test',
    skipGlobalExtension: true,
  })
  try {
    const empty = otel.records()
    const initialStats = otel.stats()
    expect(otel.records()).toBe(empty)
    expect(otel.stats()).toBe(initialStats)
    const run = action(() => 'ok', 'snapshot.work').extend(otel.withOTel())
    const firstRoot = context.start()
    firstRoot.run(run)
    const first = otel.records()
    expect(first).toHaveLength(1)
    expect(first).not.toBe(empty)
    expect(empty).toEqual([])
    expect(otel.records()).toBe(first)
    const firstStats = otel.stats()
    expect(firstStats).toMatchObject({ active: 0, captured: 1, retained: 1 })
    expect(otel.stats()).toBe(firstStats)
    const secondRoot = context.start()
    secondRoot.run(run)
    const second = otel.records()
    expect(second).toHaveLength(2)
    expect(second).not.toBe(first)
    expect(first).toHaveLength(1)
    expect(otel.records()).toBe(second)
    expect(firstRoot.run(otel.records)).toHaveLength(1)
    expect(secondRoot.run(otel.records)).toHaveLength(1)
    otel.clearRecords()
    const cleared = otel.records()
    expect(cleared).toEqual([])
    expect(otel.records()).toBe(cleared)
    expect(second).toHaveLength(2)
    expect(otel.stats()).toMatchObject({ active: 0, captured: 2, retained: 0 })
  } finally {
    otel.dispose()
  }
})
