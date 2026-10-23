import { action, notify, sleep, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
import { stringifyJson } from '../serialize'
import { formatJson } from '../view/format'
import { reatomOtlpMcp } from '../mcp'
import { reatomOtlpAdmin } from './chrome'
import { importRecordFile } from './importRecords'

const ms = (value: number) => String(BigInt(value) * 1_000_000n)

const span = {
  traceId: 'trace-import',
  spanId: 'span-import',
  name: 'saved',
  startTimeUnixNano: ms(10),
  endTimeUnixNano: ms(25),
  attributes: [
    { key: 'reatom.kind', value: { stringValue: 'action' } },
    {
      key: 'reatom.link.note',
      value: { stringValue: 'kept' },
    },
  ],
  links: [
    {
      traceId: 'trace-cause',
      spanId: 'span-cause',
      attributes: [
        {
          key: 'reatom.link.reason',
          value: { stringValue: 'computed.dependency' },
        },
      ],
    },
  ],
}

const setup = () =>
  reatomOtlpAdmin({
    sourceId: 'import',
    resource: { 'service.name': 'import' },
  })

test('import writes inside the admin frame and ignores invalid json', async () => {
  const admin = setup()
  await ADMIN_FRAME.run(() =>
    importRecordFile(admin, {
      text: async () => JSON.stringify([span]),
    }),
  )
  expect(ADMIN_FRAME.run(() => admin.source())).toBe('replay')
  expect(
    ADMIN_FRAME.run(() => admin.records().map((record) => record.name)),
  ).toEqual(['saved'])
  expect(ADMIN_FRAME.run(() => admin.records()[0]!.start)).toBe(10)
  expect(ADMIN_FRAME.run(() => admin.records()[0]!.reatomKind)).toBe('action')

  await ADMIN_FRAME.run(() =>
    importRecordFile(admin, { text: async () => '{' }),
  )
  expect(
    ADMIN_FRAME.run(() => admin.records().map((record) => record.name)),
  ).toEqual(['saved'])
  expect(ADMIN_FRAME.run(() => admin.source())).toBe('replay')

  await ADMIN_FRAME.run(() =>
    importRecordFile(admin, { text: async () => '{"name":"nope"}' }),
  )
  expect(ADMIN_FRAME.run(() => admin.records())).toHaveLength(1)
})

test('export then import round-trips admin records', async () => {
  const admin = setup()
  ADMIN_FRAME.run(() => {
    admin.ingest([span])
  })
  const exported = ADMIN_FRAME.run(() => JSON.stringify(admin.records()))
  const parsed = JSON.parse(exported) as Array<Record<string, unknown>>
  parsed[0]!['attributes'] = {
    ...(parsed[0]!['attributes'] as Record<string, unknown>),
    note: { stringValue: 'kept' },
  }

  await ADMIN_FRAME.run(() =>
    importRecordFile(admin, { text: async () => JSON.stringify(parsed) }),
  )

  const record = ADMIN_FRAME.run(() => admin.records()[0]!)
  expect(record.kind).toBe('span')
  expect(record.name).toBe('saved')
  expect(record.start).toBe(10)
  expect(record.end).toBe(25)
  expect(record.reatomKind).toBe('action')
  expect(record.attributes['note']).toEqual({ stringValue: 'kept' })
  expect(record.links[0]?.reason).toBe('computed.dependency')
  expect(ADMIN_FRAME.run(() => admin.source())).toBe('replay')
})

test('canonical bigint and bytes export as precise JSON and import for replay without changing capture', async () => {
  const otel = reatomOpentelemetry({
    name: 'admin-json-values',
    serviceName: 'json',
  })
  const total = 9007199254740993n
  try {
    action(
      () => ({ total, bytes: new Uint8Array([0, 128, 255]) }),
      'saveBigint',
    )()
    notify()
    await wrap(sleep(0))
    const admin = setup()
    const captured = otel.records()
    ADMIN_FRAME.run(() => admin.ingestCaptured(captured))
    const original = ADMIN_FRAME.run(() =>
      admin
        .records()
        .find(
          (record) => record.name === 'saveBigint' && record.kind === 'span',
        )!,
    )
    expect(
      (original.attributes['reatom.payload'] as { total: bigint }).total,
    ).toBe(total)
    const exported = ADMIN_FRAME.run(() => stringifyJson(admin.records(), 2)!)
    expect(exported).toContain(total.toString())
    expect(formatJson(original)).toContain(total.toString())
    const mcp = reatomOtlpMcp(admin)
    expect(
      ADMIN_FRAME.run(() => JSON.stringify(mcp.getRecord({ id: original.id }))),
    ).toContain(total.toString())
    await wrap(
      ADMIN_FRAME.run(() =>
        importRecordFile(admin, { text: async () => exported }),
      ),
    )
    const replay = ADMIN_FRAME.run(() =>
      admin
        .records()
        .find(
          (record) => record.name === 'saveBigint' && record.kind === 'span',
        )!,
    )
    expect(replay.attributes['reatom.payload']).toEqual({
      total: total.toString(),
      bytes: [0, 128, 255],
    })
    expect(
      (original.attributes['reatom.payload'] as { total: bigint }).total,
    ).toBe(total)
    expect(ADMIN_FRAME.run(() => admin.source())).toBe('replay')
  } finally {
    otel.dispose()
  }
})
