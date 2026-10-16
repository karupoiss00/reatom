import type { Meta, StoryObj } from '@storybook/html'
import { expect } from 'storybook/test'

import { ADMIN_FRAME } from '../../root'
import { matchStoryRootScreenshot } from '../../testing/visual'
import {
  StatusDot,
  tokens,
  type as typeRoles,
} from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const meta = {
  title: 'Design System/Tokens',
  tags: ['@smoke'],
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const swatches = [
  ['Canvas', tokens.canvas],
  ['Surface 1', tokens.surface1],
  ['Surface 2', tokens.surface2],
  ['Surface 3', tokens.surface3],
  ['Text 1', tokens.text1],
  ['Accent', tokens.accent],
  ['Success', tokens.success],
  ['Warning', tokens.warning],
  ['Error', tokens.error],
] as const

const TokenBoard = () => (
  <div
    css={`
      display: grid;
      gap: var(--admin-space-16);
      padding: var(--admin-space-16);
    `}
  >
    <section>
      <h2 css={`${typeRoles.title} margin: 0 0 var(--admin-space-8);`}>
        Color tokens
      </h2>
      <div
        css={`
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
          gap: var(--admin-space-8);
        `}
      >
        {swatches.map(([label, color]) => (
          <div
            css={`
              display: grid;
              gap: var(--admin-space-4);
            `}
          >
            <div
              css={`
                height: 36px;
                background: ${color};
                border: 1px solid ${tokens.border1};
              `}
            />
            <span css={`${typeRoles.meta} color: ${tokens.text2};`}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </section>
    <section>
      <h2 css={`${typeRoles.title} margin: 0 0 var(--admin-space-8);`}>
        Type roles
      </h2>
      <div
        css={`
          display: grid;
          gap: var(--admin-space-8);
        `}
      >
        <span css={typeRoles.meta}>Meta 11 / 16</span>
        <span css={typeRoles.data}>Data 12 / 18</span>
        <span css={typeRoles.ui}>UI 12 / 16</span>
        <span css={typeRoles.body}>Body 13 / 20</span>
        <span css={typeRoles.title}>Title 15 / 20</span>
      </div>
    </section>
    <section>
      <h2 css={`${typeRoles.title} margin: 0 0 var(--admin-space-8);`}>
        Statuses
      </h2>
      <div
        css={`
          display: flex;
          gap: var(--admin-space-12);
        `}
      >
        <StatusDot tone="success" label="Live" />
        <StatusDot tone="warning" label="Replay" />
        <StatusDot tone="error" label="Error" />
        <StatusDot tone="info" label="Info" />
      </div>
    </section>
  </div>
)

export const DarkDocked: Story = {
  name: 'Tokens 560x760',
  tags: ['@visual'],
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(<TokenBoard />, { width: 560, height: 760 }),
    ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toContain('Color tokens')
    expect(canvasElement.textContent).toContain('Type roles')
    expect(canvasElement.textContent).toContain('Live')
    await matchStoryRootScreenshot(canvasElement, 'tokens-560')
  },
}

export const DarkWide: Story = {
  name: 'Tokens 1280x800',
  tags: ['@visual'],
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(<TokenBoard />, { width: 1280, height: 800 }),
    ),
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toContain('Title 15 / 20')
    await matchStoryRootScreenshot(canvasElement, 'tokens-1280')
  },
}
