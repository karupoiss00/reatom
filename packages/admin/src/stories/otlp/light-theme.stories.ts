import type { Meta, StoryObj } from '@storybook/html'
import { expect, waitFor } from 'storybook/test'

import { ADMIN_FRAME } from '../../root'
import { matchStoryRootScreenshot } from '../../testing/visual'
import { adminSettings } from '../../view/settings'
import { renderOtlpChrome } from './boot'
import {
  STORY_ANALYTICS_BATCH,
  STORY_FIXTURE_BATCH,
  STORY_RESOURCE,
} from './fixtures'

const VISUAL_VIEWPORT = { width: 1280, height: 800 } as const

const meta = {
  title: 'OTLP/Light theme',
  tags: ['@smoke', '@visual'],
  parameters: {
    layout: 'fullscreen',
    vitest: { testTimeout: 30_000 },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function adminRoot(canvas: HTMLElement): ParentNode {
  const story =
    canvas.querySelector('[data-testid="otlp-chrome-story-root"]') ?? canvas
  const host = story.querySelector('[data-testid="otlp-chrome-host"]')
  if (host instanceof HTMLElement && host.shadowRoot) return host.shadowRoot
  return story
}

function tabByLabel(root: ParentNode, label: string): HTMLElement {
  const tab = root.querySelector(`[role="tab"][aria-label="${label}"]`)
  if (!(tab instanceof HTMLElement)) throw new Error(`Tab not found: ${label}`)
  return tab
}

function clickElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center' })
  element.click()
}

function ganttRowByLabel(root: ParentNode, label: string): HTMLElement {
  const match = [...root.querySelectorAll('[data-testid="gantt-row"]')].find(
    (row) =>
      (
        row.querySelector('[data-testid="gantt-row-label"]')?.textContent ?? ''
      ).includes(label),
  )
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Gantt row not found: ${label}`)
  }
  return match
}

async function snapshot(root: ParentNode, name: string) {
  const target =
    root.querySelector('[data-testid="admin-visual-snapshot"]') ??
    (root instanceof ShadowRoot ? root.host : null)
  if (!(target instanceof HTMLElement)) {
    throw new Error('Visual snapshot target missing')
  }
  await matchStoryRootScreenshot(target, name)
}

export const LightShell: Story = {
  name: 'Light Timeline Graph State Analytics',
  render: () => {
    ADMIN_FRAME.run(() => adminSettings().scheme.set('light'))
    return renderOtlpChrome(
      [...STORY_FIXTURE_BATCH, ...STORY_ANALYTICS_BATCH],
      STORY_RESOURCE,
      VISUAL_VIEWPORT,
    )
  },
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)
    const root = adminRoot(canvasElement)

    await waitFor(() => {
      expect(root.textContent).toContain('Reatom Admin')
      const shell = root.querySelector('[data-admin-scheme="light"]')
      expect(shell).toBeInstanceOf(HTMLElement)
    })

    clickElement(tabByLabel(root, 'Timeline'))
    await waitFor(() => {
      expect(root.querySelector('[data-testid="otlp-gantt"]')).toBeInstanceOf(
        HTMLElement,
      )
    })
    const expandAll = root.querySelector('[data-testid="gantt-expand-all"]')
    if (expandAll instanceof HTMLElement) clickElement(expandAll)
    await waitFor(() => {
      expect(ganttRowByLabel(root, 'tree.checked')).toBeInstanceOf(HTMLElement)
    })
    clickElement(ganttRowByLabel(root, 'tree.checked'))
    await waitFor(() => {
      const card =
        root.querySelector('[data-reatom-name="FrameCard"]') ??
        root.querySelector('[data-reatom-name="OtlpInspector"]')
      expect(card?.textContent).toContain('tree.checked')
    })
    await snapshot(root, 'light-timeline')

    clickElement(tabByLabel(root, 'Graph'))
    await waitFor(() => {
      expect(root.querySelector('[data-reatom-name="RailGraph"]')).toBeInstanceOf(
        HTMLElement,
      )
    })
    await snapshot(root, 'light-graph')

    clickElement(tabByLabel(root, 'State'))
    await waitFor(() => {
      expect(
        root.querySelector('[data-testid="otlp-state-tree"]'),
      ).toBeInstanceOf(HTMLElement)
    })
    await snapshot(root, 'light-state')

    clickElement(tabByLabel(root, 'Analytics'))
    await waitFor(() => {
      expect(
        root.querySelector('[data-testid="analytics-kpi-sessions"]'),
      ).toBeInstanceOf(HTMLElement)
    })
    await snapshot(root, 'light-analytics')
  },
}
