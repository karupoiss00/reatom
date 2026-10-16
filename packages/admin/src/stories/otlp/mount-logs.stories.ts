import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { getAdminRoot } from '../../testing/admin-root'
import { renderOtlpChrome } from './boot'

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
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function adminUi() {
  return within(getAdminRoot())
}

export const MountLogsToggle: Story = {
  name: 'Mount logs stay hidden until the chip shows them',
  play: async () => {
    const mountLogs = await waitFor(() =>
      adminUi().getByRole('button', { name: 'Mount logs' }),
    )
    expect(mountLogs).toHaveTextContent('Mount logs 1')
    expect(mountLogs).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(adminUi().getByRole('button', { name: 'Expand all' }))
    await waitFor(() => {
      expect(
        adminUi().getByRole('row', { name: 'search.query.set' }),
      ).toBeTruthy()
      expect(adminUi().getByRole('row', { name: 'search.query' })).toBeTruthy()
    })
    expect(adminUi().queryByRole('row', { name: 'search.results' })).toBeNull()

    await userEvent.click(mountLogs)
    await userEvent.click(adminUi().getByRole('button', { name: 'Expand all' }))
    await waitFor(() => {
      expect(
        adminUi().getByRole('row', { name: 'search.results' }),
      ).toBeTruthy()
    })
    expect(mountLogs).toHaveAttribute('aria-pressed', 'true')
    expect(mountLogs).toHaveTextContent('Mount logs 1')
    expect(
      adminUi().getByRole('row', { name: 'search.query.set' }),
    ).toBeTruthy()
  },
}
