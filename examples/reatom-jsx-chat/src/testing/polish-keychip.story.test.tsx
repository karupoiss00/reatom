import { button, createActor, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { cdp, page, userEvent as pointer } from 'vitest/browser'

import { acknowledgeUnlimited } from '../auth'
import { selectTheme } from '../features/layout/theme'
import { bootApp, unmountApp } from './boot'
import { unlimitedKey } from './fixtures/keys'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-polish-nolimit'
const keyboard = userEvent.setup() as unknown as UserEvent

type CdpNode = {
  nodeId: number
  attributes?: string[]
  children?: CdpNode[]
  contentDocument?: CdpNode
  shadowRoots?: CdpNode[]
}

type CdpSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<{
    root?: CdpNode
  }>
}

const chip = () =>
  document.querySelector<HTMLButtonElement>('[data-slot="KeyChip"]')

const pill = () => chip()?.querySelector<HTMLElement>(':scope > * [data-tone]') ?? null

const forcePseudo = async (element: HTMLElement, state: string) => {
  element.setAttribute('data-gallery-force', state)
  const session = cdp() as CdpSession
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true })
  const visit = (node: CdpNode): number | null => {
    const attributes = node.attributes ?? []
    if (attributes.includes('data-gallery-force')) return node.nodeId
    for (const child of node.children ?? []) {
      const found = visit(child)
      if (found) return found
    }
    if (node.contentDocument) {
      const found = visit(node.contentDocument)
      if (found) return found
    }
    for (const shadow of node.shadowRoots ?? []) {
      const found = visit(shadow)
      if (found) return found
    }
    return null
  }
  const nodeId = root ? visit(root) : null
  if (nodeId) {
    await session.send('CSS.forcePseudoState', {
      nodeId,
      forcedPseudoClasses: state.split(' '),
    })
  }
}

const beforeHeight = (element: HTMLElement) =>
  Number.parseFloat(getComputedStyle(element, '::before').height)

afterEach(async () => {
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('the acknowledged No limit chip stays fully visible on hover', async () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
  await bootApp({
    key: storyKey,
    keyMeta: unlimitedKey,
    viewport: desktop,
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  selectTheme('dark')
  await acknowledgeUnlimited()
  await I.see(button(/No limit/).wait())
  await expect.poll(() => chip()?.getAttribute('data-badge')).toBe('true')
  const spendingLimit = () =>
    [...document.querySelectorAll('dialog')].find((node) =>
      node.textContent?.includes('This key has no spending limit'),
    )
  await expect.poll(() => spendingLimit()?.open ?? false).toBe(false)

  const control = chip()
  const badge = pill()
  expect(control).toBeTruthy()
  expect(badge).toBeTruthy()
  await forcePseudo(control!, 'hover')
  await pointer.hover(control!)
  await expect.poll(() => control!.matches(':hover')).toBe(true)

  const buttonBox = control!.getBoundingClientRect()
  const badgeBox = badge!.getBoundingClientRect()
  const icon = badge!.querySelector('svg')
  const iconBox = icon?.getBoundingClientRect()
  const style = getComputedStyle(control!)
  const hoverBeforeHeight = beforeHeight(control!)
  const visual = style.getPropertyValue('--visual-bg').trim()

  expect(style.overflowX).toBe('visible')
  expect(badgeBox.left).toBeGreaterThanOrEqual(buttonBox.left - 0.5)
  expect(badgeBox.right).toBeLessThanOrEqual(buttonBox.right + 0.5)
  expect(iconBox?.left ?? badgeBox.left).toBeGreaterThanOrEqual(buttonBox.left - 0.5)
  expect(visual).toBe('transparent')
  expect(hoverBeforeHeight).toBeLessThanOrEqual(badgeBox.height + 0.5)

  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('U-04', 'hover')

  control!.focus()
  await forcePseudo(control!, 'focus focus-visible')
  const focusBeforeHeight = beforeHeight(control!)
  expect(Math.abs(focusBeforeHeight - badgeBox.height)).toBeLessThanOrEqual(0.5)
})
