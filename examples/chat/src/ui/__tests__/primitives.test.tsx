import { atom } from '@reatom/core'
import { mount, type JSX } from '@reatom/jsx'
import { cdp, page, userEvent } from 'vitest/browser'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { globalStyles } from '../../styles/tokens'
import {
  announce,
  AutoGrowTextarea,
  Button,
  contrastRatio,
  Dialog,
  IconButton,
  InfoButton,
  LiveRegion,
  Menu,
  openLayerCount,
  parseColor,
  resetUiState,
  resolvedBackground,
  Spinner,
  Tabs,
  toast,
  Toaster,
  type ButtonVariant,
} from '../index'
import { shot } from '../../testing/screenshot'
import { PrimitivesGallery } from './PrimitivesGallery'

type CdpSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>
}

const session = () => cdp() as CdpSession

const paint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const emulateMedia = (features: Array<{ name: string; value: string }>) =>
  session().send('Emulation.setEmulatedMedia', { features })

const setTheme = (theme: 'light' | 'dark' | null) => {
  if (theme) document.documentElement.setAttribute('data-theme', theme)
  else document.documentElement.removeAttribute('data-theme')
}

let unmountCurrent: (() => void) | null = null

const render = (element: () => JSX.Element) => {
  unmountCurrent?.()
  document.body.replaceChildren()
  const styles = document.createElement('style')
  styles.textContent = globalStyles
  document.head
    .querySelectorAll('style[data-test-global]')
    .forEach((node) => node.remove())
  styles.setAttribute('data-test-global', '')
  document.head.appendChild(styles)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.appendChild(root)
  const { unmount } = mount(root, element())
  unmountCurrent = unmount
  return root
}

beforeEach(async () => {
  resetUiState()
  setTheme('light')
  await emulateMedia([
    { name: 'prefers-color-scheme', value: 'light' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ])
  await page.viewport(1280, 800)
})

afterEach(() => {
  unmountCurrent?.()
  unmountCurrent = null
})

describe('Dialog', () => {
  test('restores focus to the opener after closing', async () => {
    const open = atom(false, 'test.dialog.open')
    render(() => (
      <div>
        <Button data-testid="opener" on:click={() => open.set(true)}>
          Open settings
        </Button>
        <Dialog open={open} title="Settings">
          <p>Body</p>
          <Button>Inside</Button>
        </Dialog>
      </div>
    ))
    const opener = document.querySelector<HTMLButtonElement>(
      '[data-testid="opener"]',
    )!
    await userEvent.click(opener)
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(openLayerCount()).toBe(1)

    await userEvent.keyboard('{Escape}')
    expect(dialog.open).toBe(false)
    expect(open()).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(openLayerCount()).toBe(0)

    await userEvent.click(opener)
    const closeButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    )!
    await userEvent.click(closeButton)
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  test('a dismissible Dialog closes on a click outside', async () => {
    const open = atom(true, 'test.dialog.dismissible')
    render(() => (
      <Dialog open={open} title="Search chats">
        <p>Body</p>
      </Dialog>
    ))
    await paint()
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    dialog.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 }),
    )
    dialog.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 2 }),
    )
    expect(open()).toBe(false)
    await paint()
    expect(dialog.open).toBe(false)
  })

  test('a non-dismissible Dialog ignores Esc and clicks outside', async () => {
    const open = atom(true, 'test.dialog.blocking')
    render(() => (
      <Dialog open={open} title="Unlimited key" dismissible={false}>
        <Button on:click={() => open.set(false)}>I understand</Button>
      </Dialog>
    ))
    await paint()
    const dialog = document.querySelector('dialog')!
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('button[aria-label="Close"]')).toBeNull()

    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')
    await paint()
    expect(dialog.open).toBe(true)
    expect(open()).toBe(true)

    dialog.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 }),
    )
    dialog.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 2 }),
    )
    await paint()
    expect(dialog.open).toBe(true)

    await userEvent.click(dialog.querySelector('button')!)
    expect(dialog.open).toBe(false)
  })
  test('the topmost layer consumes Esc: a boot capture listener sees an open layer and must bail', async () => {
    const open = atom(false, 'test.dialog.escLayer')
    const layerCountsSeenAtBoot: number[] = []
    let escReachedWindowBubble = 0
    const bootCaptureListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') layerCountsSeenAtBoot.push(openLayerCount())
    }
    const windowBubbleListener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escReachedWindowBubble++
    }
    window.addEventListener('keydown', bootCaptureListener, true)
    window.addEventListener('keydown', windowBubbleListener)
    try {
      render(() => (
        <Dialog open={open} title="Settings">
          <Button>Inside</Button>
        </Dialog>
      ))
      open.set(true)
      await paint()
      const dialog = document.querySelector('dialog')!
      expect(dialog.open).toBe(true)
      await userEvent.keyboard('{Escape}')
      await paint()
      expect(layerCountsSeenAtBoot).toEqual([1])
      expect(escReachedWindowBubble).toBe(0)
      expect(dialog.open).toBe(false)
      expect(openLayerCount()).toBe(0)
    } finally {
      window.removeEventListener('keydown', bootCaptureListener, true)
      window.removeEventListener('keydown', windowBubbleListener)
    }
  })

  test('keeps the browser focus outline when the dialog element itself is focused', async () => {
    const open = atom(true, 'test.dialog.outline')
    render(() => (
      <Dialog open={open} title="Notice">
        <p>No focusable content</p>
      </Dialog>
    ))
    await paint()
    const dialog = document.querySelector('dialog')!
    dialog.focus()
    await userEvent.keyboard('{Shift}')
    await paint()
    expect(getComputedStyle(dialog).outlineStyle).not.toBe('none')
  })
})

