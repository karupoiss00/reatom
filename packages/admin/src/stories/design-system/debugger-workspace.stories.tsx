import { atom } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent, waitFor } from 'storybook/test'

import { ADMIN_FRAME } from '../../root'
import {
  DebuggerWorkspace,
  SearchField,
  StatusBar,
} from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const meta = {
  title: 'Design System/Debugger workspace',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

let workspaceStoryId = 0

function renderWorkspace(width: number) {
  const storyId = ++workspaceStoryId
  const query = atom('', `_Admin.stories.ds.workspaceQuery.${storyId}`)
  const inspectorOpen = atom(
    false,
    `_Admin.stories.ds.workspaceOpen.${storyId}`,
  )
  return ADMIN_FRAME.run(() => {
    inspectorOpen.set(true)
    return renderDesignCanvas(
      <DebuggerWorkspace
        header={
          <h1
            css={`
              margin: 0;
            `}
          >
            Records
          </h1>
        }
        filter={
          <SearchField
            value={query}
            label="Name search"
            placeholder="Name"
            shortcut=""
          />
        }
        main={<p>Timeline</p>}
        inspector={() => <p>Selected move</p>}
        inspectorLabel="Frame"
        inspectorOpen={inspectorOpen}
        onInspectorClose={() => inspectorOpen.set(false)}
        status={
          <StatusBar>
            <span>12 of 40</span>
          </StatusBar>
        }
      />,
      { width, height: 640 },
    )
  })
}

export const WideFrame: Story = {
  name: 'Wide shell keeps the frame beside the timeline',
  render: () => renderWorkspace(800),
  play: async ({ canvasElement }) => {
    const separator = canvasElement.querySelector('[aria-label="Resize panes"]')
    if (!(separator instanceof HTMLElement)) {
      throw new Error('missing separator')
    }
    expect(canvasElement.querySelector('[role="dialog"]')).toBeNull()
    expect(separator.getAttribute('aria-hidden')).not.toBe('true')
    expect(canvasElement.textContent).toContain('Timeline')
    expect(canvasElement.textContent).toContain('Selected move')

    separator.focus()
    const before = separator.getAttribute('aria-valuenow')
    await userEvent.keyboard('{ArrowLeft}')
    expect(separator.getAttribute('aria-valuenow')).not.toBe(before)

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvasElement.textContent).not.toContain('Selected move')
      expect(canvasElement.textContent).toContain('Timeline')
    })
  },
}

export const NarrowDrawer: Story = {
  name: 'Narrow shell uses a bottom drawer',
  render: () => renderWorkspace(560),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(canvasElement.querySelector('[role="dialog"]')).toBeTruthy()
    })
    expect(
      canvasElement
        .querySelector('[aria-label="Resize panes"]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true')
    expect(canvasElement.textContent).toContain('Timeline')
    expect(canvasElement.textContent).toContain('Selected move')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvasElement.querySelector('[role="dialog"]')).toBeNull()
    })
    expect(canvasElement.textContent).not.toContain('Selected move')
    expect(canvasElement.textContent).toContain('Timeline')
  },
}

export const SearchKeepsFrame: Story = {
  name: 'Escape in the search leaves the side frame open',
  render: () => renderWorkspace(800),
  play: async ({ canvasElement }) => {
    const search = canvasElement.querySelector('[aria-label="Name search"]')
    if (!(search instanceof HTMLElement)) throw new Error('missing search')
    search.focus()
    await userEvent.keyboard('{Escape}')
    expect(
      canvasElement
        .querySelector('[aria-label="Resize panes"]')
        ?.getAttribute('aria-hidden'),
    ).not.toBe('true')
    expect(canvasElement.textContent).toContain('Selected move')
  },
}

export const CrossBreakpoint: Story = {
  name: 'Crossing 680 pixels moves the frame into the drawer',
  render: () => renderWorkspace(800),
  play: async ({ canvasElement }) => {
    expect(
      canvasElement.querySelector('[aria-label="Resize panes"]'),
    ).toBeTruthy()
    const canvas = canvasElement.querySelector(
      '[data-testid="design-system-canvas"]',
    )
    if (!(canvas instanceof HTMLElement)) throw new Error('missing canvas')
    canvas.style.width = '520px'
    await waitFor(() => {
      expect(canvasElement.querySelector('[role="dialog"]')).toBeTruthy()
    })
    expect(canvasElement.textContent).toContain('Timeline')
    expect(canvasElement.textContent).toContain('Selected move')
    expect(
      canvasElement
        .querySelector('[aria-label="Resize panes"]')
        ?.getAttribute('aria-hidden'),
    ).toBe('true')
  },
}
