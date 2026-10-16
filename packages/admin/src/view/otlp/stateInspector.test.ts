import { expect, test } from 'test'

import { reatomOtlpAdmin } from '../../otlp'
import { ADMIN_FRAME } from '../../root'
import { readFieldPage } from '../inspector'
import { stateInspectorHooks } from './StateInspector'

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

test('timeline buttons stay on atom rows and open that source', () => {
  const admin = reatomOtlpAdmin({
    sourceId: 'local',
    resource: { 'service.name': 'local' },
  })
  ADMIN_FRAME.run(() => {
    admin.ingest([
      atomLog('winner', 'w-local', 'X', 10),
      {
        ...atomLog('winner', 'w-worker', 'O', 30),
        resource: { 'service.name': 'worker' },
      },
      atomLog('score', 's1', { winner: 'X' }, 20),
    ])
    const hooks = stateInspectorHooks(admin)
    const tree = admin.stateTree()
    const winnerGroup = tree.find(
      (node) => node.kind === 'group' && node.label === 'winner',
    )
    const atoms = readFieldPage(winnerGroup?.children, hooks, 20)
    const local = winnerGroup?.children.find(
      (node) => node.sourceId === 'local',
    )
    const localRow = atoms?.entries.find((entry) => entry.id === local?.id)
    expect(localRow?.actions).toHaveLength(1)
    expect(localRow?.actions?.[0]?.label).toBe('Show winner on the timeline')
    localRow?.actions?.[0]?.onClick()
    expect(admin.selectedRecord()?.id).toBe(local?.recordId)
    expect(admin.selectedRecord()?.body).toBe('X')

    const score = tree.find((node) => node.atomName === 'score')
    const fields = readFieldPage(score?.value, hooks, 20)
    expect(
      fields?.entries.find((entry) => entry.key === 'winner')?.actions,
    ).toEqual([])

    admin.ingest([
      {
        traceId: 'trace-1',
        spanId: 'total',
        eventName: 'reatom.computed.update',
        timeUnixNano: ms(40),
        body: 2,
        attributes: {
          'event.name': 'reatom.computed.update',
          'reatom.name': 'score.total',
          'reatom.kind': 'computed',
          'reatom.frame.id': 'total',
        },
      },
    ])
    const total = admin
      .stateTree()
      .flatMap((node) => [node, ...node.children])
      .find((node) => node.atomName === 'score.total')
    expect(total?.id.startsWith('atom:')).toBe(true)
    const totalGroup = admin.stateTree().find((node) =>
      node.children.some((child) => child.atomName === 'score.total'),
    )
    const totalRow = readFieldPage(totalGroup?.children, hooks, 20)?.entries.find(
      (entry) => entry.id === total?.id,
    )
    expect(totalRow?.label).toBe('total')
  })
})
