import { atom } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent } from 'storybook/test'

import { ADMIN_FRAME } from '../../root'
import { matchStoryRootScreenshot } from '../../testing/visual'
import {
  Button,
  SearchField,
  SelectField,
  Tabs,
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const meta = {
  title: 'Design System/Controls',
  tags: ['@smoke'],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function ControlsBoard() {
  const query = atom('', '_Admin.stories.ds.query')
  const target = atom<'all' | 'name'>('all', '_Admin.stories.ds.target')
  const tab = atom<'overview' | 'causes'>('overview', '_Admin.stories.ds.tab')

  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-16);
        padding: var(--admin-space-16);
      `}
    >
      <Toolbar>
        <ToolbarGroup>
          <Button variant="primary" label="Primary" onClick={() => undefined} />
          <Button
            variant="secondary"
            label="Secondary"
            onClick={() => undefined}
          />
          <Button variant="ghost" label="Ghost" onClick={() => undefined} />
          <Button variant="danger" label="Danger" onClick={() => undefined} />
        </ToolbarGroup>
        <ToolbarSeparator />
        <Button
          variant="ghost"
          label="Disabled"
          disabled
          onClick={() => undefined}
        />
      </Toolbar>
      <div
        css={`
          display: flex;
          gap: var(--admin-space-8);
        `}
      >
        <SearchField
          value={query}
          label="Search frames"
          placeholder="Search"
          testId="ds-search"
        />
        <SelectField
          value={target}
          label="Search target"
          options={[
            { value: 'all', label: 'All' },
            { value: 'name', label: 'Name' },
          ]}
        />
      </div>
      <Tabs
        value={tab}
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'causes', label: 'Cause Chain' },
        ]}
        ariaLabel="Inspector tabs"
      />
    </div>
  )
}

export const ControlsDocked: Story = {
  name: 'Controls 560x760',
  tags: ['@visual'],
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(<ControlsBoard />, { width: 560, height: 760 }),
    ),
  play: async ({ canvasElement }) => {
    const primary = canvasElement.querySelector('[aria-label="Primary"]')
    const search = canvasElement.querySelector('[aria-label="Search frames"]')
    const tabs = canvasElement.querySelector('[role="tablist"]')
    expect(primary).toBeTruthy()
    expect(search).toBeTruthy()
    expect(tabs).toBeTruthy()

    const causeTab = canvasElement.querySelector('[aria-label="Cause Chain"]')
    if (causeTab instanceof HTMLButtonElement) {
      await userEvent.click(causeTab)
      expect(causeTab.getAttribute('aria-selected')).toBe('true')
    }

    await userEvent.keyboard('{ArrowLeft}')
    const overview = canvasElement.querySelector('[aria-label="Overview"]')
    expect(overview?.getAttribute('aria-selected')).toBe('true')

    await matchStoryRootScreenshot(canvasElement, 'controls-560')
  },
}

export const ControlsWide: Story = {
  name: 'Controls 1280x800',
  tags: ['@visual'],
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(<ControlsBoard />, { width: 1280, height: 800 }),
    ),
  play: async ({ canvasElement }) => {
    expect(
      canvasElement.querySelector('[aria-label="Search target"]'),
    ).toBeTruthy()
    await matchStoryRootScreenshot(canvasElement, 'controls-1280')
  },
}
