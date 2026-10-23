import {
  action,
  atom,
  computed,
  context,
  notify,
  withConnectHook,
} from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from './chrome'
import { mountLogIds } from './mount'
import type { AdminRecord } from './ingest'

const settleHooks = () => new Promise((resolve) => setTimeout(resolve, 0))

const captureSearchApp = async () => {
  const otel = context.start(() => {
    const instance = reatomOpentelemetry({
      name: 'mountLogs',
      serviceName: 'mount-logs',
    })
    const query = atom('', 'search.query')
    const setQuery = action(
      (next: string) => query.set(next),
      'search.query.set',
    )
    const results = computed(() => [query()], 'search.results')
    const history = atom(0, 'search.history').extend(
      withConnectHook((target) => {
        target.set(3)
      }),
    )
    results.subscribe(() => {})
    history.subscribe(() => {})
    setQuery('reatom')
    return instance
  })
  await settleHooks()
  return context.start(() => {
    const records = [...otel.records()]
    otel.dispose()
    return records
  })
}

const rowsOf = (admin: ReturnType<typeof reatomOtlpAdmin>) => {
  admin.gantt.expandAll()
  return admin.gantt.rows().map((record) => ({
    name: record.atomName ?? record.name,
    kind: record.kind,
    causes: record.causeIds.length,
  }))
}

test('mount logs are hidden by default, .set stays, and the toggle reveals them', async () => {
  const records = await captureSearchApp()
  const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })

  ADMIN_FRAME.run(() => {
    admin.ingestCaptured(records)
    notify()

    const mountLog = { name: 'search.results', kind: 'log', causes: 0 }
    const connectWrite = { name: 'search.history', kind: 'log', causes: 1 }
    const setCall = { name: 'search.query.set', kind: 'span', causes: 0 }
    const setWrite = { name: 'search.query', kind: 'log', causes: 1 }
    const recompute = { name: 'search.results', kind: 'log', causes: 1 }

    expect(admin.showMountLogs()).toBe(false)
    expect(admin.mountLogCount()).toBe(2)
    expect(admin.hiddenMountLogCount()).toBe(2)
    const hidden = rowsOf(admin)
    expect(hidden).not.toContainEqual(mountLog)
    expect(hidden).not.toContainEqual(connectWrite)
    expect(hidden).toContainEqual(setCall)
    expect(hidden).toContainEqual(setWrite)
    expect(hidden).toContainEqual(recompute)
    expect(hidden).toContainEqual({
      name: 'search.history.withConnectHook',
      kind: 'span',
      causes: 0,
    })

    admin.showMountLogs.toggle()
    notify()
    expect(admin.hiddenMountLogCount()).toBe(0)
    expect(admin.mountLogCount()).toBe(2)
    const shown = rowsOf(admin)
    expect(shown).toContainEqual(mountLog)
    expect(shown).toContainEqual(connectWrite)
    expect(shown).toContainEqual(setCall)
    expect(shown).toContainEqual(setWrite)
  })
})

test('a cause-free update named with .set is never a mount log', () => {
  const log = (id: string, name: string): AdminRecord => ({
    id,
    sourceId: 'local',
    kind: 'log',
    traceId: 'trace',
    spanId: 'span',
    name,
    atomName: name,
    start: 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    reatomKind: 'computed',
    eventName: 'reatom.computed.update',
  })

  expect(
    mountLogIds([log('read', 'form.value'), log('write', 'form.value.set')]),
  ).toEqual(new Set(['read']))
})