describe('Menu', () => {
  test('opens from its button, moves with arrow keys, and Esc returns focus', async () => {
    const picked: string[] = []
    render(() => (
      <Menu
        label="Chat actions"
        items={[
          { label: 'Rename', icon: 'edit', onSelect: () => picked.push('rename') },
          { label: 'Export', icon: 'download', onSelect: () => picked.push('export') },
          { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => picked.push('delete') },
        ]}
      />
    ))
    await paint()
    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    )!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const items = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ]
    expect(items.map((item) => item.textContent)).toEqual([
      'Rename',
      'Export',
      'Delete',
    ])
    expect(document.activeElement).toBe(items[0])
    expect(openLayerCount()).toBe(1)

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(document.activeElement).toBe(items[2])

    await userEvent.keyboard('{Escape}')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
    expect(openLayerCount()).toBe(0)

    await userEvent.click(trigger)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(picked).toEqual(['export'])
    expect(document.activeElement).toBe(trigger)
  })

  test('disabled items use aria-disabled, stay in arrow order, and first letters jump', async () => {
    const picked: string[] = []
    render(() => (
      <Menu
        label="Chat actions"
        items={[
          { label: 'Rename', onSelect: () => picked.push('rename') },
          { label: 'Fork from here', disabled: true, onSelect: () => picked.push('fork') },
          { label: 'Delete', tone: 'danger', onSelect: () => picked.push('delete') },
          { label: 'Duplicate', onSelect: () => picked.push('duplicate') },
        ]}
      />
    ))
    await paint()
    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    const fork = items[1]!
    expect(fork.getAttribute('aria-disabled')).toBe('true')
    expect(fork.hasAttribute('disabled')).toBe(false)

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(fork)
    await userEvent.keyboard('{Enter}')
    await paint()
    expect(picked).toEqual([])
    expect(openLayerCount()).toBe(1)

    await userEvent.keyboard('d')
    expect(document.activeElement).toBe(items[2])
    await userEvent.keyboard('d')
    expect(document.activeElement).toBe(items[3])
    await userEvent.keyboard('r')
    expect(document.activeElement).toBe(items[0])
    await userEvent.keyboard('F')
    expect(document.activeElement).toBe(fork)
  })

  test('the popover flips and shifts to stay inside the viewport', async () => {
    render(() => (
      <div css="position: fixed; right: 0; bottom: 0;">
        <Menu
          label="Corner actions"
          placement="bottom-start"
          items={[
            { label: 'Rename', onSelect: () => {} },
            { label: 'Export as Markdown', onSelect: () => {} },
            { label: 'Delete', onSelect: () => {} },
          ]}
        />
      </div>
    ))
    await paint()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!
    await userEvent.click(trigger)
    await paint()
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!
    const panelRect = panel.getBoundingClientRect()
    const triggerRect = trigger.getBoundingClientRect()
    expect(panelRect.left).toBeGreaterThanOrEqual(0)
    expect(panelRect.top).toBeGreaterThanOrEqual(0)
    expect(panelRect.right).toBeLessThanOrEqual(window.innerWidth)
    expect(panelRect.bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(panelRect.bottom).toBeLessThanOrEqual(triggerRect.top)
  })
})

