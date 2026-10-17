import { expect, test } from 'test'

import type { AdminRecord } from './ingest.ts'
import { resolveCauseChips } from './causeChips.ts'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: 'id',
    sourceId: 'local',
    kind: 'span',
    traceId: 'trace',
    spanId: 'span',
    name: 'root',
    start: 0,
    end: 10,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('resolveCauseChips names loaded parents and keeps missing ids', () => {
  const parent = record({
    id: 'parent',
    frameId: '1',
    name: 'submit',
    reatomKind: 'action',
  })
  const child = record({
    id: 'child',
    frameId: '2',
    name: 'total',
    reatomKind: 'computed',
    causeIds: ['1', '99'],
    links: [
      {
        traceId: 'trace',
        spanId: 'span',
        reason: 'computed.dependency',
        frameId: '1',
      },
    ],
  })
  const chips = resolveCauseChips(child, [parent, child])
  expect(chips).toHaveLength(2)
  expect(chips[0]).toMatchObject({
    id: '1',
    name: 'submit',
    kind: 'action',
  })
  expect(chips[0]?.record?.id).toBe('parent')
  expect(chips[1]).toMatchObject({
    id: '99',
    name: '99',
    record: undefined,
  })
})
