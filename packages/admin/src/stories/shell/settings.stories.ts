import { reatomBoolean } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { expect, waitFor } from 'storybook/test'

import { createActor, heading, role, text } from '../../../.storybook/helpers'
import { ADMIN_FRAME, resetAdminFrame } from '../../root'
import { getAdminRoot } from '../../testing/admin-root'
import { registerStoryCleanup } from '../../testing/storybook-runtime'
import { createOtlpAdminApp } from '../../view/otlp'
import { registerLocalWorkOption } from '../../view/settings'
import { STORY_FIXTURE_BATCH, STORY_RESOURCE } from '../otlp/fixtures'

const I = createActor()

const meta = {
  title: 'Admin/Shell',
  parameters: { layout: 'fullscreen' },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function mountShell(story: HTMLElement) {
  const host = document.createElement('div')
  host.style.width = '100%'
  host.style.height = '100%'
  story.append(host)
  const mounted = createOtlpAdminApp(
    host,
    {
      sourceId: 'settings-story',
      resource: STORY_RESOURCE,
      source: 'replay',
    },
    STORY_FIXTURE_BATCH,
  )
  return {
    unmount: () => {
      mounted.unmount()
      host.remove()
    },
  }
}

function storyHost(canvas: HTMLElement): HTMLElement {
  const story = canvas.querySelector('[data-testid="admin-settings-story"]')
  if (!(story instanceof HTMLElement)) throw new Error('Missing settings story')
  return story
}

function pressShell(keyName: string) {
  const root = getAdminRoot()
  root.focus()
  root.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: keyName,
      bubbles: true,
      cancelable: true,
    }),
  )
}

export const DisplayAndLocalWork: Story = {
  name: 'Settings changes icons, colors, and local work',
  render: () => {
    const story = document.createElement('div')
    story.dataset.testid = 'admin-settings-story'
    story.style.width = '100%'
    story.style.height = '100vh'
    return story
  },
  play: async ({ canvasElement }) => {
    const story = storyHost(canvasElement)
    let unmountCurrent = () => {}
    registerStoryCleanup(() => unmountCurrent())
    unmountCurrent = mountShell(story).unmount

    const shell = () => getAdminRoot()
    const record = () => role('row', 'devtools.ping').within(shell())
    await I.see(record().wait())
    await I.click(record())
    await I.seeAttribute(record(), 'aria-selected', 'true')

    await I.click(role('tab', 'Settings').within(shell()))
    await I.see(heading('Display').within(shell()).wait())
    await I.see(heading('Local work').within(shell()))
    await I.see(
      text('No local-work options from this source yet.').within(shell()),
    )
    await I.see(text('Show kind icons next to record names').within(shell()))
    await I.see(
      text('Color records by kind: bars, row bands, chips').within(shell()),
    )
    await I.dontSee(role('searchbox', 'Name').within(shell()))
    await I.dontSee(role('complementary', 'Frame').within(shell()))
    await I.dontSee(role('dialog', 'Frame').within(shell()))
    await waitFor(() => {
      const filters = shell().querySelector('[aria-label="Filters"]')
      expect(filters).toBeInstanceOf(HTMLElement)
      expect(getComputedStyle(filters as HTMLElement).display).toBe('none')
    })

    await I.click(role('tab', 'Timeline').within(shell()))
    await I.seeAttribute(record(), 'aria-selected', 'true')
    await I.click(role('tab', 'Settings').within(shell()))

    await I.click(role('switch', 'Icons').within(shell()))
    await waitFor(() => {
      expect(shell().dataset.adminIcons).toBe('false')
    })
    expect(shell().dataset.adminColors).toBe('true')
    await I.click(role('switch', 'Colors').within(shell()))
    await waitFor(() => {
      expect(shell().dataset.adminColors).toBe('false')
    })

    pressShell('i')
    await waitFor(() => {
      expect(shell().dataset.adminIcons).toBe('true')
    })
    expect(shell().dataset.adminColors).toBe('false')
    pressShell('c')
    await waitFor(() => {
      expect(shell().dataset.adminColors).toBe('true')
    })

    const captureLocal = ADMIN_FRAME.run(() =>
      reatomBoolean(false, '_Admin.stories.settings.captureLocal'),
    )
    let unregister = () => {}
    registerStoryCleanup(() => unregister())
    unregister = ADMIN_FRAME.run(() =>
      registerLocalWorkOption({
        id: 'settings-story-capture',
        label: 'Capture local spans',
        description: 'Keep spans from this tab',
        checked: captureLocal,
      }),
    )
    await I.dontSee(
      text('No local-work options from this source yet.').within(shell()),
    )
    await I.see(role('switch', 'Capture local spans').within(shell()).wait())
    await I.see(text('Keep spans from this tab').within(shell()))
    await I.click(role('switch', 'Capture local spans').within(shell()))
    await waitFor(() => {
      expect(ADMIN_FRAME.run(() => captureLocal())).toBe(true)
    })
    await I.seeAttribute(
      role('switch', 'Capture local spans').within(shell()),
      'aria-checked',
      'true',
    )
  },
}