describe('InfoButton', () => {
  test('moves focus into the explanation when opened and returns it on Esc', async () => {
    render(() => (
      <InfoButton label="About BYOK" title="Bring your own key">
        Requests use your provider key.
      </InfoButton>
    ))
    await paint()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="About BYOK"]')!
    await userEvent.click(trigger)
    await paint()
    const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(document.activeElement).toBe(panel)
    await userEvent.keyboard('{Escape}')
    await paint()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
  })
})

describe('Tabs', () => {
  test('vertical tabs laid out as a row below 560 px move with Left and Right', async () => {
    await page.viewport(480, 800)
    const selected = atom<'general' | 'models' | 'data'>('general', 'test.tabs.selected')
    render(() => (
      <Tabs
        label="Settings sections"
        orientation="vertical"
        selected={selected}
        items={[
          { id: 'general', label: 'General' },
          { id: 'models', label: 'Models' },
          { id: 'data', label: 'Data' },
        ]}
      />
    ))
    await paint()
    const tablist = document.querySelector<HTMLElement>('[role="tablist"]')!
    expect(tablist.getAttribute('aria-orientation')).toBe('horizontal')
    document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(selected()).toBe('models')
    await userEvent.keyboard('{ArrowLeft}')
    expect(selected()).toBe('general')

    await page.viewport(1280, 800)
    await paint()
    expect(tablist.getAttribute('aria-orientation')).toBe('vertical')
    document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(selected()).toBe('models')
  })
})

describe('IconButton', () => {
  test('rejects an empty accessible label', () => {
    expect(() => IconButton({ icon: 'copy', label: '' as never })).toThrow(/label/i)
    expect(() => IconButton({ icon: 'copy', label: '   ' })).toThrow(/label/i)
    const typeLevelCheck = () => (
      // @ts-expect-error an icon-only button needs a non-empty label
      <IconButton icon="copy" label="" />
    )
    expect(typeof typeLevelCheck).toBe('function')
  })
})

describe('UI state reset', () => {
  test('resetUiState closes popovers, clears toasts and timers, and zeroes layers', async () => {
    render(() => (
      <div>
        <Toaster />
        <Menu label="Chat actions" items={[{ label: 'Rename', onSelect: () => {} }]} />
      </div>
    ))
    await paint()
    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!)
    toast.show({ key: 'pending', text: 'Pending', durationMs: 60 })
    expect(openLayerCount()).toBe(1)
    expect(toast.keys()).toEqual(['pending'])

    resetUiState()
    await paint()
    expect(openLayerCount()).toBe(0)
    expect(toast.keys()).toEqual([])
    expect(document.querySelector('[role="menu"]:popover-open')).toBeNull()

    toast.show({ key: 'after-reset', text: 'Still here', durationMs: null })
    await sleep(100)
    expect(toast.keys()).toEqual(['after-reset'])
  })

  test('unmounting the Toaster cancels pending dismiss timers', async () => {
    render(() => <Toaster />)
    toast.show({ key: 'orphan', text: 'Orphan', durationMs: 60 })
    unmountCurrent?.()
    unmountCurrent = null
    await paint()
    expect(toast.keys()).toEqual([])
  })
})

