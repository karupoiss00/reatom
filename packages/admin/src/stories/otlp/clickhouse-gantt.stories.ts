import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { getAdminRoot } from '../../testing/admin-root'
import {
  clickhouseDeniedFetch,
  clickhouseMockFetch,
} from '../otlp/clickhouse-mock'
import { renderClickHouse } from './clickhouse-boot'

const meta = {
  title: 'Integration/ClickHouse',
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'wide', isRotated: false } },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function adminUi() {
  return within(getAdminRoot())
}

async function connectRemote(canvas: HTMLElement) {
  await waitFor(() => {
    expect(canvas.querySelector('[data-admin-host]')).toBeInstanceOf(
      HTMLElement,
    )
    expect(
      adminUi().getByRole('button', { name: 'Remote ClickHouse source' }),
    ).toBeTruthy()
  })
  await userEvent.click(
    adminUi().getByRole('button', { name: 'Remote ClickHouse source' }),
  )
  await userEvent.click(
    adminUi().getByRole('button', { name: 'Connect ClickHouse' }),
  )
}

export const RemoteThenClear: Story = {
  name: 'Remote then clear',
  render: () => renderClickHouse(clickhouseMockFetch),
  play: async ({ canvasElement }) => {
    await connectRemote(canvasElement)
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').toContain('ClickHouse')
    })
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').toMatch(
        /tree#12\.toggle|cart\.total|devtools\.ping/,
      )
    })
    await userEvent.click(adminUi().getByRole('button', { name: 'Clear' }))
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').not.toContain('tree.checked')
      expect(getAdminRoot().textContent ?? '').toContain('No tracer connected')
    })
  },
}

export const PermissionDenied: Story = {
  name: 'Permission denied',
  render: () => renderClickHouse(clickhouseDeniedFetch),
  play: async ({ canvasElement }) => {
    await connectRemote(canvasElement)
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').toMatch(/ClickHouse 401/)
      expect(getAdminRoot().textContent ?? '').toContain(
        'Check the ClickHouse user and password',
      )
    })
    expect(
      adminUi().getByRole('button', { name: 'Connect ClickHouse' }),
    ).toBeTruthy()
  },
}
