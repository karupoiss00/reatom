import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent, waitFor } from 'storybook/test'

import { matchStoryRootScreenshot } from '../../testing/visual'
import { renderOtlpChrome } from './boot'
import { clickhouseDeniedFetch, clickhouseMockFetch } from './clickhouse-mock'
import {
  STORY_FIXTURE_BATCH,
  STORY_RESOURCE,
  STORY_SPANS_BATCH,
} from './fixtures'

const VISUAL_VIEWPORT = { width: 1280, height: 800 } as const

const meta = {
  title: 'OTLP/Railway chrome',
  tags: ['@smoke'],
  parameters: {
    layout: 'fullscreen',
    vitest: { testTimeout: 30_000 },
  },
  render: () => renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function canvasPath() {
  return `${window.location.pathname}${window.location.search}`
}

function ganttRowByLabel(canvas: HTMLElement, label: string): HTMLElement {
  const rows = [...canvas.querySelectorAll('[data-testid="gantt-row"]')]
  const match = rows.find((row) =>
    (
      row.querySelector('[data-testid="gantt-row-label"]')?.textContent ?? ''
    ).includes(label),
  )
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Gantt row not found: ${label}`)
  }
  return match
}

function rowByName(canvas: HTMLElement, name: string): HTMLElement {
  const rows = [...canvas.querySelectorAll('[data-testid="log-row"]')]
  const match = rows.find((row) =>
    (row.querySelector('[data-testid="log-item-name"]')?.textContent ??
      ''
    ).includes(name),
  )
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Activity row not found: ${name}`)
  }
  return match
}

function tabByLabel(canvas: HTMLElement, label: string): HTMLElement {
  const tab = canvas.querySelector(`[role="tab"][aria-label="${label}"]`)
  if (!(tab instanceof HTMLElement)) {
    throw new Error(`Tab not found: ${label}`)
  }
  return tab
}

function clickElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center' })
  element.click()
}

function splitPaneTracks(splitPane: HTMLElement): string[] {
  const columns = getComputedStyle(splitPane).gridTemplateColumns.trim()
  if (!columns || columns === 'none') return []
  return columns.split(/\s+/).filter(Boolean)
}

function isHorizontalSplit(root: HTMLElement): boolean {
  if (root.getBoundingClientRect().width < 960) return false

  const splitPane = root.querySelector('[data-reatom-name="SplitPane"]')
  if (!(splitPane instanceof HTMLElement)) return false

  const splitVar = getComputedStyle(splitPane).getPropertyValue('--split').trim()
  if (!splitVar) return false

  if (splitPaneTracks(splitPane).length >= 3) return true

  const left = splitPane.querySelector('[data-pane="left"]')
  const right = splitPane.querySelector('[data-pane="right"]')
  if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement)) {
    return false
  }
  return (
    left.getBoundingClientRect().right < right.getBoundingClientRect().left
  )
}

async function waitForHorizontalSplit(root: HTMLElement): Promise<void> {
  await waitFor(() => {
    const splitPane = root.querySelector('[data-reatom-name="SplitPane"]')
    if (!(splitPane instanceof HTMLElement)) {
      throw new Error('SplitPane not mounted')
    }
    const splitVar = getComputedStyle(splitPane)
      .getPropertyValue('--split')
      .trim()
    if (!splitVar) {
      throw new Error(
        'css:split --split missing; story/boot must land SplitPane columns',
      )
    }
    expect(root.getBoundingClientRect().width).toBeGreaterThanOrEqual(960)
    expect(isHorizontalSplit(root)).toBe(true)
  })
}

async function waitForFilledWorkspace(root: HTMLElement): Promise<void> {
  await waitForHorizontalSplit(root)
  await waitFor(() => {
    const snapshot = root.querySelector('[data-testid="admin-visual-snapshot"]')
    const split = root.querySelector('[data-reatom-name="SplitPane"]')
    expect(snapshot).toBeInstanceOf(HTMLElement)
    expect(split).toBeInstanceOf(HTMLElement)
    expect(
      (snapshot as HTMLElement).getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(700)
    expect(
      (split as HTMLElement).getBoundingClientRect().height,
    ).toBeGreaterThan(400)
  })
}

async function stabilizeOtlpChrome(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 900))
}

