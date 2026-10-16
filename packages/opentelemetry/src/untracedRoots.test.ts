import { action, atom, computed, context, log, top } from '@reatom/core'
import { expect, test } from 'vitest'

import { reatomOpentelemetry } from './reatomOpentelemetry.ts'
import { UNTRACED_ROOTS } from './untracedRoots.ts'

const settleHooks = () => Promise.resolve()

const stringAttr = (record: object, key: string): string | undefined => {
  if (!('attributes' in record) || !Array.isArray(record.attributes)) return
  for (const entry of record.attributes) {
    if (!entry || typeof entry !== 'object' || !('key' in entry)) continue
    if (entry.key !== key) continue
    const value = 'value' in entry ? entry.value : undefined
    if (
      value &&
      typeof value === 'object' &&
      'stringValue' in value &&
      typeof value.stringValue === 'string'
    ) {
      return value.stringValue
    }
  }
  return
}

const spanNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('name' in record)) continue
    if (typeof record.name === 'string' && 'spanId' in record) {
      names.push(record.name)
    }
  }
  return names
}

const updateNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('eventName' in record)) {
      continue
    }
    if (
      record.eventName !== 'reatom.atom.update' &&
      record.eventName !== 'reatom.computed.update'
    ) {
      continue
    }
    const name = stringAttr(record, 'reatom.name')
    if (name) names.push(name)
  }
  return names
}

const eventNames = (records: readonly unknown[]): string[] => {
  const names: string[] = []
  for (const record of records) {
    if (!record || typeof record !== 'object' || !('eventName' in record)) {
      continue
    }
    if (typeof record.eventName === 'string') names.push(record.eventName)
  }
  return names
}

const logLabels = (records: readonly unknown[]): string[] => {
  const labels: string[] = []
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const label = stringAttr(record, 'reatom.log.label')
    if (label) labels.push(label)
  }
  return labels
}

const registerUntraced = (root: object) => {
  const holder = globalThis as typeof globalThis & {
    [UNTRACED_ROOTS]?: WeakSet<object>
  }
  const roots = (holder[UNTRACED_ROOTS] ??= new WeakSet())
  roots.add(root)
}

test('UNTRACED_ROOTS is the global registration symbol', () => {
  expect(UNTRACED_ROOTS).toBe(Symbol.for('reatom.opentelemetry.untracedRoots'))
  expect(UNTRACED_ROOTS.description).toBe('reatom.opentelemetry.untracedRoots')
})

test('an untraced root records nothing and a normal root still records', async () => {
  const otel = reatomOpentelemetry({
    name: `untraced-${Math.random().toString(16).slice(2)}`,
    endpoint: null,
    serviceName: 'untraced',
    batchInterval: 100_000,
    maxBatchSize: 100,
    maxQueueSize: 100,
    useBeacon: false,
  })
  const shared = action(() => 'pong', 'shared.ping')
  const quiet = context.start()
  registerUntraced(quiet.root)
  const loud = context.start()
  try {
    quiet.run(() => {
      expect(top().root).toBe(quiet.root)
      const count = atom(0, 'quiet.count')
      const doubled = computed(() => count() * 2, 'quiet.doubled')
      doubled.subscribe(() => {})
      const bump = action(() => {
        count.set(count() + 1)
        return doubled()
      }, 'quiet.bump')
      const explicit = action(() => 'quiet-explicit', 'quiet.explicit').extend(
        otel.withOTel(),
      )
      expect(shared()).toBe('pong')
      expect(bump()).toBe(2)
      expect(explicit()).toBe('quiet-explicit')
      log('quiet-body', { hidden: true })
      log.label('quiet-label', { hidden: true })
      otel.log('quiet.public', { hidden: true })
    })
    await settleHooks()

    expect(otel.records()).toEqual([])
    expect(otel.stats()).toMatchObject({
      queued: 0,
      exported: 0,
      dropped: 0,
    })
    expect(spanNames(otel.records())).not.toContain('app.session')

    loud.run(() => {
      expect(top().root).toBe(loud.root)
      const count = atom(0, 'loud.count')
      const doubled = computed(() => count() * 2, 'loud.doubled')
      doubled.subscribe(() => {})
      const bump = action(() => {
        count.set(count() + 1)
        return doubled()
      }, 'loud.bump')
      const explicit = action(() => 'loud-explicit', 'loud.explicit').extend(
        otel.withOTel(),
      )
      log('loud-body', { shown: true })
      log.label('loud-label', { shown: true })
      otel.log('loud.public', { shown: true })
      expect(shared()).toBe('pong')
      expect(bump()).toBe(2)
      expect(explicit()).toBe('loud-explicit')
    })
    await settleHooks()

    const records = otel.records()
    const text = JSON.stringify(records)
    expect(text).not.toContain('quiet')
    expect(spanNames(records)).toEqual(
      expect.arrayContaining([
        'app.session',
        'shared.ping',
        'loud.bump',
        'loud.explicit',
      ]),
    )
    expect(updateNames(records)).toEqual(
      expect.arrayContaining(['loud.count', 'loud.doubled']),
    )
    expect(eventNames(records)).toEqual(
      expect.arrayContaining(['reatom.log', 'loud.public']),
    )
    expect(logLabels(records)).toContain('loud-label')
    expect(logLabels(records)).not.toContain('quiet-label')
    expect(text).toContain('loud-body')
  } finally {
    context.start(() => otel.dispose())
  }
})