describe('Toaster', () => {
  test('merges toasts by key', async () => {
    render(() => <Toaster />)
    toast.show({ key: 'chat-deleted', text: 'Chat deleted' })
    await paint()
    const toasts = () => [
      ...document.querySelectorAll<HTMLElement>('[data-toast-key]'),
    ]
    expect(toasts()).toHaveLength(1)
    const first = toasts()[0]

    let undone = 0
    toast.show({
      key: 'chat-deleted',
      text: '2 chats deleted',
      action: { label: 'Undo', onClick: () => undone++ },
    })
    await paint()
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0]).toBe(first)
    expect(first.textContent).toContain('2 chats deleted')

    toast.show({ key: 'copied', text: 'Copied' })
    await paint()
    expect(toasts()).toHaveLength(2)

    await userEvent.click(first.querySelector('button')!)
    expect(undone).toBe(1)
    await paint()
    expect(toasts().map((node) => node.dataset.toastKey)).toEqual(['copied'])
  })

  test('auto-dismisses after durationMs, and a merge restarts the timer', async () => {
    render(() => <Toaster />)
    toast.show({ key: 'saved', text: 'Saved', durationMs: 150 })
    await sleep(100)
    toast.show({ key: 'saved', text: 'Saved again', durationMs: 150 })
    await sleep(100)
    expect(document.querySelectorAll('[data-toast-key="saved"]')).toHaveLength(1)
    await sleep(120)
    expect(document.querySelectorAll('[data-toast-key="saved"]')).toHaveLength(0)
  })
})

describe('LiveRegion', () => {
  test('One `aria-live="polite"` region receives only status text', async () => {
    render(() => <PrimitivesGallery />)
    toast.show({ key: 'copied', text: 'Copied', durationMs: null })
    await paint()
    const liveElements = document.querySelectorAll(
      '[aria-live], [role="status"], [role="alert"], [role="log"], [role="marquee"], [role="timer"], output',
    )
    expect(liveElements).toHaveLength(1)
    const region = liveElements[0] as HTMLElement
    expect(region.getAttribute('aria-live')).toBe('polite')

    announce('Generating reply')
    await paint()
    expect(region.textContent).toBe('Generating reply')
    announce('Reply complete')
    await paint()
    expect(region.textContent).toBe('Reply complete')
  })

  test('re-announcing the same text replaces the node so it is read again', async () => {
    render(() => <LiveRegion />)
    announce('Stopped')
    await paint()
    const region = document.querySelector('[aria-live]')!
    const firstNode = region.firstElementChild
    announce('Stopped')
    await paint()
    expect(region.textContent).toBe('Stopped')
    expect(region.firstElementChild).not.toBe(firstNode)
  })
})

describe('AutoGrowTextarea', () => {
  test('grows with content up to 40% of the viewport height, then scrolls', async () => {
    const draft = atom('', 'test.textarea.draft')
    render(() => <AutoGrowTextarea label="Message" value={draft} />)
    await paint()
    const textarea = document.querySelector('textarea')!
    expect(textarea.getAttribute('aria-label')).toBe('Message')
    expect(textarea.getAttribute('dir')).toBe('auto')
    const singleLineHeight = textarea.getBoundingClientRect().height

    draft.set('one\ntwo\nthree')
    await paint()
    await paint()
    expect(textarea.getBoundingClientRect().height).toBeGreaterThan(singleLineHeight)

    draft.set(Array.from({ length: 80 }, (_, index) => `line ${index}`).join('\n'))
    await paint()
    await paint()
    const capHeight = Math.floor(window.innerHeight * 0.4)
    expect(textarea.getBoundingClientRect().height).toBeLessThanOrEqual(capHeight + 1)
    expect(textarea.getBoundingClientRect().height).toBeGreaterThan(capHeight - 2)
    expect(getComputedStyle(textarea).overflowY).toBe('auto')
  })
})

const isVisuallyHidden = (element: Element) => {
  const rect = element.getBoundingClientRect()
  return rect.width <= 1 && rect.height <= 1
}

describe('Hit targets', () => {
  test('Hit targets are at least 44×44 px. Glyphs may be smaller.', async () => {
    render(() => <PrimitivesGallery />)
    await paint()
    const menuTrigger = document.querySelector<HTMLButtonElement>(
      '[data-gallery="menu"] button[aria-haspopup="menu"]',
    )!
    await userEvent.click(menuTrigger)
    await paint()
    const targets = [
      ...document.querySelectorAll<HTMLElement>(
        'button, [role="tab"], [role="menuitem"], label:has(input[type="checkbox"]), a[href]',
      ),
    ].filter((element) => !isVisuallyHidden(element))
    expect(targets.length).toBeGreaterThan(40)
    const tooSmall = targets
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          name:
            element.getAttribute('aria-label') ??
            element.textContent?.trim().slice(0, 30),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      })
      .filter((target) => target.width < 44 || target.height < 44)
    expect(tooSmall).toEqual([])
  })
})