export const FixtureChrome: Story = {
  name: 'Ingested T-063 fixtures',
  play: async ({ canvasElement }) => {
    const startPath = canvasPath()
    if (startPath.includes('iframe.html')) {
      expect(window.location.pathname).not.toBe('/')
    }

    await waitFor(() => {
      expect(canvasElement.textContent).toContain('Reatom Admin')
      const rows = canvasElement.querySelectorAll('[data-testid="log-row"]')
      expect(rows.length).toBe(7)
      const names = [...rows].map(
        (row) =>
          row.querySelector('[data-testid="log-item-name"]')?.textContent ?? '',
      )
      expect(names.some((name) => name.includes('devtools.ping'))).toBe(true)
      expect(names.some((name) => name.includes('tree.checked'))).toBe(true)
      expect(names.some((name) => name.includes('explode'))).toBe(true)
      expect(names.some((name) => name.includes('route goods'))).toBe(true)
      expect(canvasElement.textContent).toContain('error')
    })

    clickElement(rowByName(canvasElement, 'tree.checked'))
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-reatom-name="OtlpInspector"]')
          ?.textContent,
      ).toContain('tree.checked')
    })
    clickElement(tabByLabel(canvasElement, 'Cause Chain'))
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-reatom-name="RailGraph"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    clickElement(tabByLabel(canvasElement, 'Graph'))
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-reatom-name="RailGraph"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    clickElement(tabByLabel(canvasElement, 'Activity'))
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })
    clickElement(rowByName(canvasElement, 'route goods'))
    clickElement(tabByLabel(canvasElement, 'Cause Chain'))
    await waitFor(() => {
      expect(canvasElement.textContent).toContain('No cause chain')
      expect(
        canvasElement.querySelector(
          '[data-reatom-name="OtlpInspector"] [data-reatom-name="RailGraph"]',
        ),
      ).toBeNull()
    })

    clickElement(tabByLabel(canvasElement, 'Graph'))
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-reatom-name="RailGraph"]'),
      ).toBeNull()
      expect(canvasElement.textContent).toMatch(
        /Select a record to start graph analysis|No graph nodes/,
      )
    })

    clickElement(tabByLabel(canvasElement, 'State'))
    await waitFor(() => {
      const tree = canvasElement.querySelector(
        '[data-testid="otlp-state-tree"]',
      )
      expect(tree).toBeInstanceOf(HTMLElement)
      const leaf = [...(tree?.querySelectorAll('button') ?? [])].find((button) =>
        (button.textContent ?? '').includes('checked'),
      )
      expect(leaf).toBeInstanceOf(HTMLElement)
    })

    clickElement(tabByLabel(canvasElement, 'Timeline'))
    await waitFor(() => {
      const gantt = canvasElement.querySelector('[data-testid="otlp-gantt"]')
      expect(gantt).toBeInstanceOf(HTMLElement)
      expect(gantt?.getAttribute('aria-rowcount')).toBe('5')
      expect(
        ganttRowByLabel(canvasElement, 'route goods').getAttribute(
          'aria-selected',
        ),
      ).toBe('true')
      expect(canvasElement.querySelector('[data-testid="gantt-axis"]')).toBeInstanceOf(
        HTMLElement,
      )
      expect(
        canvasElement.querySelector('[data-testid="otlp-timeline-chart"]'),
      ).toBeNull()
      expect(canvasElement.textContent).toContain('Follow paused')
    })
    const expandAll = canvasElement.querySelector(
      '[data-testid="gantt-expand-all"]',
    )
    if (!(expandAll instanceof HTMLElement)) {
      throw new Error('Expand all missing')
    }
    clickElement(expandAll)
    await waitFor(() => {
      expect(
        canvasElement
          .querySelector('[data-testid="otlp-gantt"]')
          ?.getAttribute('aria-rowcount'),
      ).toBe('7')
      expect(ganttRowByLabel(canvasElement, 'tree.checked')).toBeInstanceOf(
        HTMLElement,
      )
    })
    clickElement(ganttRowByLabel(canvasElement, 'tree.checked'))
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-reatom-name="OtlpInspector"]')
          ?.textContent,
      ).toContain('tree.checked')
      expect(canvasElement.textContent).toContain('Follow paused')
    })

    expect(canvasPath()).toBe(startPath)
    expect(canvasElement.querySelector('[aria-label="Activity"]')).toBeInstanceOf(
      HTMLElement,
    )
    expect(canvasElement.querySelector('[aria-label="State"]')).toBeInstanceOf(
      HTMLElement,
    )
    expect(
      canvasElement.querySelector('[aria-label="Timeline"]'),
    ).toBeInstanceOf(HTMLElement)
    expect(canvasElement.querySelector('[aria-label="Graph"]')).toBeInstanceOf(
      HTMLElement,
    )
    expect(canvasElement.querySelector('[aria-label="Filters"]')).toBeInstanceOf(
      HTMLElement,
    )
    clickElement(tabByLabel(canvasElement, 'Filters'))
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-testid="otlp-filter-name"]'),
      ).toBeInstanceOf(HTMLElement)
      expect(canvasElement.textContent).not.toContain(
        'Filters stay a workspace tab',
      )
    })
    clickElement(tabByLabel(canvasElement, 'Activity'))
    await waitFor(() => {
      expect(canvasElement.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })
    expect(canvasElement.textContent).toContain('7 records')
    if (startPath.includes('iframe.html')) {
      expect(window.location.pathname).not.toBe('/')
    }
  },
}

