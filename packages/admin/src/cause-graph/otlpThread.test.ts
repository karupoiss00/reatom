import { expect, test } from 'test'

import type { AdminRecord } from '../otlp/ingest.ts'
import { selectedAncestorFrameIds, selectedCauseThreadModel } from './otlpThread.ts'

function record(patch: Partial<AdminRecord>): AdminRecord {
  return {
    id: patch.frameId ?? 'r',
    sourceId: 'local',
    kind: 'span',
    traceId: 't',
    spanId: 's',
    name: 'n',
    start: 1,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    ...patch,
  }
}

test('selectedAncestorFrameIds is empty without a framed selection', () => {
  const child = record({ frameId: '2', causeIds: ['1'] })
  const parent = record({ frameId: '1' })
  expect(selectedAncestorFrameIds([parent, child], child)).toEqual(['1'])
  expect(selectedCauseThreadModel([parent, child], null).pathIds).toEqual([])
})
