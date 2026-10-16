import { context } from '@reatom/core'
import { resetAdminFrame } from '../../root'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, waitFor } from 'storybook/test'

import { button, createActor, role } from '../../../.storybook/helpers'
import { getAdminRoot } from '../../testing/admin-root'
import {
  registerStoryCleanup,
  setCurrentDevtools,
} from '../../testing/storybook-runtime'
import { createOtlpAdminApp } from '../../view/otlp'
import { createAdminDevtools } from '../../view'

const I = createActor()

const meta = {
  title: 'Admin/Shell',
  parameters: { layout: 'fullscreen' },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function visibleSize(element: HTMLElement) {
  const box = element.getBoundingClientRect()
  return {
    width: Math.min(box.right, window.innerWidth) - Math.max(box.left, 0),
    height: Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0),
    box,
  }
}

function documentHasAdminRule(styleId: string | null): boolean {
  if (!styleId) return false
  const marker = `data-reatom-style="${styleId}"`
  const sheets: CSSStyleSheet[] = [...document.adoptedStyleSheets]
  for (const sheet of document.styleSheets) {
    if (sheet instanceof CSSStyleSheet) sheets.push(sheet)
  }
  return sheets.some((sheet) => {
    try {
      return [...sheet.cssRules].some((rule) => rule.cssText.includes(marker))
    } catch {
      return false
    }
  })
}

function shadowOwnsRule(root: HTMLElement) {
  const shadow = root.getRootNode()
  if (!(shadow instanceof ShadowRoot)) return false
  const styleId = root.getAttribute('data-reatom-style')
  if (!styleId) return false
  return shadow.adoptedStyleSheets.some((sheet) =>
    [...sheet.cssRules].some((rule) =>
      rule.cssText.includes(`data-reatom-style="${styleId}"`),
    ),
  )
}

function mountOtlp(story: HTMLElement) {
  const host = document.createElement('div')
  story.append(host)
  const mounted = createOtlpAdminApp(
    host,
    {
      sourceId: 'shell-story',
      resource: { 'service.name': 'shell-story' },
    },
    [],
    { floating: true },
  )
  return {
    host,
    unmount: () => {
      mounted.unmount()
      host.remove()
    },
  }
}

export const ReloadAndResize: Story = {
  name: 'Reload and resize keep the admin panel visible',
  render: () => {
    const story = document.createElement('div')
    story.dataset.testid = 'admin-shell-story'
    story.style.width = '100%'
    story.style.height = '100vh'
    const application = document.createElement('div')
    application.textContent = 'Application'
    story.append(application)
    return story
  },
  play: async ({ canvasElement }) => {
    const story = canvasElement.querySelector(
      '[data-testid="admin-shell-story"]',
    )
    if (!(story instanceof HTMLElement)) throw new Error('Missing shell story')

    let unmountCurrent = () => {}
    registerStoryCleanup(() => unmountCurrent())

    const reset = context.reset
    const first = mountOtlp(story)
    unmountCurrent = first.unmount
    expect(context.reset === reset).toBe(true)
    await waitFor(() => {
      expect(shadowOwnsRule(getAdminRoot())).toBe(true)
    })
    const styleId = getAdminRoot().getAttribute('data-reatom-style')
    resetAdminFrame()
    await waitFor(() => {
      expect(shadowOwnsRule(getAdminRoot())).toBe(true)
      expect(documentHasAdminRule(styleId)).toBe(false)
    })
    first.unmount()

    const second = mountOtlp(story)
    unmountCurrent = second.unmount
    await waitFor(() => {
      expect(shadowOwnsRule(getAdminRoot())).toBe(true)
      expect(
        documentHasAdminRule(getAdminRoot().getAttribute('data-reatom-style')),
      ).toBe(false)
    })
    await I.see(button('Pause').within(getAdminRoot()))
    expect(getComputedStyle(getAdminRoot()).backgroundColor).not.toBe(
      'rgba(0, 0, 0, 0)',
    )

    const floatingHost = second.host
    expect(getComputedStyle(floatingHost).position).toBe('fixed')
    const floatingHandle = floatingHost.shadowRoot?.querySelector(
      '[aria-label="Resize Reatom Admin"]',
    )
    if (!(floatingHandle instanceof HTMLElement)) {
      throw new Error('Missing floating resize handle')
    }
    floatingHandle.focus()
    const floatingWidth = floatingHost.getBoundingClientRect().width
    await I.press('{ArrowRight}')
    await waitFor(() => {
      expect(floatingHost.getBoundingClientRect().width).toBeLessThan(
        floatingWidth - 8,
      )
    })
    const expandedHeight = floatingHost.getBoundingClientRect().height
    await I.click(button('Minimize').within(getAdminRoot()))
    await waitFor(() => {
      expect(floatingHost.getBoundingClientRect().height).toBeLessThan(80)
    })
    await I.click(button('Show admin').within(getAdminRoot()))
    await waitFor(() => {
      expect(floatingHost.getBoundingClientRect().height).toBe(expandedHeight)
    })

    const { page } = await import('vitest/browser')
    await page.viewport(420, 480)
    await waitFor(() => {
      const visible = visibleSize(getAdminRoot())
      expect(visible.width).toBeGreaterThan(280)
      expect(visible.height).toBeGreaterThan(200)
    })

    second.unmount()
    const devtools = createAdminDevtools({
      initialWidth: '640px',
      initialHeight: '420px',
    })
    setCurrentDevtools(devtools)
    unmountCurrent = () => devtools.hide()

    await waitFor(() => {
      expect(shadowOwnsRule(getAdminRoot())).toBe(true)
    })
    const panel = getAdminRoot().closest('[data-reatom-name="DevtoolsPanel"]')
    if (!(panel instanceof HTMLElement)) throw new Error('Missing admin panel')
    const handle = await I.see(
      role('separator', 'Reatom Admin devtools resize handle').within(panel),
    )
    handle.focus()
    const before = panel.getBoundingClientRect().width
    await I.press('{ArrowRight}')
    await waitFor(() => {
      const box = panel.getBoundingClientRect()
      expect(box.width).toBeLessThan(before - 8)
      expect(visibleSize(panel).width).toBeGreaterThan(280)
      expect(box.right).toBeLessThanOrEqual(window.innerWidth + 1)
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
      expect(getComputedStyle(panel).position).toBe('fixed')
    })
  },
}
