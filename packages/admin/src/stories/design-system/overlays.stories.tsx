import { atom } from '@reatom/core'
import { mount } from '@reatom/jsx'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent, waitFor } from 'storybook/test'

import { button, createActor, text } from '../../../.storybook/helpers'
import { ADMIN_FRAME } from '../../root'
import {
  adminThemeVars,
  Button,
  Drawer,
  Popover,
  Toast,
  tokens,
} from '../../view/design-system'
import { renderDesignCanvas } from './canvas'

const I = createActor()

const meta = {
  title: 'Design System/Overlays',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function overlayShell(child: Element) {
  return renderDesignCanvas(
    <div
      css={`
        position: relative;
        height: 100%;
      `}
    >
      {child}
    </div>,
  )
}

export const DrawerEscape: Story = {
  name: 'Drawer closes with Escape',
  render: () =>
    ADMIN_FRAME.run(() => {
      const open = atom(false, '_Admin.stories.ds.drawer')
      return overlayShell(
        <div
          css={`
            display: grid;
            gap: var(--admin-space-12);
            padding: var(--admin-space-16);
          `}
        >
          <h1>Records</h1>
          <Button label="Open frame" onClick={() => open.set(true)} />
          <Drawer open={open} label="Frame" onClose={() => open.set(false)}>
            <p>Frame body</p>
          </Drawer>
        </div>,
      )
    }),
  play: async ({ canvasElement }) => {
    await I.click(button('Open frame'))
    await I.see(text('Frame body').wait())
    const dialog = canvasElement.querySelector('[role="dialog"]')
    expect(dialog).toBeTruthy()

    await userEvent.keyboard('{Tab}')
    expect(dialog?.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(canvasElement.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Open frame',
    )

    await I.click(button('Open frame'))
    await I.see(text('Frame body').wait())
  },
}

export const DrawerShadow: Story = {
  name: 'Drawer stays inside the shadow root',
  render: () => {
    const root = document.createElement('div')
    const heading = document.createElement('h1')
    heading.textContent = 'Shadow overlay'
    root.append(heading)

    const host = document.createElement('div')
    host.dataset.testid = 'shadow-host'
    host.style.height = '360px'
    host.style.position = 'relative'
    root.append(host)

    const shadow = host.attachShadow({ mode: 'open' })
    const shadowBody = document.createElement('div')
    shadowBody.style.height = '360px'
    shadowBody.style.position = 'relative'
    shadow.append(shadowBody)
    const mountPoint = document.createElement('div')
    mountPoint.style.height = '360px'
    mountPoint.style.position = 'relative'
    shadowBody.append(mountPoint)

    ADMIN_FRAME.run(() => {
      const open = atom(false, '_Admin.stories.ds.shadowDrawer')
      mount(
        mountPoint,
        <div
          css={`
            ${adminThemeVars}
            position: relative;
            height: 360px;
            background: ${tokens.canvas};
            color: ${tokens.text1};
          `}
        >
          <Button label="Open frame" onClick={() => open.set(true)} />
          <Drawer open={open} label="Frame" onClose={() => open.set(false)}>
            <p>Frame body</p>
          </Drawer>
        </div>,
      )
    })
    return root
  },
  play: async ({ canvasElement }) => {
    const host = canvasElement.querySelector('[data-testid="shadow-host"]')
    if (!(host instanceof HTMLElement) || !host.shadowRoot) {
      throw new Error('missing shadow host')
    }
    const shadow = host.shadowRoot
    const trigger = shadow.querySelector('[aria-label="Open frame"]')
    if (!(trigger instanceof HTMLElement)) {
      throw new Error('missing shadow trigger')
    }

    await userEvent.click(trigger)
    const dialog = shadow.querySelector('[role="dialog"]')
    expect(dialog?.getRootNode()).toBe(shadow)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  },
}

export const UndoToast: Story = {
  name: 'Undo toast restores before it expires',
  render: () =>
    ADMIN_FRAME.run(() => {
      const open = atom(false, '_Admin.stories.ds.undoToast')
      const outcome = atom('Idle', '_Admin.stories.ds.undoOutcome')
      return overlayShell(
        <div
          css={`
            display: grid;
            gap: var(--admin-space-12);
            padding: var(--admin-space-16);
          `}
        >
          <h1>Session</h1>
          <Button
            label="Clear records"
            onClick={() => {
              outcome.set('Idle')
              open.set(true)
            }}
          />
          <p>{outcome}</p>
          <Toast
            open={open}
            message="Records cleared"
            actionLabel="Undo"
            durationMs={20000}
            onAction={() => outcome.set('Restored')}
            onDismiss={() => outcome.set('Dropped')}
          />
        </div>,
      )
    }),
  play: async () => {
    await I.click(button('Clear records'))
    await I.see(text('Records cleared').wait())
    await I.see(button('Undo').wait())
    await I.click(button('Undo'))
    await I.see(text('Restored').wait())
    await I.dontSee(text('Records cleared'))
  },
}

export const ToastExpiry: Story = {
  name: 'Toast dismisses when the time runs out',
  render: () =>
    ADMIN_FRAME.run(() => {
      const open = atom(false, '_Admin.stories.ds.expiryToast')
      const outcome = atom('Idle', '_Admin.stories.ds.expiryOutcome')
      return overlayShell(
        <div
          css={`
            display: grid;
            gap: var(--admin-space-12);
            padding: var(--admin-space-16);
          `}
        >
          <h1>Session</h1>
          <Button
            label="Clear records"
            onClick={() => {
              outcome.set('Idle')
              open.set(true)
            }}
          />
          <p>{outcome}</p>
          <Toast
            open={open}
            message="Records cleared"
            durationMs={400}
            onDismiss={() => outcome.set('Dropped')}
          />
        </div>,
      )
    }),
  play: async ({ canvasElement }) => {
    await I.click(button('Clear records'))
    await I.see(text('Records cleared').wait())
    await waitFor(
      () => {
        expect(canvasElement.textContent).toContain('Dropped')
      },
      { timeout: 2000 },
    )
    await I.dontSee(text('Records cleared'))
  },
}

export const PopoverDismiss: Story = {
  name: 'Popover closes with Escape and an outside click',
  render: () =>
    ADMIN_FRAME.run(() =>
      overlayShell(
        <div
          css={`
            display: flex;
            gap: var(--admin-space-12);
            align-items: start;
            padding: var(--admin-space-16);
          `}
        >
          <h1>Status</h1>
          <Button label="Outside" onClick={() => undefined} />
          <Popover triggerLabel="Drop reasons" label="Why records were dropped">
            <p>Queue overflow</p>
          </Popover>
        </div>,
      ),
    ),
  play: async () => {
    await I.click(button('Drop reasons'))
    await I.see(text('Queue overflow').wait())
    await userEvent.keyboard('{Escape}')
    await I.dontSee(text('Queue overflow'))

    await I.click(button('Drop reasons'))
    await I.see(text('Queue overflow').wait())
    await I.click(button('Outside'))
    await I.dontSee(text('Queue overflow'))

    await I.click(button('Drop reasons'))
    await I.see(text('Queue overflow').wait())
  },
}
