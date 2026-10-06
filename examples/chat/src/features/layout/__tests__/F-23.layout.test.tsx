import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { afterEach, describe, expect, test } from 'vitest'
import { cdp, page, userEvent } from 'vitest/browser'

import { App } from '../../../App'
import { ui } from '../../../app/ui'
import { activeChatId, homeRoute, openChat } from '../../../routes'
import { sidebarCollapsed } from '../../../storage/prefs'
import { bootApp, unmountApp } from '../../../testing/boot'
import { shot } from '../../../testing/screenshot'
import { openLayerCount, resetUiState } from '../../../ui'

type CdpSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>
}

const session = () => cdp() as CdpSession

const seededKey = 'sk-or-v1-layout-test-key'
const phone = { width: 390, height: 844 }
const desktop = { width: 1280, height: 800 }
const keyboardHeight = 300
const safeAreaBottom = 34

const longWord = 'Supercalifragilisticexpialidocious'.repeat(4)

const seededChat = {
  id: 'chat-layout',
  title: 'Weekend trip to Lisbon',
  messages: [
    {
      role: 'user' as const,
      content: `Plan a calm two-day walk through Alfama and Belém. ${longWord}`,
    },
    {
      role: 'assistant' as const,
      content: [
        'Day one starts slow: coffee at a miradouro, then the tram down to Baixa.',
        '',
        '```ts',
        `const itinerary = ['Alfama', 'Baixa', 'Belém', 'LX Factory', 'Cais do Sodré', 'Príncipe Real'] // ${longWord}`,
        '```',
        '',
        '| Stop | Time | Note |',
        '| --- | --- | --- |',
        `| Belém | 10:00 | ${longWord} |`,
      ].join('\n'),
    },
  ],
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const paint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const settle = async () => {
  await paint()
  await sleep(420)
}

const expectNoOverlay = () => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
}

const shell = () => document.querySelector<HTMLElement>('[data-testid="shell"]')!
const menuButton = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="drawer-menu"]')!
const drawer = () =>
  document.querySelector<HTMLDialogElement>('[data-testid="drawer"]')!
const composer = () =>
  document.querySelector<HTMLElement>('[data-testid="composer"]')!

const openSeededChat = async () => {
  openChat(seededChat.id)
  await expect.poll(() => activeChatId()).toBe(seededChat.id)
  await expect
    .poll(() => document.querySelector('[data-slot="Thread"]')?.textContent ?? '')
    .toContain('Day one starts slow')
  await paint()
}

const toPagePoint = (x: number, y: number) => {
  let pageX = x
  let pageY = y
  for (let view: Window = window; view !== view.parent; view = view.parent) {
    const frame = view.frameElement as HTMLElement | null
    if (!frame) break
    const rect = frame.getBoundingClientRect()
    const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1
    pageX = rect.left + frame.clientLeft * scale + pageX * scale
    pageY = rect.top + frame.clientTop * scale + pageY * scale
  }
  return { x: pageX, y: pageY }
}

const mouse = (type: string, x: number, y: number, buttons = 1) =>
  session().send('Input.dispatchMouseEvent', {
    type,
    ...toPagePoint(x, y),
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  })

const drag = async (from: number, to: number, y: number) => {
  await mouse('mouseMoved', from, y, 0)
  await mouse('mousePressed', from, y)
  const steps = 8
  for (let step = 1; step <= steps; step += 1) {
    await mouse('mouseMoved', from + ((to - from) * step) / steps, y)
  }
  await mouse('mouseReleased', to, y)
}

const tapAt = async (x: number, y: number) => {
  await mouse('mouseMoved', x, y, 0)
  await mouse('mousePressed', x, y)
  await mouse('mouseReleased', x, y)
}

const isInside = (container: Element, node: Element | null) =>
  node !== null && container.contains(node)

const visualViewportDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'visualViewport',
)

const installFakeVisualViewport = (height: number, width: number) => {
  const fake = Object.assign(new EventTarget(), {
    height,
    width,
    offsetTop: 0,
    offsetLeft: 0,
    pageTop: 0,
    pageLeft: 0,
    scale: 1,
  })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    get: () => fake,
  })
  return fake
}

const restoreVisualViewport = () => {
  if (visualViewportDescriptor) {
    Object.defineProperty(window, 'visualViewport', visualViewportDescriptor)
  } else {
    delete (window as { visualViewport?: unknown }).visualViewport
  }
}

