import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cdp, page } from 'vitest/browser'

import indexHtml from '../../../../index.html?raw'
import { App } from '../../../App'
import { ui } from '../../../app/ui'
import { themePref } from '../../../storage/prefs'
import { bootApp, unmountApp } from '../../../testing/boot'
import { shot } from '../../../testing/screenshot'
import { Button, contrastRatio, resetUiState, resolvedBackground } from '../../../ui'

type CdpSession = {
  send: (method: string, params?: Record<string, unknown>) => Promise<any>
}

type Scheme = 'light' | 'dark'

const seededKey = 'sk-or-v1-theme-test-key'
const themeStorageKey = 'atelier.theme'
const darkBackground = 'rgb(20, 20, 19)'
const lightBackground = 'rgb(246, 245, 242)'

const emulateScheme = (scheme: Scheme) =>
  (cdp() as CdpSession).send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  })

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const paint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

const expectNoOverlay = () => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
}

const root = document.documentElement

const themeOption = (label: string) =>
  [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="theme"]')].find(
    (input) => input.labels?.[0]?.textContent?.includes(label),
  )!

const openAppearance = async () => {
  ui.appSettings.set('appearance')
  await expect.poll(() => document.querySelector('input[name="theme"]')).not.toBeNull()
  await paint()
}

let remountedUnmount: (() => void) | null = null

const reloadApp = () => {
  unmountApp()
  remountedUnmount?.()
  context.reset()
  resetUiState()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-theme-pref')
  document.body.replaceChildren()
  const appRoot = document.createElement('div')
  appRoot.id = 'app'
  document.body.append(appRoot)
  remountedUnmount = mount(appRoot, <App />).unmount
}

const inlineHeadScripts = (html: string) => {
  const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'))
  return [...head.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1]!,
  )
}

const firstPaintProbe = async () => {
  const withoutAppBundle = indexHtml.replace(/<script type="module"[^>]*><\/script>/, '')
  const probe = `<script>window.parent.postMessage({ theme: document.documentElement.getAttribute('data-theme'), background: getComputedStyle(document.documentElement).backgroundColor }, '*')</script>`
  const srcdoc = withoutAppBundle.replace('<body>', `<body>${probe}`)
  const frame = document.createElement('iframe')
  const reported = new Promise<{ theme: string | null; background: string }>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      window.removeEventListener('message', onMessage)
      resolve(event.data)
    }
    window.addEventListener('message', onMessage)
  })
  frame.srcdoc = srcdoc
  document.body.append(frame)
  const result = await reported
  frame.remove()
  return result
}

beforeEach(async () => {
  await emulateScheme('light')
  root.removeAttribute('data-theme')
  root.removeAttribute('data-theme-pref')
})

afterEach(async () => {
  remountedUnmount?.()
  remountedUnmount = null
  unmountApp()
  resetUiState()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-theme-pref')
  await emulateScheme('light')
  await page.viewport(1280, 800)
})