const colorOf = (element: Element, property: 'color' | 'backgroundColor' | 'outlineColor') =>
  getComputedStyle(element)[property]

const appBackground = () => colorOf(document.body, 'backgroundColor')

const measureTheme = async () => {
  const primary = document.querySelector<HTMLButtonElement>(
    '[data-gallery="buttons"] button[data-variant="primary"]:not([disabled])',
  )!
  const muted = document.querySelector<HTMLElement>('[data-gallery="muted-text"]')!
  primary.focus()
  await userEvent.keyboard('{Shift}')
  await paint()
  const focusStyle = getComputedStyle(primary)
  const result = {
    bodyText: contrastRatio(colorOf(document.body, 'color'), appBackground()),
    mutedText: contrastRatio(colorOf(muted, 'color'), appBackground()),
    primaryLabel: contrastRatio(
      colorOf(primary, 'color'),
      colorOf(primary, 'backgroundColor'),
    ),
    focusOutlineWidth: focusStyle.outlineWidth,
    focusOutlineStyle: focusStyle.outlineStyle,
    focusRing: contrastRatio(focusStyle.outlineColor, appBackground()),
    banners: [
      ...document.querySelectorAll<HTMLElement>('[data-gallery="banners"] [data-tone]'),
    ].map((banner) => ({
      tone: banner.dataset.tone,
      ratio: contrastRatio(
        colorOf(banner.querySelector('[data-banner-title]')!, 'color'),
        colorOf(banner, 'backgroundColor'),
      ),
    })),
  }
  primary.blur()
  return result
}

const expectAccessible = (measured: Awaited<ReturnType<typeof measureTheme>>) => {
  expect(measured.bodyText).toBeGreaterThanOrEqual(4.5)
  expect(measured.mutedText).toBeGreaterThanOrEqual(4.5)
  expect(measured.primaryLabel).toBeGreaterThanOrEqual(4.5)
  expect(measured.focusOutlineWidth).toBe('2px')
  expect(measured.focusOutlineStyle).toBe('solid')
  expect(measured.focusRing).toBeGreaterThanOrEqual(3)
  expect(measured.banners.length).toBeGreaterThanOrEqual(4)
  for (const banner of measured.banners) {
    expect(banner.ratio, `${banner.tone} banner`).toBeGreaterThanOrEqual(4.5)
  }
}

describe('Theme contrast', () => {
  test('In both light and dark, body text on the app background and the primary button label on its fill contrast at 4.5:1 or more (computed style).', async () => {
    render(() => <PrimitivesGallery />)

    setTheme('light')
    await paint()
    const light = await measureTheme()
    expectAccessible(light)

    const lightBackground = appBackground()

    setTheme('dark')
    await paint()
    const dark = await measureTheme()
    expectAccessible(dark)
    expect(appBackground()).not.toBe(lightBackground)
  })

  test('The focused element shows a 2 px outline that contrasts at 3:1 or more with the adjacent background.', async () => {
    render(() => <PrimitivesGallery />)
    for (const theme of ['light', 'dark'] as const) {
      setTheme(theme)
      await paint()
      const textField = document.querySelector<HTMLInputElement>(
        '[data-gallery="fields"] input:not([disabled])',
      )!
      textField.focus()
      await paint()
      const frame = textField.closest<HTMLElement>('[data-field-box]')!
      const frameStyle = getComputedStyle(frame)
      expect(frameStyle.outlineWidth).toBe('2px')
      expect(
        contrastRatio(frameStyle.outlineColor, appBackground()),
      ).toBeGreaterThanOrEqual(3)
      textField.blur()
    }
  })

  test('System theme follows prefers-color-scheme without the attribute', async () => {
    render(() => <PrimitivesGallery />)
    setTheme(null)
    await emulateMedia([{ name: 'prefers-color-scheme', value: 'light' }])
    await paint()
    const systemLight = appBackground()
    await emulateMedia([{ name: 'prefers-color-scheme', value: 'dark' }])
    await paint()
    const systemDark = appBackground()
    expect(systemDark).not.toBe(systemLight)
    setTheme('dark')
    await paint()
    expect(appBackground()).toBe(systemDark)
    expectAccessible(await measureTheme())

    setTheme('light')
    await paint()
    expect(appBackground()).toBe(systemLight)
  })
})