export const ActivityVisualReference: Story = {
  name: 'OTLP activity visual reference',
  tags: ['@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(rowByName(storyRoot, 'tree.checked'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-reatom-name="OtlpInspector"]')
          ?.textContent,
      ).toContain('tree.checked')
    })
    clickElement(tabByLabel(storyRoot, 'Cause Chain'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-reatom-name="RailGraph"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    await waitForHorizontalSplit(storyRoot)
    await stabilizeOtlpChrome()
    expect(isHorizontalSplit(storyRoot)).toBe(true)

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-activity-reference')
  },
}

export const TimelineGantt: Story = {
  name: 'OTLP timeline gantt',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Timeline'))
    await waitFor(() => {
      const gantt = storyRoot.querySelector('[data-testid="otlp-gantt"]')
      expect(gantt).toBeInstanceOf(HTMLElement)
      expect(gantt?.getAttribute('aria-rowcount')).toBe('5')
      expect(storyRoot.querySelectorAll('[data-testid="gantt-bar"]').length).toBe(
        5,
      )
      expect(storyRoot.textContent).toContain('Follow on')
    })

    const expandAll = storyRoot.querySelector('[data-testid="gantt-expand-all"]')
    if (!(expandAll instanceof HTMLElement)) {
      throw new Error('Expand all missing')
    }
    clickElement(expandAll)
    await waitFor(() => {
      expect(
        storyRoot
          .querySelector('[data-testid="otlp-gantt"]')
          ?.getAttribute('aria-rowcount'),
      ).toBe('7')
      expect(storyRoot.querySelectorAll('[data-testid="gantt-row"]').length).toBe(
        7,
      )
    })

    clickElement(ganttRowByLabel(storyRoot, 'tree.checked'))
    await waitFor(() => {
      const selected = ganttRowByLabel(storyRoot, 'tree.checked')
      expect(selected.getAttribute('aria-selected')).toBe('true')
      expect(selected.getAttribute('data-depth')).toBe('1')
      expect(
        storyRoot.querySelector('[data-reatom-name="OtlpInspector"]')
          ?.textContent,
      ).toContain('tree.checked')
      expect(storyRoot.textContent).toContain('Follow paused')
    })

    const collapse = storyRoot.querySelector(
      '[aria-label="Collapse tree#12.toggle"]',
    )
    if (!(collapse instanceof HTMLElement)) {
      throw new Error('Collapse toggle missing')
    }
    clickElement(collapse)
    await waitFor(() => {
      expect(
        storyRoot
          .querySelector('[data-testid="otlp-gantt"]')
          ?.getAttribute('aria-rowcount'),
      ).toBe('6')
      expect(storyRoot.querySelectorAll('[data-testid="gantt-row"]').length).toBe(
        6,
      )
    })
    const expand = storyRoot.querySelector(
      '[aria-label="Expand tree#12.toggle"]',
    )
    if (!(expand instanceof HTMLElement)) {
      throw new Error('Expand toggle missing')
    }
    clickElement(expand)
    await waitFor(() => {
      expect(
        ganttRowByLabel(storyRoot, 'tree.checked').getAttribute('aria-selected'),
      ).toBe('true')
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-timeline-reference')
  },
}

export const ClickHouseRemoteThenClear: Story = {
  name: 'ClickHouse remote then clear',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome([], STORY_RESOURCE, {
      ...VISUAL_VIEWPORT,
      source: 'live',
      fetch: clickhouseMockFetch,
    }),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        0,
      )
    })

    const remoteToggle = storyRoot.querySelector(
      '[data-testid="otlp-remote-toggle"]',
    )
    if (!(remoteToggle instanceof HTMLElement)) {
      throw new Error('Remote toggle missing')
    }
    clickElement(remoteToggle)
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-remote-panel"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const password = storyRoot.querySelector(
      '[data-testid="otlp-remote-password"]',
    )
    if (!(password instanceof HTMLInputElement)) {
      throw new Error('Password field missing')
    }
    await userEvent.type(password, 'e2e-secret')

    const connect = storyRoot.querySelector(
      '[data-testid="otlp-remote-connect"]',
    )
    if (!(connect instanceof HTMLElement)) {
      throw new Error('Connect button missing')
    }
    clickElement(connect)

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('ClickHouse')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
      expect(storyRoot.textContent).toContain('tree.checked')
      expect(storyRoot.textContent).toContain('7 records')
    })

    clickElement(rowByName(storyRoot, 'tree.checked'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-reatom-name="OtlpInspector"]')
          ?.textContent,
      ).toContain('tree.checked')
    })
    clickElement(tabByLabel(storyRoot, 'Cause Chain'))
    await waitFor(() => {
      const graph = storyRoot.querySelector('[data-reatom-name="RailGraph"]')
      expect(graph).toBeInstanceOf(HTMLElement)
      const text = graph?.textContent ?? ''
      expect(text).toContain('tree#12.toggle')
      expect(text).toContain('tree.checked')
      expect(text).not.toMatch(/devtools\.ping/)
    })
    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    expect(storyRoot.querySelector('[data-testid="otlp-remote-panel"]')).toBeNull()
    await matchStoryRootScreenshot(snapshot, 'otlp-clickhouse-remote')

    const clear = [...storyRoot.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Clear workspace',
    )
    if (!(clear instanceof HTMLElement)) {
      throw new Error('Clear button missing')
    }
    clickElement(clear)
    await waitFor(() => {
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        0,
      )
      expect(storyRoot.textContent).toContain('0 records')
      expect(storyRoot.textContent).not.toContain('ClickHouse')
    })
    clickElement(remoteToggle)
    await waitFor(() => {
      const passwordAfter = storyRoot.querySelector(
        '[data-testid="otlp-remote-password"]',
      )
      expect(passwordAfter).toBeInstanceOf(HTMLInputElement)
      expect((passwordAfter as HTMLInputElement).value).toBe('')
    })
    await stabilizeOtlpChrome()
    await matchStoryRootScreenshot(snapshot, 'otlp-clickhouse-cleared')

    clickElement(tabByLabel(storyRoot, 'Timeline'))
    await waitFor(() => {
      expect(storyRoot.querySelector('[data-testid="gantt-empty"]')).toBeInstanceOf(
        HTMLElement,
      )
      expect(storyRoot.textContent).toContain('No timeline yet')
    })
  },
}

