import type { Meta, StoryObj } from '@storybook/html'
import { expect } from 'storybook/test'

import { button, createActor, role } from '../../../.storybook/helpers'
import { getAdminRoot } from '../../testing/admin-root'
import { renderOtlpChrome } from './boot'

const I = createActor()

const ms = (value: number) => String(BigInt(value) * 1_000_000n)

const SESSION_TRACE = '0af7651916cd43dd8448eb211c80319c'
const SESSION_SPAN = 'b7ad6b7169203331'
const ACTION_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const ACTION_SPAN = '00f067aa0ba902b7'

const MOUNT_LOG_RECORDS = [
  {
    eventName: 'reatom.computed.update',
    traceId: SESSION_TRACE,
    spanId: SESSION_SPAN,
    timeUnixNano: ms(1_791_352_144_000),
    body: '[]',
    attributes: {
      'event.name': 'reatom.computed.update',
      'reatom.name': 'search.results',
      'reatom.kind': 'computed',
      'reatom.frame.id': '1',
      'reatom.cause.ids': [],
    },
  },
  {
    traceId: ACTION_TRACE,
    spanId: ACTION_SPAN,
    name: 'search.query.set',
    startTimeUnixNano: ms(1_791_352_144_100),
    endTimeUnixNano: ms(1_791_352_144_102),
    attributes: {
      'reatom.name': 'search.query.set',
      'reatom.kind': 'action',
      'reatom.outcome': 'ok',
      'reatom.params': '["reatom"]',
      'reatom.frame.id': '2',
      'reatom.cause.ids': [],
    },
  },
  {
    eventName: 'reatom.atom.update',
    traceId: ACTION_TRACE,
    spanId: ACTION_SPAN,
    timeUnixNano: ms(1_791_352_144_101),
    body: 'reatom',
    attributes: {
      'event.name': 'reatom.atom.update',
      'reatom.name': 'search.query',
      'reatom.kind': 'atom',
      'reatom.frame.id': '3',
      'reatom.cause.ids': ['2'],
    },
  },
]

const meta = {
  title: 'OTLP/Mount logs',
  tags: ['@smoke'],
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'wide', isRotated: false } },
  render: () =>
    renderOtlpChrome(MOUNT_LOG_RECORDS, { 'service.name': 'mount-logs' }),
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const MountLogsToggle: Story = {
  name: 'Mount logs stay hidden until the chip shows them',
  play: async () => {
    const root = getAdminRoot()
    const toggle = button('Mount logs').within(root)
    const mountLogs = await I.see(toggle.wait())
    expect(mountLogs).toHaveTextContent('Mount logs 1')
    await I.seeAttribute(toggle, 'aria-pressed', 'false')
    await I.see(role('row', 'search.query.set').within(root).wait())
    await I.see(role('row', 'search.query').within(root).wait())
    await I.dontSee(role('row', 'search.results').within(root))

    await I.click(toggle)
    await I.see(role('row', 'search.results').within(root).wait())
    await I.seeAttribute(toggle, 'aria-pressed', 'true')
    expect(mountLogs).toHaveTextContent('Mount logs 1')
    await I.see(role('row', 'search.query.set').within(root))
  },
}
