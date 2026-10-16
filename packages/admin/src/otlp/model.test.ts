import { notify } from '@reatom/core'
import { expect, test } from 'test'

import { reatomOtlpMcp } from '../mcp'
import { ADMIN_FRAME } from '../root'
import { reatomOtlpAdmin } from './chrome'
import { isInProgressRecord } from './inProgress'

const ms = (value: number) => String(BigInt(value) * 1_000_000n)

const span = (
  name: string,
  spanId: string,
  outcome?: string,
  traceId = 'trace-1',
) => ({
  traceId,
  spanId,
  name,
  startTimeUnixNano: ms(10),
  endTimeUnixNano: ms(20),
  ...(outcome ? { attributes: { 'reatom.outcome': outcome } } : {}),
})

const log = (eventName: string, spanId: string, time = 15) => ({
  traceId: 'trace-1',
  spanId,
  eventName,
  timeUnixNano: ms(time),
  body: eventName,
})

const setup = () =>
  reatomOtlpAdmin({
    sourceId: 'local',
    resource: { 'service.name': 'local' },
  })

test('gantt, view, and selection history live on the admin model', () => {
  const admin = setup()
  ADMIN_FRAME.run(() => {
    expect(admin.view()).toBe('timeline')
    expect(admin.gantt).toBe(admin.gantt)
    admin.ingest([
      span('first', 's1'),
      span('second', 's2'),
      log('reatom.log', 's1'),
    ])
    const first = admin.records().find((record) => record.name === 'first')!
    const second = admin.records().find((record) => record.name === 'second')!
    admin.selectRecord(first)
    admin.selectRecord(second)
    expect(admin.canSelectionBack()).toBe(true)
    admin.selectionBack()
    expect(admin.selectedRecord()).toBe(first)
    expect(admin.canSelectionForward()).toBe(true)
    admin.selectionForward()
    expect(admin.selectedRecord()).toBe(second)
    expect(admin.selectionHistory()).toEqual([first.id, second.id])
    expect(admin.spanCountByTrace().get('trace-1')).toBe(2)
    expect(admin.highlightedLogIds().size).toBe(1)
    admin.view.set('graph')
    expect(admin.view()).toBe('graph')
    notify()
    expect(admin.gantt.selected()?.name).toBe('second')
  })
})

test('name search filters gantt rows and restores them when cleared', () => {
  const admin = setup()
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('makeMove', 's1'),
      span('board', 's2'),
      span('winner', 's3'),
    ])
    expect(admin.gantt.rows().map((record) => record.name)).toEqual(
      expect.arrayContaining(['makeMove', 'board', 'winner']),
    )
    admin.filterName.set('makeMove')
    expect(admin.gantt.rows().map((record) => record.name)).toEqual([
      'makeMove',
    ])
    admin.filterName.set('make')
    expect(admin.gantt.rows().map((record) => record.name)).toEqual([
      'makeMove',
    ])
    admin.filterName.set('WIN')
    expect(admin.gantt.rows().map((record) => record.name)).toEqual([
      'winner',
    ])
    admin.filterName.set('')
    expect(admin.gantt.rows().map((record) => record.name)).toEqual(
      expect.arrayContaining(['makeMove', 'board', 'winner']),
    )
  })
})

test('default quick filter hides abort and suspense and counts them', () => {
  const admin = setup()
  ADMIN_FRAME.run(() => {
    admin.ingest([
      span('ok', 'ok'),
      span('stop', 'stop', 'abort'),
      span('wait', 'wait', 'suspense'),
      log('child.log', 'stop'),
    ])
    expect(admin.records()).toHaveLength(4)
    expect(admin.abortSuspenseCount()).toBe(2)
    expect(admin.hiddenAbortSuspenseCount()).toBe(2)
    expect(admin.showAbortAndSuspense()).toBe(false)
    const names = admin.gantt.rows().map((record) => record.name)
    expect(names).toContain('ok')
    expect(names).toContain('child.log')
    expect(names).not.toContain('stop')
    expect(names).not.toContain('wait')
    expect(names).not.toContain('In progress')
    admin.showAbortAndSuspense.setTrue()
    expect(admin.hiddenAbortSuspenseCount()).toBe(0)
    expect(admin.abortSuspenseCount()).toBe(2)
    admin.gantt.expandAll()
    expect(admin.gantt.rows().map((record) => record.name)).toEqual(
      expect.arrayContaining(['ok', 'stop', 'wait', 'child.log']),
    )
  })
})

test('in-progress placeholder is only in the gantt and is replaced in place', () => {
  const admin = setup()
  const mcp = reatomOtlpMcp(admin)
  ADMIN_FRAME.run(() => {
    admin.ingest([log('reatom.log', 'open', 40)])
    expect(admin.records()).toHaveLength(1)
    expect(admin.records().some(isInProgressRecord)).toBe(false)
    const placeholder = admin.gantt
      .rows()
      .find((record) => record.name === 'In progress')
    expect(placeholder).toBeDefined()
    expect(placeholder!.outcome).toBe('pending')
    expect(placeholder!.spanId).toBe('open')
    expect(admin.gantt.isExpanded(placeholder!)).toBe(true)
    expect(admin.gantt.rows().map((record) => record.name)).toEqual([
      'In progress',
      'reatom.log',
    ])
    const summary = mcp.summary()
    expect(summary.ok).toBe(true)
    if (!summary.ok) return
    expect(summary.header.recordCount).toBe(1)
    const search = mcp.search()
    expect(search.ok).toBe(true)
    if (!search.ok) return
    expect(search.data.map((row) => row.name)).toEqual(['reatom.log'])

    admin.ganttSelection.select(placeholder!)
    expect(admin.selectedRecordId()).toBe(placeholder!.id)
    admin.ingest([span('reply', 'open')])
    const reply = admin.records().find((record) => record.name === 'reply')!
    expect(admin.gantt.rows().some(isInProgressRecord)).toBe(false)
    expect(admin.records().some(isInProgressRecord)).toBe(false)
    expect(admin.gantt.selected()).toBe(reply)
    expect(admin.selectedRecord()).toBe(reply)
    expect(admin.gantt.isExpanded(reply)).toBe(true)
    expect(admin.gantt.rows().map((record) => record.name)).toEqual([
      'reply',
      'reatom.log',
    ])
    expect(admin.selectionHistory()).toEqual([reply.id])
    expect(mcp.summary().header.recordCount).toBe(2)
  })
})

test('an earlier log replaces the in-progress record', () => {
  const admin = setup()
  ADMIN_FRAME.run(() => {
    admin.ingest([log('late', 'open', 80)])
    const before = admin.inProgress()[0]!
    expect(before.start).toBe(80)
    expect(admin.gantt.isExpanded(before)).toBe(true)
    admin.ingest([log('early', 'open', 20)])
    const after = admin.inProgress()[0]!
    expect(after).not.toBe(before)
    expect(before.start).toBe(80)
    expect(after.start).toBe(20)
    expect(
      admin.gantt.rows().find((record) => record.name === 'In progress'),
    ).toBe(after)
    expect(admin.gantt.isExpanded(after)).toBe(true)
  })
})
