import { atom } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent } from 'storybook/test'

import { ADMIN_FRAME } from '../../root'
import { matchStoryRootScreenshot } from '../../testing/visual'
import {
  DataGrid,
  EmptyState,
  InspectorTabs,
  RailGraph,
  SplitPane,
  type InspectorTabId,
  type RailInputNode,
} from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const meta = {
  title: 'Design System/Workspace',
  tags: ['@smoke'],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const RAIL_NODES: Array<RailInputNode> = [
  {
    id: 1,
    label: 'boot',
    kind: 'action',
    timestamp: 10,
    parentIds: [],
    hasError: false,
  },
  {
    id: 2,
    label: 'count',
    kind: 'state',
    timestamp: 20,
    parentIds: [1],
    hasError: false,
  },
  {
    id: 3,
    label: 'increment',
    kind: 'action',
    timestamp: 30,
    parentIds: [2],
    hasError: false,
  },
  {
    id: 4,
    label: 'failedFetch',
    kind: 'action',
    timestamp: 40,
    parentIds: [1],
    hasError: true,
  },
  {
    id: 5,
    label: 'count',
    kind: 'state',
    timestamp: 50,
    parentIds: [3, 4],
    hasError: false,
  },
  {
    id: 6,
    label: 'counterView',
    kind: 'state',
    timestamp: 60,
    parentIds: [5],
    hasError: false,
  },
]

function WorkspaceBoard() {
  const selectedId = atom('3', '_Admin.stories.ds.gridSelected')
  const splitRatio = atom(0.42, '_Admin.stories.ds.split')
  const inspectorTab = atom<InspectorTabId>(
    'causes',
    '_Admin.stories.ds.inspector',
  )
  const rows = () => [
    { id: '1', name: 'boot', value: '{}' },
    { id: '3', name: 'increment', value: '1' },
    { id: '5', name: 'count', value: '2' },
  ]

  return (
    <div
      css={`
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        height: 100%;
      `}
    >
      <SplitPane
        ratio={splitRatio}
        minLeft={180}
        minRight={180}
        defaultRatio={0.42}
        left={
          <DataGrid
            ariaLabel="Activity feed"
            columns={[
              {
                id: 'name',
                header: 'Action / Atom',
                render: (row) => <strong>{row.name}</strong>,
              },
              {
                id: 'value',
                header: 'Value',
                render: (row) => <span>{row.value}</span>,
              },
            ]}
            rows={rows}
            getRowId={(row) => row.id}
            selectedId={() => selectedId()}
            onSelect={(row) => selectedId.set(row.id)}
            empty={
              <EmptyState
                title="No frames"
                description="Interact with the app to capture frames."
              />
            }
          />
        }
        right={
          <div
            css={`
              display: grid;
              grid-template-rows: auto minmax(0, 1fr);
              height: 100%;
            `}
          >
            <InspectorTabs value={inspectorTab} />
            <RailGraph
              nodes={RAIL_NODES}
              selectedId={5}
              onSelect={() => undefined}
              onReroot={() => undefined}
            />
          </div>
        }
      />
    </div>
  )
}

export const WorkspaceDocked: Story = {
  name: 'Workspace 560x760',
  tags: ['@visual'],
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(<WorkspaceBoard />, { width: 560, height: 760 }),
    ),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector('[role="grid"]')
    const splitter = canvasElement.querySelector('[aria-label="Resize panes"]')
    const rail = canvasElement.querySelector('[data-reatom-name="RailGraph"]')
    expect(grid).toBeTruthy()
    expect(splitter).toBeTruthy()
    expect(rail).toBeTruthy()
    expect(
      canvasElement.querySelector('nav[aria-label="Shortest path from root"]'),
    ).toBeTruthy()
    expect(canvasElement.textContent).toContain('Cause Chain')

    if (grid instanceof HTMLElement) {
      grid.focus()
      await userEvent.keyboard('{ArrowDown}')
    }

    await matchStoryRootScreenshot(canvasElement, 'workspace-560')
  },
}

export const WorkspaceWide: Story = {
  name: 'Workspace 1280x800',
  tags: ['@visual'],
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(<WorkspaceBoard />, { width: 1280, height: 800 }),
    ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-reatom-name="RailGraph"]')).toBeTruthy()
    await matchStoryRootScreenshot(canvasElement, 'workspace-1280')
  },
}

export const RailOverflow: Story = {
  name: 'RailGraph overflow lanes',
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toMatch(/\+\d+ nodes? not drawn/)
  },
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(
        <RailGraph
          nodes={[
            {
              id: 1,
              label: 'root',
              kind: 'state',
              timestamp: 1,
              parentIds: [],
              hasError: false,
            },
            ...[2, 3, 4, 5, 6, 7, 8].map((id) => ({
              id,
              label: `branch${id}`,
              kind: 'state',
              timestamp: id,
              parentIds: [1],
              hasError: id === 7,
            })),
            {
              id: 9,
              label: 'selected',
              kind: 'state',
              timestamp: 9,
              parentIds: [2],
              hasError: false,
            },
          ]}
          selectedId={9}
          onSelect={() => undefined}
          onReroot={() => undefined}
        />,
        { width: 560, height: 760 },
      ),
    ),
}