describe('Reduced motion', () => {
  test('With `prefers-reduced-motion: reduce`, there are no pulsing, sliding, or smooth-scroll animations: computed `animation-name` is `none`, and the scroll behavior is `auto`.', async () => {
    render(() => (
      <div>
        <Spinner label="Loading models" />
      </div>
    ))
    const spinnerArc = () =>
      document.querySelector('[data-spinner] svg')!
    expect(getComputedStyle(spinnerArc()).animationName).not.toBe('none')

    await emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await paint()
    expect(getComputedStyle(spinnerArc()).animationName).toBe('none')
    expect(getComputedStyle(document.documentElement).scrollBehavior).toBe('auto')

    render(() => <PrimitivesGallery />)
    await paint()
    const animated = [...document.querySelectorAll('*')].filter((element) => {
      const style = getComputedStyle(element)
      return style.animationName !== 'none' || style.scrollBehavior !== 'auto'
    })
    expect(animated).toEqual([])
  })
})

async function forcePseudoStates(attribute = 'data-gallery-force') {
  const cdpSession = session()
  await cdpSession.send('DOM.enable')
  await cdpSession.send('CSS.enable')
  const { root } = await cdpSession.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  })
  const forced: Array<{ nodeId: number; state: string }> = []
  const visit = (node: any, parent: any) => {
    const attributes: string[] = node.attributes ?? []
    const ownIndex = attributes.indexOf(attribute)
    if (ownIndex !== -1) {
      forced.push({ nodeId: node.nodeId, state: attributes[ownIndex + 1]! })
    }
    const parentIndex = attributes.indexOf(`${attribute}-parent`)
    if (parentIndex !== -1 && parent) {
      forced.push({ nodeId: parent.nodeId, state: attributes[parentIndex + 1]! })
    }
    for (const child of node.children ?? []) visit(child, node)
    if (node.contentDocument) visit(node.contentDocument, node)
    for (const shadow of node.shadowRoots ?? []) visit(shadow, node)
  }
  visit(root, null)
  for (const { nodeId, state } of forced) {
    if (!state) continue
    await cdpSession.send('CSS.forcePseudoState', {
      nodeId,
      forcedPseudoClasses: state.split(' '),
    })
  }
  return forced.length
}

