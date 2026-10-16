import { atom } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { userEvent } from 'storybook/test'

import {
  button,
  createActor,
  heading,
  role,
  text,
} from '../../../.storybook/helpers'
import { ADMIN_FRAME } from '../../root'
import { Inspector } from '../../view/inspector'
import { renderDesignCanvas } from './canvas'

const I = createActor()

const meta = {
  title: 'Design System/Inspector',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function inspectorCanvas(child: Element) {
  return renderDesignCanvas(
    <div
      css={`
        display: grid;
        gap: var(--admin-space-12);
        padding: var(--admin-space-16);
      `}
    >
      <h1>Payload</h1>
      {child}
    </div>,
  )
}

export const NestedValue: Story = {
  name: 'Nested field stays hidden until the value opens',
  render: () =>
    ADMIN_FRAME.run(() => {
      const value = atom([{ count: 1 }], '_Admin.stories.ds.inspector.nested')
      return inspectorCanvas(<Inspector value={value} name="state" />)
    }),
  play: async () => {
    await I.see(heading('Payload'))
    await I.see(text('state ='))
    await I.dontSee(text('count'))
    await I.seeAttribute(button('Array(1) ['), 'aria-expanded', 'false')

    await I.click(button('Array(1) ['))
    await I.see(text('count').wait())
    await I.seeAttribute(button('Array(1) ['), 'aria-expanded', 'true')

    await userEvent.keyboard('{Enter}')
    await I.seeAttribute(button('Array(1) ['), 'aria-expanded', 'false')
    await I.dontSee(text('count'))
  },
}

export const UndefinedValue: Story = {
  name: 'Undefined value reads as undefined',
  render: () =>
    ADMIN_FRAME.run(() => {
      const value = atom(undefined, '_Admin.stories.ds.inspector.empty')
      return inspectorCanvas(<Inspector value={value} />)
    }),
  play: async () => {
    await I.see(heading('Payload'))
    await I.see(text('undefined').wait())
    await I.dontSee(role('button'))
  },
}