export const ClickHouseRemotePermissionDenied: Story = {
  name: 'ClickHouse remote permission denied',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome([], STORY_RESOURCE, {
      ...VISUAL_VIEWPORT,
      source: 'live',
      fetch: clickhouseDeniedFetch,
    }),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
    })

    const remoteToggle = storyRoot.querySelector(
      '[data-testid="otlp-remote-toggle"]',
    )
    if (!(remoteToggle instanceof HTMLElement)) {
      throw new Error('Remote toggle missing')
    }
    clickElement(remoteToggle)
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-remote-panel"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const connect = storyRoot.querySelector(
      '[data-testid="otlp-remote-connect"]',
    )
    if (!(connect instanceof HTMLElement)) {
      throw new Error('Connect button missing')
    }
    clickElement(connect)

    await waitFor(() => {
      const error = storyRoot.querySelector('[data-testid="otlp-remote-error"]')
      expect(error).toBeInstanceOf(HTMLElement)
      expect(error?.textContent).toMatch(/ClickHouse 401/)
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        0,
      )
      expect(storyRoot.textContent).toContain('0 records')
    })

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await stabilizeOtlpChrome()
    await matchStoryRootScreenshot(snapshot, 'otlp-clickhouse-denied')
  },
}

export const FilterErrorsThenActivity: Story = {
  name: 'Filter errors then Activity',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const errors = storyRoot.querySelector('[data-testid="otlp-filter-errors"]')
    if (!(errors instanceof HTMLElement)) {
      throw new Error('Errors filter missing')
    }
    clickElement(errors)
    await waitFor(() => {
      expect(errors.getAttribute('aria-pressed')).toBe('true')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/\/ 7 visible/)
    })

    clickElement(tabByLabel(storyRoot, 'Activity'))
    await waitFor(() => {
      const rows = [...storyRoot.querySelectorAll('[data-testid="log-row"]')]
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThan(7)
      const names = rows.map(
        (row) =>
          row.querySelector('[data-testid="log-item-name"]')?.textContent ?? '',
      )
      expect(names.some((name) => name.includes('explode'))).toBe(true)
      expect(names.some((name) => name.includes('tree.checked'))).toBe(false)
      expect(storyRoot.textContent).toMatch(/\/ 7 visible/)
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-errors')
  },
}

