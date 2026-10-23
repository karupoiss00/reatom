import { action, atom, computed, wrap } from '@reatom/core'
import { expect, inject, test } from 'vitest'

import { withAttributes } from './attributes/index.ts'
import { withBrowserConsoleMonkeypatch } from './browser-console/index.ts'
import { withBrowserNetworkMonkeypatch } from './browser-network/index.ts'
import { reatomTestTelemetry } from './test-helpers.ts'

test('native HTTP and console inherit the operation principal across an account switch', async () => {
  const user = atom(
    { 'user.id': 'A', 'app.tenant.id': 'tenant-A' },
    'identity.auth',
  )
  const otel = reatomTestTelemetry({
    name: 'native-operation-identity',
    endpoint: null,
  }).extend(
    withAttributes(computed(() => user(), 'identity.attributes')),
    withBrowserNetworkMonkeypatch(),
    withBrowserConsoleMonkeypatch(),
  )
  try {
    const request = action(async () => {
      const response = await wrap(
        fetch(inject('otelCollectorUrl') + '/control/echo-identity-operation'),
      )
      console.warn('A operation completed')
      otel.log('operation.completed')
      return response.status
    }, 'app.identity.operation').extend(otel.withOTel())
    const pending = request()
    user.set({ 'user.id': 'B', 'app.tenant.id': 'tenant-B' })
    expect(await pending).toBe(200)
    const captured = otel.records() as any[]
    const relevant = captured.filter(
      (record) =>
        record.kind === 'client' ||
        record.eventName === 'reatom.console' ||
        record.eventName === 'operation.completed' ||
        record.name === 'app.identity.operation',
    )
    expect(relevant).toHaveLength(4)
    for (const record of relevant) {
      expect(record.attributes['user.id']).toBe('A')
      expect(record.attributes['app.tenant.id']).toBe('tenant-A')
    }
    console.warn('new independent B event')
    const consoleRecords = (otel.records() as any[]).filter(
      (record) => record.eventName === 'reatom.console',
    )
    expect(consoleRecords.at(-1).attributes['user.id']).toBe('B')
    otel.attributesVar.run({}, () => console.warn('intentionally anonymous'))
    const anonymous = (otel.records() as any[])
      .filter((record) => record.eventName === 'reatom.console')
      .at(-1)
    expect(anonymous.attributes['user.id']).toBeUndefined()
  } finally {
    otel.dispose()
  }
})
