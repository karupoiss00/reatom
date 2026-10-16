import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent } from 'storybook/test'

import { button, createActor, text } from '../../../.storybook/helpers'
import { ADMIN_FRAME } from '../../root'
import { Button, Disclosure, Kbd } from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const I = createActor()

const meta = {
  title: 'Design System/Disclosure',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const AdvancedFilters: Story = {
  name: 'Disclosure opens and closes from the keyboard',
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(
        <div
          css={`
            display: grid;
            gap: var(--admin-space-12);
            padding: var(--admin-space-16);
          `}
        >
          <h1>Filters</h1>
          <Disclosure label="Advanced filters">
            <p>Token highlighting</p>
          </Disclosure>
        </div>,
      ),
    ),
  play: async ({ canvasElement }) => {
    const summary = canvasElement.querySelector('summary')
    expect(summary?.parentElement).toBeInstanceOf(HTMLDetailsElement)
    expect((summary?.parentElement as HTMLDetailsElement).open).toBe(false)

    if (!(summary instanceof HTMLElement)) {
      throw new Error('missing summary')
    }
    await userEvent.click(summary)
    await I.see(text('Token highlighting').wait())

    summary.focus()
    await userEvent.keyboard('{Enter}')
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(false)

    await userEvent.keyboard('{Enter}')
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(true)
    await I.see(text('Token highlighting').wait())
  },
}

export const ShortcutChord: Story = {
  name: 'Shortcut keycaps show the chord',
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(
        <div
          css={`
            display: flex;
            gap: var(--admin-space-8);
            align-items: center;
            padding: var(--admin-space-16);
          `}
        >
          <h1>Help</h1>
          <Button label="Back" onClick={() => undefined} />
          <Kbd keys={['Alt', 'Left']} label="Alt Left" />
        </div>,
      ),
    ),
  play: async ({ canvasElement }) => {
    const chord = canvasElement.querySelector('kbd')
    expect(chord?.getAttribute('aria-label')).toBe('Alt Left')
    expect(chord?.textContent).toContain('Alt')
    expect(chord?.textContent).toContain('Left')
    await I.see(button('Back'))
    expect(chord?.closest('button')).toBeNull()
  },
}
