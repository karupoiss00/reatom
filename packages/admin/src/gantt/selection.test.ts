import { notify } from '@reatom/core'
import { expect, test } from 'test'

import { reatomOtlpAdmin } from '../otlp/chrome'
import { ADMIN_FRAME } from '../root'
import { adminRecordTiming } from './records'
import { reatomGantt } from './reatomGantt'
import { reatomGanttRecordSelection } from './selection'

const msToNano = (ms: number) => String(BigInt(ms) * 1_000_000n)

const otlpSpan = (
  name: string,
  spanId: string,
  startMs: number,
  endMs: number,
  parentSpanId?: string,
) => ({
  traceId: 'trace-1',
  spanId,
  parentSpanId,
  name,
  startTimeUnixNano: msToNano(startMs),
  endTimeUnixNano: msToNano(endMs),
})

const otlpLog = (eventName: string, spanId: string, timeMs: number) => ({
  traceId: 'trace-1',
  spanId,
  eventName,
  timeUnixNano: msToNano(timeMs),
})

const setup = () =>
  ADMIN_FRAME.run(() => {
    const admin = reatomOtlpAdmin({ sourceId: 'local', resource: {} })
    admin.ingest([
      otlpSpan('child', 'c', 1010, 1020, 'p'),
      otlpLog('child.log', 'c', 1015),
      otlpSpan('parent', 'p', 1000, 1050),
      otlpSpan('next', 'n', 1100, 1110),
    ])
    const gantt = reatomGantt(
      admin.visibleRecords,
      adminRecordTiming,
      '_Admin.otlp.gantt',
    )
    const selection = reatomGanttRecordSelection(gantt, admin)
    return { admin, gantt, selection }
  })

const recordNamed = (
  admin: ReturnType<typeof reatomOtlpAdmin>,
  name: string,
) => {
  const match = admin.records().find((item) => item.name === name)
  if (!match) throw new Error(`missing record ${name}`)
  return match
}

test('select writes the admin id and the gantt node together', () => {
  const { admin, gantt, selection } = setup()

  ADMIN_FRAME.run(() => {
    const parent = recordNamed(admin, 'parent')
    const stop = selection.connect()
    selection.select(parent)
    notify()

    expect(gantt.selected()).toBe(parent)
    expect(admin.selectedRecord()).toBe(parent)
    expect(admin.selectedRecordId()).toBe(parent.id)
    expect(admin.followLive()).toBe(false)
    expect(gantt.selected()).toBe(parent)
    stop()
  })
})

test('admin selection of a nested log expands ancestors and scrolls to it', () => {
  const { admin, gantt, selection } = setup()

  ADMIN_FRAME.run(() => {
    const parent = recordNamed(admin, 'parent')
    const child = recordNamed(admin, 'child')
    const log = recordNamed(admin, 'child.log')
    gantt.virtual.viewportSize.set(1)
    const stop = selection.connect()
    expect(gantt.rows().map((item) => item.name)).toEqual(['parent', 'next'])

    admin.selectRecord(log)
    notify()

    expect(gantt.selected()).toBe(log)
    expect(admin.selectedRecord()).toBe(log)
    expect(gantt.isExpanded(parent)).toBe(true)
    expect(gantt.isExpanded(child)).toBe(true)
    expect(gantt.rows()[gantt.virtual.scrollOffset()]).toBe(log)
    notify()
    expect(gantt.selected()).toBe(log)
    expect(admin.selectedRecordId()).toBe(log.id)
    stop()
  })
})

test('clearing the admin selection does not restore the gantt node', () => {
  const { admin, gantt, selection } = setup()

  ADMIN_FRAME.run(() => {
    const parent = recordNamed(admin, 'parent')
    const stop = selection.connect()
    selection.select(parent)
    notify()
    admin.clear()
    expect(admin.selectedRecord()).toBeNull()
    notify()
    expect(gantt.selected()).toBeNull()
    notify()
    expect(gantt.selected()).toBeNull()
    expect(admin.selectedRecord()).toBeNull()
    stop()
  })
})

test('move follows waterfall rows and keeps the admin record', () => {
  const { admin, gantt, selection } = setup()

  ADMIN_FRAME.run(() => {
    const stop = selection.connect()
    gantt.expandAll()
    selection.move(1)
    notify()
    expect(gantt.selected()?.name).toBe('parent')
    expect(admin.selectedRecord()?.name).toBe('parent')

    selection.move(1)
    notify()
    expect(gantt.selected()?.name).toBe('child')
    expect(admin.selectedRecord()).toBe(gantt.selected())

    selection.move(1)
    notify()
    expect(gantt.selected()?.name).toBe('child.log')
    expect(admin.selectedRecord()).toBe(gantt.selected())
    stop()
  })
})

test('unsubscribe stops pushing admin selection into the gantt', () => {
  const { admin, gantt, selection } = setup()

  ADMIN_FRAME.run(() => {
    const parent = recordNamed(admin, 'parent')
    const next = recordNamed(admin, 'next')
    const stop = selection.connect()
    selection.select(parent)
    notify()
    stop()

    admin.selectRecord(next)
    notify()
    expect(admin.selectedRecord()).toBe(next)
    expect(gantt.selected()).toBe(parent)
  })
})