export const FilterCalculatorThenActivity: Story = {
  name: 'Filter calculator then Activity',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const toggle = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-toggle"]',
    )
    if (!(toggle instanceof HTMLElement)) {
      throw new Error('Calculator toggle missing')
    }
    clickElement(toggle)

    const calculator = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator"]',
    )
    if (!(calculator instanceof HTMLInputElement)) {
      throw new Error('Calculator input missing')
    }
    await userEvent.type(calculator, 'name:explode AND kind:action')
    await waitFor(() => {
      expect(calculator.value).toBe('name:explode AND kind:action')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/name:explode AND kind:action/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/\/ 7 visible/)
    })

    clickElement(tabByLabel(storyRoot, 'Activity'))
    await waitFor(() => {
      const rows = [...storyRoot.querySelectorAll('[data-testid="log-row"]')]
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThan(7)
      const names = rows.map(
        (row) =>
          row.querySelector('[data-testid="log-item-name"]')?.textContent ?? '',
      )
      expect(names.some((name) => name.includes('explode'))).toBe(true)
      expect(names.some((name) => name.includes('tree.checked'))).toBe(false)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-calculator-status"]')
          ?.textContent,
      ).toBe('name:explode AND kind:action')
      expect(storyRoot.textContent).toMatch(/\/ 7 visible/)
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-calculator')
  },
}

export const FilterCauseThenActivity: Story = {
  name: 'Filter cause then Activity',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const toggle = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-toggle"]',
    )
    if (!(toggle instanceof HTMLElement)) {
      throw new Error('Calculator toggle missing')
    }
    clickElement(toggle)

    const calculator = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator"]',
    )
    if (!(calculator instanceof HTMLInputElement)) {
      throw new Error('Calculator input missing')
    }
    await userEvent.type(calculator, 'cause>tree#12.toggle')
    await waitFor(() => {
      expect(calculator.value).toBe('cause>tree#12.toggle')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/cause>tree#12.toggle/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/\/ 7 visible/)
    })

    clickElement(tabByLabel(storyRoot, 'Activity'))
    await waitFor(() => {
      const rows = [...storyRoot.querySelectorAll('[data-testid="log-row"]')]
      expect(rows.length).toBe(1)
      const names = rows.map(
        (row) =>
          row.querySelector('[data-testid="log-item-name"]')?.textContent ?? '',
      )
      expect(names).toEqual(['tree.checked'])
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-calculator-status"]')
          ?.textContent,
      ).toBe('cause>tree#12.toggle')
      expect(storyRoot.textContent).toMatch(/1 \/ 7 visible/)
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-cause')
  },
}