describe('F-23b theme', () => {
  test('An inline script in index.html sets the attribute before first paint, so a saved dark theme never paints light first.', async () => {
    const scripts = inlineHeadScripts(indexHtml)
    expect(scripts.some((script) => script.includes(themeStorageKey))).toBe(true)
    const headEnd = indexHtml.indexOf('</head>')
    const inlineScriptAt = indexHtml.indexOf('<script>')
    expect(inlineScriptAt).toBeGreaterThan(-1)
    expect(inlineScriptAt).toBeLessThan(headEnd)
    expect(inlineScriptAt).toBeLessThan(indexHtml.indexOf('<script type="module"'))

    themePref.set('dark')
    await expect
      .poll(() => JSON.parse(localStorage.getItem(themeStorageKey) ?? 'null')?.data)
      .toBe('dark')
    expect(await firstPaintProbe()).toEqual({ theme: 'dark', background: darkBackground })

    themePref.set('light')
    await emulateScheme('dark')
    expect(await firstPaintProbe()).toEqual({ theme: 'light', background: lightBackground })

    themePref.set('system')
    expect(await firstPaintProbe()).toEqual({ theme: 'dark', background: darkBackground })

    localStorage.setItem(themeStorageKey, '{not json')
    expect(await firstPaintProbe()).toEqual({ theme: 'dark', background: darkBackground })
    await emulateScheme('light')
    expect(await firstPaintProbe()).toEqual({ theme: 'light', background: lightBackground })
  })

  test('Appearance offers Light, Dark, and System (the default). The root theme attribute updates in the same turn as the click, and a reload restores it.', async () => {
    await bootApp({ key: seededKey })
    await openAppearance()

    const labels = [
      ...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="theme"]'),
    ].map((input) => input.labels?.[0]?.querySelector('[data-theme-option-label]')?.textContent)
    expect(labels).toEqual(['Light', 'Dark', 'System'])
    expect(themeOption('System').checked).toBe(true)
    expect(root.dataset.themePref).toBe('system')
    expect(root.dataset.theme).toBe('light')

    themeOption('Dark').click()
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.themePref).toBe('dark')
    expect(themePref()).toBe('dark')
    await expect
      .poll(() => themeOption('System').labels?.[0]?.textContent ?? '')
      .toContain('Currently dark')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#141413',
    )
    await paint()
    await sleep(300)
    expectNoOverlay()
    await shot('F-23b', 'dark')

    themeOption('Light').click()
    expect(root.dataset.theme).toBe('light')
    await paint()
    await sleep(300)
    expectNoOverlay()
    await shot('F-23b', 'light')

    themeOption('Dark').click()
    reloadApp()
    await paint()
    expect(root.dataset.theme).toBe('dark')
    expect(getComputedStyle(document.body).backgroundColor).toBe(darkBackground)
    await openAppearance()
    expect(themeOption('Dark').checked).toBe(true)
  })

  test('System follows prefers-color-scheme changes without a reload.', async () => {
    await bootApp({ key: seededKey })
    await openAppearance()
    themeOption('System').click()
    expect(root.dataset.themePref).toBe('system')
    expect(root.dataset.theme).toBe('light')

    await emulateScheme('dark')
    await expect.poll(() => root.dataset.theme).toBe('dark')
    expect(getComputedStyle(document.body).backgroundColor).toBe(darkBackground)
    expect(themeOption('System').checked).toBe(true)
    await expect
      .poll(() => themeOption('System').labels?.[0]?.textContent ?? '')
      .toContain('dark')

    await paint()
    await sleep(300)
    expectNoOverlay()
    await shot('F-23b', 'system')

    await emulateScheme('light')
    await expect.poll(() => root.dataset.theme).toBe('light')
    expect(getComputedStyle(document.body).backgroundColor).toBe(lightBackground)
  })

  test('In both light and dark, body text on the app background and the primary button label on its fill contrast at 4.5:1 or more (computed style).', async () => {
    await bootApp({ key: seededKey })
    const host = document.createElement('div')
    document.querySelector('[data-testid="shell"] main')!.append(host)
    const { unmount } = mount(host, <Button variant="primary">Save</Button>)
    const primary = host.querySelector('button')!

    for (const choice of ['light', 'dark'] as const) {
      await openAppearance()
      themeOption(choice === 'light' ? 'Light' : 'Dark').click()
      ui.appSettings.set(null)
      await paint()
      await sleep(300)
      expect(root.dataset.theme).toBe(choice)
      const bodyStyle = getComputedStyle(document.body)
      const bodyRatio = contrastRatio(bodyStyle.color, resolvedBackground(document.body))
      const mainElement = document.querySelector('[data-testid="shell"] main')!
      const threadRatio = contrastRatio(
        getComputedStyle(mainElement).color,
        resolvedBackground(mainElement),
      )
      const primaryStyle = getComputedStyle(primary)
      const primaryRatio = contrastRatio(primaryStyle.color, primaryStyle.backgroundColor)
      expect({ choice, bodyRatio: bodyRatio >= 4.5, threadRatio: threadRatio >= 4.5 }).toEqual({
        choice,
        bodyRatio: true,
        threadRatio: true,
      })
      expect(primaryRatio).toBeGreaterThanOrEqual(4.5)
    }
    unmount()
  })
})
