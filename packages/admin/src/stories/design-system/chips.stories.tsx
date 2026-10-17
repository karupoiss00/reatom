import { atom } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent } from 'storybook/test'

import { button, createActor } from '../../../.storybook/helpers'
import { ADMIN_FRAME } from '../../root'
import { Button } from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const I = createActor()

const meta = {
  title: 'Design System/Chips',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

export const GhostChip: Story = {
  name: 'Ghost chip toggles with click and Enter',
  render: () => {
    const pressed = atom(false, '_Admin.stories.ds.errorsChip')
    return ADMIN_FRAME.run(() =>
      renderDesignCanvas(
        <div
          css={`
            display: grid;
            gap: var(--admin-space-12);
            padding: var(--admin-space-16);
          `}
        >
          <h1>Filters</h1>
          <Button
            variant="ghost"
            label="Errors"
            pressed={() => pressed()}
            onClick={() => pressed.set(!pressed())}
          />
          <Button
            variant="secondary"
            label="ClickHouse"
            pressed={() => pressed()}
            onClick={() => pressed.set(!pressed())}
          />
        </div>,
      ),
    )
  },
  play: async ({ canvasElement }) => {
    const chip = () => canvasElement.querySelector('[aria-label="Errors"]')
    expect(chip()?.getAttribute('aria-pressed')).toBe('false')

    await I.click(button('Errors'))
    expect(chip()?.getAttribute('aria-pressed')).toBe('true')

    await userEvent.keyboard('{Enter}')
    expect(chip()?.getAttribute('aria-pressed')).toBe('false')

    await userEvent.keyboard('{Enter}')
    expect(chip()?.getAttribute('aria-pressed')).toBe('true')
  },
}
