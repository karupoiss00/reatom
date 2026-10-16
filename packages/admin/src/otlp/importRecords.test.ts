import { expect, test } from 'test'

import { ADMIN_FRAME } from '../root'
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
