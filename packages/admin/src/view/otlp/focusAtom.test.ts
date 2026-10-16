import { notify } from '@reatom/core'
import { expect, test } from 'test'

import { reatomOtlpAdmin } from '../../otlp'
import { ADMIN_FRAME } from '../../root'
import { focusAtomOnTimeline } from './focusAtom'

const ms = (value: number) => String(BigInt(value) * 1_000_000n)

const atomLog = (name: string, spanId: string, body: unknown, time = 15) => ({
  traceId: 'trace-1',
  spanId,
  eventName: 'reatom.atom.update',
  timeUnixNano: ms(time),
  body,
  attributes: {
    'event.name': 'reatom.atom.update',
    'reatom.name': name,
    'reatom.kind': 'atom',
    'reatom.frame.id': spanId,
  },
})

test('focusAtomOnTimeline selects the latest write and opens the Gantt', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: { 'service.name': 'local' },
  })
  ADMIN_FRAME.run(() => {
    admin.view.set('state')
    admin.ingest([
      atomLog('board', 'b1', ['X'], 10),
      atomLog('winner', 'w1', 'X', 12),
      atomLog('board', 'b2', ['X', 'O'], 20),
    ])
    expect(focusAtomOnTimeline(admin, 'missing')).toBe(false)
    expect(admin.view()).toBe('state')
    expect(focusAtomOnTimeline(admin, 'board')).toBe(true)
    expect(admin.view()).toBe('timeline')
    expect(admin.selectedRecord()?.atomName).toBe('board')
    expect(admin.selectedRecord()?.body).toEqual(['X', 'O'])
    notify()
    expect(admin.gantt.selected()?.atomName).toBe('board')
  })
})

test('focusAtomOnTimeline selects the requested source, not the latest writer', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: { 'service.name': 'local' },
  })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      atomLog('board', 'b-local', ['X'], 10),
      {
        ...atomLog('board', 'b-worker', ['O'], 30),
        resource: { 'service.name': 'worker' },
      },
    ])
    const local = admin.records().find((record) => record.sourceId === 'local')
    expect(local?.body).toEqual(['X'])
    expect(
      focusAtomOnTimeline(admin, {
        atomName: 'board',
        recordId: local?.id,
        sourceId: local?.sourceId,
      }),
    ).toBe(true)
    expect(admin.selectedRecord()?.id).toBe(local?.id)
    expect(admin.selectedRecord()?.body).toEqual(['X'])
    expect(
      focusAtomOnTimeline(admin, {
        atomName: 'board',
        recordId: 'missing',
        sourceId: 'local',
      }),
    ).toBe(true)
    expect(admin.selectedRecord()?.sourceId).toBe('local')
    expect(admin.selectedRecord()?.body).toEqual(['X'])
  })
})

test('focusAtomOnTimeline clears quick filters that hide the atom', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: { 'service.name': 'local' },
  })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      atomLog('board', 'b1', ['X'], 10),
      atomLog('winner', 'w1', 'X', 12),
    ])
    const board = admin.records().find((record) => record.atomName === 'board')
    expect(board).toBeDefined()
    admin.filterName.set('winner')
    admin.filterQuery.set('absent')
    admin.filterReatomKind.set('action')
    expect(admin.ganttRecords().some((record) => record.id === board?.id)).toBe(
      false,
    )
    expect(
      focusAtomOnTimeline(admin, {
        atomName: 'board',
        recordId: board?.id,
        sourceId: board?.sourceId,
      }),
    ).toBe(true)
    expect(admin.filterName()).toBe('')
    expect(admin.filterQuery()).toBe('')
    expect(admin.filterReatomKind()).toBe(undefined)
    expect(admin.gantt.rows().some((record) => record.id === board?.id)).toBe(
      true,
    )
    notify()
    expect(admin.gantt.selected()?.id).toBe(board?.id)

    admin.filterName.set('board')
    expect(
      focusAtomOnTimeline(admin, {
        atomName: 'board',
        recordId: board?.id,
        sourceId: board?.sourceId,
      }),
    ).toBe(true)
    expect(admin.filterName()).toBe('board')

    admin.filterName.set('board')
    admin.filterMode.set('hide')
    expect(admin.ganttRecords().some((record) => record.id === board?.id)).toBe(
      false,
    )
    expect(
      focusAtomOnTimeline(admin, {
        atomName: 'board',
        recordId: board?.id,
        sourceId: board?.sourceId,
      }),
    ).toBe(true)
    expect(admin.filterName()).toBe('')
    expect(admin.filterMode()).toBe('hide')
    expect(admin.gantt.rows().some((record) => record.id === board?.id)).toBe(
      true,
    )
  })
})

test('focusAtomOnTimeline shows a mount log the quick filter was hiding', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: { 'service.name': 'local' },
  })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      {
        traceId: 'trace-1',
        spanId: 'total',
        eventName: 'reatom.computed.update',
        timeUnixNano: ms(10),
        body: 1,
        attributes: {
          'event.name': 'reatom.computed.update',
          'reatom.name': 'total',
          'reatom.kind': 'computed',
          'reatom.frame.id': 'total',
          'reatom.cause.ids': [],
        },
      },
    ])
    const total = admin.records().find((record) => record.atomName === 'total')
    expect(total).toBeDefined()
    expect(admin.mountLogIds().has(total!.id)).toBe(true)
    expect(admin.showMountLogs()).toBe(false)
    expect(admin.ganttRecords().includes(total!)).toBe(false)
    expect(
      focusAtomOnTimeline(admin, {
        atomName: 'total',
        recordId: total?.id,
        sourceId: total?.sourceId,
      }),
    ).toBe(true)
    expect(admin.showMountLogs()).toBe(true)
    expect(admin.gantt.rows().some((record) => record.id === total?.id)).toBe(
      true,
    )
  })
})