export const FilterHideThenHighlightActivity: Story = {
  name: 'Filter hide then highlight Activity',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const toggle = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-toggle"]',
    )
    if (!(toggle instanceof HTMLElement)) {
      throw new Error('Calculator toggle missing')
    }
    clickElement(toggle)

    const calculator = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator"]',
    )
    if (!(calculator instanceof HTMLInputElement)) {
      throw new Error('Calculator input missing')
    }
    await userEvent.type(calculator, 'name:explode')
    await waitFor(() => {
      expect(calculator.value).toBe('name:explode')
    })

    const hide = storyRoot.querySelector('[data-testid="otlp-filter-mode-hide"]')
    if (!(hide instanceof HTMLElement)) {
      throw new Error('Hide mode missing')
    }
    clickElement(hide)
    await waitFor(() => {
      expect(hide.getAttribute('aria-pressed')).toBe('true')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/hide · name:explode/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/6 \/ 7 visible/)
    })

    clickElement(tabByLabel(storyRoot, 'Activity'))
    await waitFor(() => {
      const rows = [...storyRoot.querySelectorAll('[data-testid="log-row"]')]
      expect(rows).toHaveLength(6)
      const names = rows.map(
        (row) =>
          row.querySelector('[data-testid="log-item-name"]')?.textContent ?? '',
      )
      expect(names.some((name) => name.includes('explode'))).toBe(false)
      expect(names.some((name) => name.includes('tree.checked'))).toBe(true)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-calculator-status"]')
          ?.textContent,
      ).toBe('hide name:explode')
      expect(storyRoot.textContent).toMatch(/6 \/ 7 visible/)
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-hide')

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })
    const toggleAgain = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-toggle"]',
    )
    if (!(toggleAgain instanceof HTMLElement)) {
      throw new Error('Calculator toggle missing')
    }
    const panel = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-panel"]',
    )
    if (panel instanceof HTMLDetailsElement && !panel.open) {
      clickElement(toggleAgain)
    }
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-modes"]'),
      ).toBeInstanceOf(HTMLElement)
    })
    const highlight = storyRoot.querySelector(
      '[data-testid="otlp-filter-mode-highlight"]',
    )
    if (!(highlight instanceof HTMLElement)) {
      throw new Error('Highlight mode missing')
    }
    clickElement(highlight)
    await waitFor(() => {
      expect(highlight.getAttribute('aria-pressed')).toBe('true')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/highlight · name:explode/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/7 \/ 7 visible/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/1 highlighted/)
    })

    clickElement(tabByLabel(storyRoot, 'Activity'))
    await waitFor(() => {
      const rows = [...storyRoot.querySelectorAll('[data-testid="log-row"]')]
      expect(rows).toHaveLength(7)
      const highlighted = rows.filter(
        (row) => row.getAttribute('data-highlighted') === 'true',
      )
      expect(highlighted).toHaveLength(1)
      expect(
        highlighted[0]?.querySelector('[data-testid="log-item-name"]')
          ?.textContent,
      ).toContain('explode')
      expect(
        highlighted[0]?.querySelector('[data-testid="otlp-row-highlighted"]')
          ?.textContent,
      ).toBe('highlighted')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-calculator-status"]')
          ?.textContent,
      ).toBe('highlight name:explode')
      expect(storyRoot.textContent).toMatch(/7 \/ 7 visible/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-highlight-count"]')
          ?.textContent,
      ).toBe('1 highlighted')
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-highlight')
  },
}

const TOKEN_HIGHLIGHT_QUERY =
  'name:explode AND (state:"out of stock" OR kind:action)'

export const FilterCalculatorTokenHighlight: Story = {
  name: 'Filter calculator token highlight',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_FIXTURE_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        7,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const toggle = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-toggle"]',
    )
    if (!(toggle instanceof HTMLElement)) {
      throw new Error('Calculator toggle missing')
    }
    clickElement(toggle)

    const calculator = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator"]',
    )
    if (!(calculator instanceof HTMLInputElement)) {
      throw new Error('Calculator input missing')
    }
    await userEvent.type(calculator, TOKEN_HIGHLIGHT_QUERY)
    await waitFor(() => {
      expect(calculator.value).toBe(TOKEN_HIGHLIGHT_QUERY)
      const tokens = [
        ...storyRoot.querySelectorAll(
          '[data-testid="otlp-filter-calculator-token"]',
        ),
      ]
      expect(tokens.map((token) => token.textContent).join('')).toBe(
        TOKEN_HIGHLIGHT_QUERY,
      )
      const kinds = tokens.map((token) => token.getAttribute('data-kind'))
      expect(kinds).toContain('field')
      expect(kinds).toContain('keyword')
      expect(kinds).toContain('op')
      expect(kinds).toContain('string')
      expect(kinds).toContain('paren')
      const field = tokens.find(
        (token) => token.getAttribute('data-kind') === 'field',
      )
      const keyword = tokens.find(
        (token) => token.getAttribute('data-kind') === 'keyword',
      )
      const string = tokens.find(
        (token) => token.getAttribute('data-kind') === 'string',
      )
      const op = tokens.find(
        (token) => token.getAttribute('data-kind') === 'op',
      )
      if (
        !(field instanceof HTMLElement) ||
        !(keyword instanceof HTMLElement) ||
        !(string instanceof HTMLElement) ||
        !(op instanceof HTMLElement)
      ) {
        throw new Error('Calculator token kinds missing')
      }
      const fieldColor = getComputedStyle(field).color
      expect(getComputedStyle(keyword).color).not.toBe(fieldColor)
      expect(getComputedStyle(string).color).not.toBe(fieldColor)
      expect(getComputedStyle(op).color).not.toBe(fieldColor)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/name:explode AND \(state:"out of stock" OR kind:action\)/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/\/ 7 visible/)
    })

    await waitFor(() => {
      const snapshotTarget = storyRoot.querySelector(
        '[data-testid="admin-visual-snapshot"]',
      )
      const filters = storyRoot.querySelector(
        '[data-testid="otlp-filters-screen"]',
      )
      const highlight = storyRoot.querySelector(
        '[data-testid="otlp-filter-calculator-highlight"]',
      )
      expect(snapshotTarget).toBeInstanceOf(HTMLElement)
      expect(filters).toBeInstanceOf(HTMLElement)
      expect(highlight).toBeInstanceOf(HTMLElement)
      expect(
        (snapshotTarget as HTMLElement).getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(700)
      expect(
        (filters as HTMLElement).getBoundingClientRect().height,
      ).toBeGreaterThan(200)
    })
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-tokens')
  },
}