describe('Contrast math', () => {
  test('parses percent rgb() channels', () => {
    expect(parseColor('rgb(100%, 50%, 0%)')).toEqual({ r: 255, g: 127.5, b: 0, a: 1 })
    expect(parseColor('rgb(100% 0% 0% / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(contrastRatio('rgb(0%, 0%, 0%)', 'rgb(100%, 100%, 100%)')).toBeCloseTo(21, 5)
  })
})

type ProbeState = 'rest' | 'hover' | 'active' | 'focus' | 'disabled'

const probeStates: ProbeState[] = ['rest', 'hover', 'active', 'focus', 'disabled']

const probeForce: Record<ProbeState, string | null> = {
  rest: null,
  hover: 'hover',
  active: 'hover active',
  focus: 'focus focus-visible',
  disabled: null,
}

const probeVariants: Array<{ kind: 'button' | 'icon'; variant: ButtonVariant }> = [
  { kind: 'button', variant: 'primary' },
  { kind: 'button', variant: 'soft' },
  { kind: 'button', variant: 'danger' },
  { kind: 'button', variant: 'secondary' },
  { kind: 'button', variant: 'ghost' },
  { kind: 'icon', variant: 'primary' },
  { kind: 'icon', variant: 'soft' },
  { kind: 'icon', variant: 'danger' },
]

const StateProbes = () => (
  <div css="display: flex; flex-wrap: wrap; gap: 12px; padding: 24px; background: var(--bg);">
    {probeVariants.flatMap(({ kind, variant }) =>
      probeStates.map((state) => {
        const probeName = `${kind}-${variant}-${state}`
        return kind === 'button' ? (
          <Button
            variant={variant}
            disabled={state === 'disabled'}
            data-probe={probeName}
            data-probe-force={probeForce[state]}
          >
            Label
          </Button>
        ) : (
          <IconButton
            icon="send"
            label="Send"
            variant={variant}
            disabled={state === 'disabled'}
            data-probe={probeName}
            data-probe-force={probeForce[state]}
          />
        )
      }),
    )}
  </div>
)

describe('State contrast', () => {
  test('label ink keeps 4.5:1 on hover, pressed and focus (3:1 when disabled) for filled and soft variants in both themes', async () => {
    await emulateMedia([
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ])
    render(() => <StateProbes />)
    await paint()
    expect(await forcePseudoStates('data-probe-force')).toBeGreaterThan(20)
    for (const theme of ['light', 'dark'] as const) {
      setTheme(theme)
      await paint()
      const failures = [...document.querySelectorAll<HTMLElement>('[data-probe]')]
        .map((probe) => {
          const state = probe.dataset.probe!.split('-').pop() as ProbeState
          const ratio = contrastRatio(colorOf(probe, 'color'), resolvedBackground(probe))
          const required = state === 'disabled' ? 3 : 4.5
          return { probe: `${theme}:${probe.dataset.probe}`, ratio: Number(ratio.toFixed(2)), required }
        })
        .filter(({ ratio, required }) => ratio < required)
      expect(failures).toEqual([])

      const restInk = (kind: string, variant: string) =>
        colorOf(document.querySelector(`[data-probe="${kind}-${variant}-rest"]`)!, 'color')
      for (const { kind, variant } of probeVariants) {
        if (variant !== 'primary' && variant !== 'danger' && variant !== 'soft') continue
        for (const state of ['hover', 'active'] as const) {
          const probe = document.querySelector(`[data-probe="${kind}-${variant}-${state}"]`)!
          expect(colorOf(probe, 'color'), `${theme} ${kind} ${variant} ${state} ink`).toBe(
            restInk(kind, variant),
          )
          expect(
            colorOf(probe, 'backgroundColor'),
            `${theme} ${kind} ${variant} ${state} fill`,
          ).not.toBe(
            colorOf(document.querySelector(`[data-probe="${kind}-${variant}-rest"]`)!, 'backgroundColor'),
          )
        }
      }
    }
  })
})

describe('Primitives gallery', () => {
  test('renders every primitive in every state in both themes', async () => {
    render(() => <PrimitivesGallery />)
    toast.show({
      key: 'gallery-deleted',
      text: '3 chats deleted',
      action: { label: 'Undo', onClick: () => {} },
      durationMs: null,
    })
    toast.show({
      key: 'gallery-copied',
      text: 'Copied to clipboard',
      tone: 'success',
      durationMs: null,
    })
    announce('Reply complete')
    await paint()
    const gallery = document.querySelector<HTMLElement>('[data-gallery-root]')!
    const galleryWidth = 1440
    await page.viewport(galleryWidth, 900)
    await paint()
    let fullHeight = 0
    for (let attempt = 0; attempt < 5; attempt++) {
      const measuredHeight = Math.ceil(
        Math.max(gallery.scrollHeight, document.documentElement.scrollHeight),
      )
      if (measuredHeight === fullHeight) break
      fullHeight = measuredHeight
      await session().send('Emulation.setDeviceMetricsOverride', {
        width: galleryWidth + 200,
        height: fullHeight + 200,
        deviceScaleFactor: 1,
        mobile: false,
      })
      await page.viewport(galleryWidth, fullHeight)
      await paint()
    }
    expect(gallery.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(window.innerHeight - 1)
    expect(await forcePseudoStates()).toBeGreaterThan(8)
    await userEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-gallery="menu"] button[aria-haspopup="menu"]',
      )!,
    )
    await paint()
    await sleep(400)

    setTheme('light')
    await paint()
    await sleep(100)
    expect(String(await shot('T-004', 'primitives-light'))).toContain(
      'T-004/primitives-light.png',
    )
    setTheme('dark')
    await paint()
    await sleep(100)
    expect(String(await shot('T-004', 'primitives-dark'))).toContain(
      'T-004/primitives-dark.png',
    )
    await session().send('Emulation.clearDeviceMetricsOverride')
  })
})
