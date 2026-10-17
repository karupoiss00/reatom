import { expect, test } from 'test'

import { LOCAL_VALUES, type AdminRecord } from './ingest.ts'
import { copyForAgentMarkdown, frameMcpSnippet } from './copyForAgent.ts'

function record(patch: Partial<AdminRecord> = {}): AdminRecord {
  return {
    id: 'rec-1',
    sourceId: 'local',
    kind: 'span',
    traceId: 'abcdef',
    spanId: 'span',
    name: 'pay',
    start: 0,
    end: 12,
    attributes: {},
    resource: {},
    links: [],
    causeIds: [],
    outcome: 'error',
    error: {
      type: 'TypeError',
      message: 'boom',
      stack: 'TypeError: boom\n    at pay (src/pay.ts:3:1)',
    },
    ...patch,
  }
}

test('copy for agent includes causes and exception and omits live values', () => {
  const parent = record({
    id: 'parent',
    frameId: '1',
    name: 'submit',
    outcome: 'ok',
    error: undefined,
  })
  const child = record({
    frameId: '2',
    causeIds: ['1'],
    [LOCAL_VALUES]: { params: ['secret'], payload: 1 },
  })
  const markdown = copyForAgentMarkdown(child, [parent, child], false)
  expect(markdown).toContain('# pay')
  expect(markdown).toContain('causes: submit')
  expect(markdown).toContain('exception: TypeError — boom')
  expect(markdown).toContain('culprit: pay (src/pay.ts:3:1)')
  expect(markdown).not.toContain('secret')
  expect(frameMcpSnippet(child)).toBe('getRecord({ id: "rec-1" })')
})