export const RemountKeepsDisplay: Story = {
  name: 'Display settings stay off after the shell is remounted',
  render: () => {
    const story = document.createElement('div')
    story.dataset.testid = 'admin-settings-story'
    story.style.width = '100%'
    story.style.height = '100vh'
    return story
  },
  play: async ({ canvasElement }) => {
    const story = storyHost(canvasElement)
    let unmountCurrent = () => {}
    registerStoryCleanup(() => unmountCurrent())
    const first = mountShell(story)
    unmountCurrent = first.unmount

    const shell = () => getAdminRoot()
    await I.click(role('tab', 'Settings').within(shell()).wait())
    await I.click(role('switch', 'Icons').within(shell()).wait())
    await I.click(role('switch', 'Colors').within(shell()))
    await waitFor(() => {
      expect(shell().dataset.adminIcons).toBe('false')
      expect(shell().dataset.adminColors).toBe('false')
    })

    first.unmount()
    resetAdminFrame()
    unmountCurrent = mountShell(story).unmount

    await I.see(role('tab', 'Timeline').within(shell()).wait())
    await waitFor(() => {
      expect(shell().dataset.adminIcons).toBe('false')
      expect(shell().dataset.adminColors).toBe('false')
    })
    await I.click(role('tab', 'Settings').within(shell()))
    await I.seeAttribute(
      role('switch', 'Icons').within(shell()),
      'aria-checked',
      'false',
    )
    await I.seeAttribute(
      role('switch', 'Colors').within(shell()),
      'aria-checked',
      'false',
    )
  },
}

export const ColorTheme: Story = {
  name: 'Settings changes the color theme',
  render: () => {
    const story = document.createElement('div')
    story.dataset.testid = 'admin-settings-story'
    story.style.width = '100%'
    story.style.height = '100vh'
    return story
  },
  play: async ({ canvasElement }) => {
    const story = storyHost(canvasElement)
    let unmountCurrent = () => {}
    registerStoryCleanup(() => unmountCurrent())
    unmountCurrent = mountShell(story).unmount

    const shell = () => getAdminRoot()
    await I.click(role('tab', 'Settings').within(shell()).wait())
    await I.see(heading('Appearance').within(shell()).wait())
    await I.see(heading('Window').within(shell()))
    await I.see(heading('Display').within(shell()))
    await I.see(heading('Local work').within(shell()))
    await I.see(text('Showing dark').within(shell()))
    await I.see(role('radio', 'Top left').within(shell()))
    await I.see(role('radio', 'Top right').within(shell()))
    await I.see(role('radio', 'Bottom left').within(shell()))
    await I.seeAttribute(
      role('radio', 'Bottom right').within(shell()),
      'aria-checked',
      'true',
    )
    await I.see(role('radio', 'Match host').within(shell()))
    await I.seeAttribute(
      role('radio', 'Dark').within(shell()),
      'aria-checked',
      'true',
    )
    expect(shell().dataset.adminScheme).toBe('dark')
    const duskCanvas = getComputedStyle(shell()).backgroundColor
    const duskAccent =
      getComputedStyle(shell()).getPropertyValue('--admin-accent')

    const accent = shell().querySelector('input[type="color"]')
    if (!(accent instanceof HTMLInputElement)) {
      throw new Error('Missing accent color picker')
    }
    accent.value = '#c2410c'
    accent.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => {
      const nextAccent =
        getComputedStyle(shell()).getPropertyValue('--admin-accent')
      expect(nextAccent).not.toBe(duskAccent)
      expect(getComputedStyle(shell()).backgroundColor).not.toBe(duskCanvas)
    })

    await I.click(role('radio', 'Light').within(shell()))
    await waitFor(() => {
      expect(shell().dataset.adminScheme).toBe('light')
    })
    await I.see(text('Showing light').within(shell()))
    expect(getComputedStyle(shell()).backgroundColor).not.toBe(duskCanvas)
    await I.see(role('radio', 'Bottom right').within(shell()))
  },
}