const ensureViewportFitCover = () => {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'viewport'
    document.head.append(meta)
  }
  meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover'
}

let remountedUnmount: (() => void) | null = null

const reloadApp = () => {
  unmountApp()
  remountedUnmount?.()
  context.reset()
  resetUiState()
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  remountedUnmount = mount(root, <App />).unmount
}

afterEach(async () => {
  restoreVisualViewport()
  remountedUnmount?.()
  remountedUnmount = null
  unmountApp()
  resetUiState()
  history.replaceState(null, '', '/')
  await session()
    .send('Emulation.setSafeAreaInsetsOverride', { insets: {} })
    .catch(() => {})
  await page.viewport(desktop.width, desktop.height)
})

describe('F-23 phone layout at 390 px', () => {
  test('At 390 px, nothing scrolls horizontally except code blocks and tables. Hit targets are at least 44×44 px.', async () => {
    await bootApp({ key: seededKey, viewport: phone, seed: [seededChat] })
    await openSeededChat()
    await settle()

    const viewportWidth = document.documentElement.clientWidth
    expect(viewportWidth).toBe(phone.width)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(viewportWidth)
    expect(document.body.scrollWidth).toBeLessThanOrEqual(viewportWidth)

    const overflowing = [...shell().querySelectorAll<HTMLElement>('*')]
      .filter((element) => !element.closest('pre, table, dialog'))
      .filter((element) => {
        const tools = element.closest('[data-composer-tools]')
        return tools === null || tools === element
      })
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && (rect.right > viewportWidth + 0.5 || rect.left < -0.5)
      })
      .map((element) => element.outerHTML.slice(0, 120))
    expect(overflowing).toEqual([])

    const menuRect = menuButton().getBoundingClientRect()
    expect(menuRect.width).toBeGreaterThanOrEqual(44)
    expect(menuRect.height).toBeGreaterThanOrEqual(44)
    expect(menuButton().getAttribute('aria-label')).toBe('Open sidebar')
    const header = document.querySelector<HTMLElement>('[data-slot="ChatHeader"]')!
    const headerStyle = getComputedStyle(header)
    const trailingProbe = document.createElement('div')
    trailingProbe.style.cssText = 'position:absolute;width:var(--space-6);'
    document.body.append(trailingProbe)
    const trailingPadding = trailingProbe.getBoundingClientRect().width
    trailingProbe.remove()
    expect(Number.parseFloat(headerStyle.paddingInlineEnd)).toBeGreaterThanOrEqual(
      trailingPadding - 0.5,
    )
    expect(Number.parseFloat(headerStyle.paddingInlineStart)).toBeGreaterThan(
      Number.parseFloat(headerStyle.paddingInlineEnd),
    )
    const inlineSidebar = document.querySelector('[data-testid="sidebar-inline"]')
    expect(inlineSidebar?.getBoundingClientRect().width ?? 0).toBe(0)
    expect(inlineSidebar?.querySelector('[data-slot="Sidebar"]') ?? null).toBeNull()
  })

  test('The drawer traps focus while open. Esc closes it and focus returns to the menu button.', async () => {
    expect(location.pathname).toBe('/')
    await bootApp({ key: seededKey, viewport: phone, seed: [seededChat] })
    await openSeededChat()

    expect(drawer().open).toBe(false)
    await userEvent.click(menuButton())
    expect(drawer().open).toBe(true)
    expect(ui.drawer()).toBe(true)
    expect(openLayerCount()).toBe(1)
    expect(menuButton().getAttribute('aria-expanded')).toBe('true')
    expect(drawer().querySelector('[data-slot="Sidebar"]')).not.toBeNull()
    expect(isInside(drawer(), document.activeElement)).toBe(true)

    for (let press = 0; press < 8; press += 1) {
      await userEvent.tab()
      expect(isInside(drawer(), document.activeElement)).toBe(true)
    }
    for (let press = 0; press < 8; press += 1) {
      await userEvent.tab({ shift: true })
      expect(isInside(drawer(), document.activeElement)).toBe(true)
    }

    await settle()
    expectNoOverlay()
    const backdrop = getComputedStyle(drawer(), '::backdrop').backgroundColor
    const backdropAlpha = backdrop.match(
      /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/,
    )
    expect(backdropAlpha?.[1] === undefined ? 1 : Number(backdropAlpha[1])).toBe(1)
    const mainOverflow = getComputedStyle(document.querySelector('main')!).overflowX
    expect(mainOverflow === 'hidden' || mainOverflow === 'clip').toBe(true)
    await shot('F-23', 'drawer-open')

    await userEvent.keyboard('{Escape}')
    expect(drawer().open).toBe(false)
    expect(ui.drawer()).toBe(false)
    expect(openLayerCount()).toBe(0)
    expect(document.activeElement).toBe(menuButton())
    expect(menuButton().getAttribute('aria-expanded')).toBe('false')
    expect(activeChatId()).toBe(seededChat.id)

    menuButton().blur()
    await userEvent.hover(document.querySelector<HTMLElement>('[data-slot="Thread"]')!)
    await settle()
    expectNoOverlay()
    await shot('F-23', 'drawer-closed')
  })

  test('Picking a chat closes the drawer. Tapping the scrim or swiping closes it too, and it is never left half-open.', async () => {
    await bootApp({ key: seededKey, viewport: phone, seed: [seededChat] })
    homeRoute.go()
    await expect.poll(() => activeChatId()).toBe('new')

    await userEvent.click(menuButton())
    expect(drawer().open).toBe(true)
    openChat(seededChat.id)
    await expect.poll(() => drawer().open).toBe(false)
    expect(openLayerCount()).toBe(0)
    expect(document.activeElement).toBe(menuButton())

    await userEvent.click(menuButton())
    await settle()
    const panelRight = drawer().getBoundingClientRect().right
    expect(panelRight).toBeLessThan(phone.width - 44)
    await tapAt(phone.width - 12, 420)
    await expect.poll(() => drawer().open).toBe(false)
    expect(openLayerCount()).toBe(0)

    await userEvent.click(menuButton())
    await settle()
    await drag(240, 200, 520)
    await settle()
    expect(drawer().open).toBe(true)
    expect(getComputedStyle(drawer()).transform).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)
    expect(drawer().getBoundingClientRect().left).toBe(0)

    await drag(240, 60, 520)
    await expect.poll(() => drawer().open).toBe(false)
    expect(ui.drawer()).toBe(false)
    expect(openLayerCount()).toBe(0)
    expect(drawer().style.transform).toBe('')
    await settle()
    expect(getComputedStyle(drawer()).display).toBe('none')
  })

  test('Tapping the current chat, or activating it, closes the drawer.', async () => {
    await bootApp({ key: seededKey, viewport: phone, seed: [seededChat] })
    await openSeededChat()
    const drawerBody = () => drawer().querySelector('[data-drawer-body]')!

    await userEvent.click(menuButton())
    expect(drawer().open).toBe(true)
    const currentChat = document.createElement('button')
    currentChat.type = 'button'
    currentChat.setAttribute('aria-current', 'page')
    currentChat.textContent = seededChat.title
    drawerBody().append(currentChat)
    await userEvent.click(currentChat)
    expect(drawer().open).toBe(false)
    expect(ui.drawer()).toBe(false)
    expect(openLayerCount()).toBe(0)

    await userEvent.click(menuButton())
    expect(drawer().open).toBe(true)
    const currentChatKey = document.createElement('div')
    currentChatKey.tabIndex = 0
    currentChatKey.setAttribute('role', 'link')
    currentChatKey.setAttribute('aria-current', 'page')
    currentChatKey.textContent = seededChat.title
    drawerBody().append(currentChatKey)
    currentChatKey.focus()
    await userEvent.keyboard('{Enter}')
    expect(drawer().open).toBe(false)
    expect(ui.drawer()).toBe(false)
    expect(openLayerCount()).toBe(0)
  })

  test('At 390×844 with a mocked visual-viewport shrink of 300 px, the composer stays inside the visual viewport and clears env(safe-area-inset-bottom).', async () => {
    ensureViewportFitCover()
    await session().send('Emulation.setSafeAreaInsetsOverride', {
      insets: { bottom: safeAreaBottom },
    })
    const viewport = installFakeVisualViewport(phone.height, phone.width)
    await bootApp({ key: seededKey, viewport: phone, seed: [seededChat] })
    await openSeededChat()

    const textarea = composer().querySelector('textarea')!
    textarea.focus()
    viewport.height = phone.height - keyboardHeight
    viewport.dispatchEvent(new Event('resize'))
    await settle()

    const visibleBottom = viewport.offsetTop + viewport.height
    const composerRect = composer().getBoundingClientRect()
    expect(composerRect.top).toBeGreaterThanOrEqual(0)
    expect(composerRect.bottom).toBeLessThanOrEqual(visibleBottom + 0.5)
    expect(composerRect.bottom).toBeGreaterThan(visibleBottom - 4)
    const textareaRect = textarea.getBoundingClientRect()
    expect(textareaRect.bottom).toBeLessThanOrEqual(visibleBottom)

    const probe = document.createElement('div')
    probe.style.cssText = 'position: fixed; height: env(safe-area-inset-bottom, 0px);'
    document.body.append(probe)
    const safeInset = probe.getBoundingClientRect().height
    probe.remove()
    expect(safeInset).toBe(safeAreaBottom)
    const composerPadding = Number.parseFloat(getComputedStyle(composer()).paddingBottom)
    expect(composerPadding).toBeGreaterThanOrEqual(safeInset)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(phone.width)

    const thread = document.querySelector<HTMLElement>('[data-slot="Thread"]')!
    const composerTop = composer().getBoundingClientRect().top
    const lastMessage = thread.querySelector('ol > li:last-child')!
    expect(lastMessage.getBoundingClientRect().bottom).toBeLessThanOrEqual(composerTop + 1)
    const fence = [...thread.querySelectorAll('*')].find(
      (element) =>
        element.textContent?.includes('const itinerary') &&
        ![...element.children].some((child) => child.textContent?.includes('const itinerary')),
    )
    expect(fence).toBeInstanceOf(HTMLElement)
    const fenceRect = fence!.getBoundingClientRect()
    expect(fenceRect.top < composerTop && fenceRect.bottom > composerTop + 1).toBe(false)
    expect(Number.parseFloat(getComputedStyle(thread).paddingBottom)).toBe(0)

    expectNoOverlay()
    await shot('F-23', 'keyboard-open')

    viewport.height = phone.height
    viewport.dispatchEvent(new Event('resize'))
    await settle()
    expect(composer().getBoundingClientRect().bottom).toBeGreaterThan(phone.height - 4)
  })
})