export const FilterSpansThenActivity: Story = {
  name: 'Filter spans then Activity',
  tags: ['@smoke', '@visual'],
  render: () =>
    renderOtlpChrome(STORY_SPANS_BATCH, STORY_RESOURCE, VISUAL_VIEWPORT),
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser')
    await page.viewport(VISUAL_VIEWPORT.width, VISUAL_VIEWPORT.height)

    const storyRoot =
      canvasElement.querySelector('[data-testid="otlp-chrome-story-root"]') ??
      canvasElement
    if (!(storyRoot instanceof HTMLElement)) {
      throw new Error('OTLP chrome story root missing')
    }

    await waitFor(() => {
      expect(storyRoot.textContent).toContain('Reatom Admin')
      expect(storyRoot.querySelectorAll('[data-testid="log-row"]').length).toBe(
        8,
      )
    })

    clickElement(tabByLabel(storyRoot, 'Filters'))
    await waitFor(() => {
      expect(
        storyRoot.querySelector('[data-testid="otlp-filters-screen"]'),
      ).toBeInstanceOf(HTMLElement)
    })

    const toggle = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator-toggle"]',
    )
    if (!(toggle instanceof HTMLElement)) {
      throw new Error('Calculator toggle missing')
    }
    clickElement(toggle)

    const calculator = storyRoot.querySelector(
      '[data-testid="otlp-filter-calculator"]',
    )
    if (!(calculator instanceof HTMLInputElement)) {
      throw new Error('Calculator input missing')
    }
    await userEvent.type(calculator, 'spans>1')
    await waitFor(() => {
      expect(calculator.value).toBe('spans>1')
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/spans>1/)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-summary"]')
          ?.textContent,
      ).toMatch(/3 \/ 8 visible/)
    })

    clickElement(tabByLabel(storyRoot, 'Activity'))
    await waitFor(() => {
      const rows = [...storyRoot.querySelectorAll('[data-testid="log-row"]')]
      expect(rows).toHaveLength(3)
      const names = rows.map(
        (row) =>
          row.querySelector('[data-testid="log-item-name"]')?.textContent ?? '',
      )
      expect(names.some((name) => name.includes('explode'))).toBe(true)
      expect(names.some((name) => name.includes('retry'))).toBe(true)
      expect(names.some((name) => name.includes('tree.checked'))).toBe(false)
      expect(
        storyRoot.querySelector('[data-testid="otlp-filter-calculator-status"]')
          ?.textContent,
      ).toBe('spans>1')
      expect(storyRoot.textContent).toMatch(/3 \/ 8 visible/)
    })

    await waitForFilledWorkspace(storyRoot)
    await stabilizeOtlpChrome()

    const snapshot =
      storyRoot.querySelector('[data-testid="admin-visual-snapshot"]') ??
      storyRoot
    if (!(snapshot instanceof HTMLElement)) {
      throw new Error('OTLP visual snapshot target missing')
    }
    await matchStoryRootScreenshot(snapshot, 'otlp-filter-spans')
  },
}
