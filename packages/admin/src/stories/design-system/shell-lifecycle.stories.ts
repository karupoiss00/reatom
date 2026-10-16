import { context } from '@reatom/core'
import { resetAdminFrame } from '../../root'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, waitFor } from 'storybook/test'

import { button, createActor, heading, role } from '../../../.storybook/helpers'
import { getAdminRoot } from '../../testing/admin-root'
import {
  registerStoryCleanup,
  setCurrentDevtools,
} from '../../testing/storybook-runtime'
import { createAdminDevtools } from '../../view'
import { createOtlpAdminApp } from '../../view/otlp'

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

const shellStubRecords = [
  {
    traceId: 'a1b2c3d4e5f6789012345678abcdef01',
    spanId: '1111111111111111',
    name: 'shell.resize',
    startTimeUnixNano: '10000000',
    endTimeUnixNano: '18000000',
    attributes: {
      'reatom.name': 'shell.resize',
      'reatom.kind': 'action',
      'reatom.outcome': 'ok',
      'reatom.payload': '640',
      'reatom.frame.id': '1',
    },
  },
  {
    traceId: 'a1b2c3d4e5f6789012345678abcdef01',
    spanId: '2222222222222222',
    name: 'panel.width',
    startTimeUnixNano: '18000000',
    endTimeUnixNano: '19000000',
    attributes: {
      'reatom.name': 'panel.width',
      'reatom.kind': 'atom',
      'reatom.outcome': 'ok',
      'reatom.payload': '652',
      'reatom.frame.id': '2',
      'reatom.cause.ids': ['1'],
    },
  },
]

function mountOtlp(story: HTMLElement) {
  const host = document.createElement('div')
  story.append(host)
  const mounted = createOtlpAdminApp(
    host,
    {
      sourceId: 'shell-story',
      resource: { 'service.name': 'shell-story' },
    },
    shellStubRecords,
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

function shellCanvas() {
  const story = document.createElement('div')
  story.dataset.testid = 'admin-shell-story'
  story.style.width = '100%'
  story.style.height = '100vh'
  const application = document.createElement('div')
  application.textContent = 'Application'
  story.append(application)
  return story
}

function dragCorner(
  handle: Element,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  const pointer = {
    bubbles: true,
    cancelable: true,
    pointerId: 4,
    pointerType: 'mouse',
    button: 0,
  }
  handle.dispatchEvent(
    new PointerEvent('pointerdown', {
      ...pointer,
      clientX: fromX,
      clientY: fromY,
      buttons: 1,
    }),
  )
  handle.dispatchEvent(
    new PointerEvent('pointermove', {
      ...pointer,
      clientX: toX,
      clientY: toY,
      buttons: 1,
    }),
  )
  handle.dispatchEvent(
    new PointerEvent('pointerup', {
      ...pointer,
      clientX: toX,
      clientY: toY,
      buttons: 0,
    }),
  )
}

export const CornerGripTracksPointer: Story = {
  name: 'Corner grip tracks the pointer',
  render: () => shellCanvas(),
  play: async ({ canvasElement }) => {
    const story = canvasElement.querySelector(
      '[data-testid="admin-shell-story"]',
    )
    if (!(story instanceof HTMLElement)) throw new Error('Missing shell story')
    let unmountCurrent = () => {}
    registerStoryCleanup(() => unmountCurrent())
    const mounted = mountOtlp(story)
    unmountCurrent = mounted.unmount

    await I.see(button('Close').within(getAdminRoot()).wait())
    const handle = mounted.host.shadowRoot?.querySelector(
      '[aria-label="Resize Reatom Admin"]',
    )
    if (!(handle instanceof HTMLElement)) {
      throw new Error('Missing floating resize handle')
    }
    const before = mounted.host.getBoundingClientRect()
    const fromX = before.left + 8
    const fromY = before.top + 8
    dragCorner(handle, fromX, fromY, fromX + 60, fromY + 30)
    const after = mounted.host.getBoundingClientRect()
    expect(Math.abs(after.width - (before.width - 60))).toBeLessThan(2)
    expect(Math.abs(after.height - (before.height - 30))).toBeLessThan(2)

    handle.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: fromX + 120,
        clientY: fromY + 80,
        pointerId: 4,
        pointerType: 'mouse',
        buttons: 1,
      }),
    )
    expect(mounted.host.getBoundingClientRect().width).toBe(after.width)
  },
}

export const CloseLeavesCornerIcon: Story = {
  name: 'Close leaves an icon in the chosen corner',
  render: () => shellCanvas(),
  play: async ({ canvasElement }) => {
    const story = canvasElement.querySelector(
      '[data-testid="admin-shell-story"]',
    )
    if (!(story instanceof HTMLElement)) throw new Error('Missing shell story')
    let unmountCurrent = () => {}
    registerStoryCleanup(() => unmountCurrent())
    const mounted = mountOtlp(story)
    unmountCurrent = mounted.unmount

    const shell = () => getAdminRoot()
    await I.click(role('tab', 'Settings').within(shell()).wait())
    await I.see(heading('Window').within(shell()).wait())
    await I.click(role('radio', 'Top left').within(shell()))
    await waitFor(() => {
      expect(mounted.host.dataset['corner']).toBe('top-left')
      expect(shell().dataset['adminCorner']).toBe('top-left')
    })

    await I.click(button('Close').within(shell()))
    const icon = await I.see(button('Open Reatom Admin').within(shell()).wait())
    await waitFor(() => {
      const box = icon.getBoundingClientRect()
      expect(Math.abs(box.left - 16)).toBeLessThan(8)
      expect(Math.abs(box.top - 16)).toBeLessThan(8)
      expect(box.width).toBeLessThan(56)
      expect(box.height).toBeLessThan(56)
    })

    await I.click(button('Open Reatom Admin').within(shell()))
    await I.see(button('Close').within(shell()).wait())
    await waitFor(() => {
      const box = mounted.host.getBoundingClientRect()
      expect(Math.abs(box.left - 16)).toBeLessThan(8)
      expect(Math.abs(box.top - 16)).toBeLessThan(8)
      expect(box.width).toBeGreaterThan(300)
    })
    const handle = mounted.host.shadowRoot?.querySelector(
      '[aria-label="Resize Reatom Admin"]',
    )
    if (!(handle instanceof HTMLElement)) {
      throw new Error('Missing floating resize handle')
    }
    const hostBox = mounted.host.getBoundingClientRect()
    const handleBox = handle.getBoundingClientRect()
    expect(handleBox.right).toBeGreaterThan(hostBox.right - 20)
    expect(handleBox.bottom).toBeGreaterThan(hostBox.bottom - 20)
  },
}