describe('F-23 desktop sidebar', () => {
  test('On desktop the sidebar is inline and collapses with Cmd/Ctrl+Shift+S. The desktop collapsed state persists across reload.', async () => {
    await bootApp({ key: seededKey, viewport: desktop, seed: [seededChat] })
    await openSeededChat()

    const inline = () =>
      document.querySelector<HTMLElement>('[data-testid="sidebar-inline"]')!
    expect(inline().querySelector('[data-slot="Sidebar"]')).not.toBeNull()
    expect(inline().getBoundingClientRect().width).toBeGreaterThan(240)
    expect(menuButton().getBoundingClientRect().width).toBe(0)
    expect(shell().dataset.sidebar).toBe('expanded')

    await userEvent.keyboard('{Control>}{Shift>}S{/Shift}{/Control}')
    expect(sidebarCollapsed()).toBe(true)
    expect(shell().dataset.sidebar).toBe('collapsed')
    expect(inline().inert).toBe(true)
    const stored = JSON.parse(localStorage.getItem('atelier.sidebarCollapsed') ?? 'null')
    expect(stored?.data).toBe(true)

    await settle()
    const rail = document.querySelector<HTMLElement>('[data-testid="sidebar-rail"]')!
    expect(rail.getBoundingClientRect().width).toBeLessThanOrEqual(64)
    const railButtons = [...rail.querySelectorAll('button')]
    expect(railButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Show sidebar',
      'New chat',
      'Search chats',
    ])
    for (const button of railButtons) {
      const rect = button.getBoundingClientRect()
      expect(rect.width).toBeGreaterThanOrEqual(44)
      expect(rect.height).toBeGreaterThanOrEqual(44)
    }
    expect(document.querySelector('main')!.getBoundingClientRect().left).toBeLessThanOrEqual(64)
    expectNoOverlay()
    await shot('F-23', 'sidebar-collapsed')

    reloadApp()
    await paint()
    expect(shell().dataset.sidebar).toBe('collapsed')
    expect(inline().inert).toBe(true)

    const showSidebar = document.querySelector<HTMLButtonElement>(
      '[data-testid="sidebar-rail"] button[aria-label="Show sidebar"]',
    )!
    await userEvent.click(showSidebar)
    expect(shell().dataset.sidebar).toBe('expanded')
    expect(inline().inert).toBe(false)
    expect(JSON.parse(localStorage.getItem('atelier.sidebarCollapsed') ?? 'null')?.data).toBe(false)
  })
})
