import type { Meta, StoryObj } from '@storybook/html'
import { expect, waitFor, userEvent } from 'storybook/test'

import { button, createActor, role } from '../../../.storybook/helpers'
import { ADMIN_FRAME } from '../../root'
import { getAdminRoot } from '../../testing/admin-root'
import { renderOtlpChrome } from './boot'
import { STORY_ANALYTICS_BATCH, STORY_RESOURCE } from './fixtures'

const I = createActor()

const meta = {
  title: 'OTLP/Analytics',
  tags: ['@smoke'],
  parameters: {
    layout: 'fullscreen',
    vitest: { testTimeout: 30_000 },
  },
  render: () => renderOtlpChrome(STORY_ANALYTICS_BATCH, STORY_RESOURCE),
  beforeEach: (context) => void I.init(context),
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

function clickElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center' })
  element.click()
}

function tabByLabel(root: ParentNode, label: string): HTMLElement {
  const tab = root.querySelector(`[role="tab"][aria-label="${label}"]`)
  if (!(tab instanceof HTMLElement)) throw new Error(`Tab not found: ${label}`)
  return tab
}

function kpiText(root: ParentNode, id: string): string {
  return (
    root.querySelector(`[data-testid="analytics-kpi-${id}"]`)?.textContent ?? ''
  )
}

function expectEventOverview(panel: Element | null, path: string) {
  expect(
    panel?.querySelector('[data-reatom-name="EventOverview"]'),
  ).toBeInstanceOf(HTMLElement)
  expect(panel?.querySelector('[data-reatom-name="ParamList"]')).toBeNull()
  expect(
    [...(panel?.querySelectorAll('h3') ?? [])].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(expect.arrayContaining(['Page', 'Identity']))
  const term = [...(panel?.querySelectorAll('dt') ?? [])].find(
    (entry) => entry.textContent === 'url.path',
  )
  expect(term?.nextElementSibling?.textContent).toBe(path)
}

export const AnalyticsTab: Story = {
  name: 'Analytics tab scopes entry sessions',
  play: async ({ canvasElement }) => {
    const root = adminRoot(canvasElement)
    clickElement(tabByLabel(root, 'Analytics'))
    await I.click(role('tab', 'Overview').within(getAdminRoot()))
    await waitFor(() => {
      expect(kpiText(root, 'sessions')).toContain('8')
      expect(kpiText(root, 'visitors')).toContain('7')
    })

    const entry = root.querySelector(
      '[data-testid="analytics-breakdown-entry"] [data-row-id="/"]',
    )
    if (!(entry instanceof HTMLElement)) {
      throw new Error('Entry page / missing')
    }
    clickElement(entry)
    await waitFor(() => {
      expect(
        root.querySelector('[data-testid="analytics-scope"]')?.textContent,
      ).toContain('Entry pages: /')
      expect(kpiText(root, 'sessions')).toContain('6')
    })

    const remove = root.querySelector(
      '[data-testid="analytics-scope"] [aria-label="Remove session scope"]',
    )
    if (!(remove instanceof HTMLElement)) {
      throw new Error('Remove session scope missing')
    }
    clickElement(remove)
    await waitFor(() => {
      expect(root.querySelector('[data-testid="analytics-scope"]')).toBeNull()
      expect(kpiText(root, 'sessions')).toContain('8')
    })
  },
}

export const PathsUnit: Story = {
  name: 'Paths unit opens the typical session',
  render: () =>
    renderOtlpChrome(STORY_ANALYTICS_BATCH, STORY_RESOURCE, {
      onReady: ({ admin }) =>
        ADMIN_FRAME.run(() => admin.causalEnabled.setFalse()),
    }),
  play: async ({ canvasElement }) => {
    const root = adminRoot(canvasElement)
    clickElement(tabByLabel(root, 'Timeline'))
    await I.click(button('Paths').within(getAdminRoot()).wait())

    await waitFor(() => {
      const labels = [
        ...root.querySelectorAll('[data-testid="gantt-row-label"]'),
      ].map((node) => node.textContent ?? '')
      expect(labels).toEqual(
        expect.arrayContaining(['All sessions', '/', '/goods/:id', '/cart']),
      )
    })

    const cart = [...root.querySelectorAll('[data-path-id]')].find((row) => {
      const id = row.getAttribute('data-path-id') ?? ''
      return id.endsWith(' → /cart')
    })
    if (!(cart instanceof HTMLElement)) throw new Error('Cart step missing')
    clickElement(cart)
    await waitFor(() => {
      expect(
        root.querySelector('[data-testid="path-step-card"]')?.textContent,
      ).toContain('Median')
    })

    const align = root.querySelector('[data-testid="path-step-align"]')
    if (!(align instanceof HTMLElement)) throw new Error('Align here missing')
    clickElement(align)
    await waitFor(() => {
      expect(
        root.querySelector('[data-testid="gantt-summary"]')?.textContent,
      ).toContain('aligned at /cart')
      const alignAt = root.querySelector('select[aria-label="Align at"]')
      expect(alignAt).toBeInstanceOf(HTMLSelectElement)
      expect((alignAt as HTMLSelectElement).value).toBe('/cart')
    })

    const name = root.querySelector('[data-testid="filter-name"]')
    if (!(name instanceof HTMLInputElement)) {
      throw new Error('Name filter missing')
    }
    name.value = 'no-such-record'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => {
      const alignAt = root.querySelector('select[aria-label="Align at"]')
      expect(alignAt).toBeInstanceOf(HTMLSelectElement)
      expect((alignAt as HTMLSelectElement).value).toBe('/cart')
    })
    name.value = ''
    name.dispatchEvent(new Event('input', { bubbles: true }))

    const open = root.querySelector(
      '[data-testid="gantt-open-typical-session"]',
    )
    if (!(open instanceof HTMLElement)) {
      throw new Error('Open typical session missing')
    }
    clickElement(open)
    await waitFor(() => {
      expect(
        root
          .querySelector('[data-testid="gantt-mode-waterfall"]')
          ?.getAttribute('aria-pressed'),
      ).toBe('true')
      expect(
        root.querySelector('[data-testid="analytics-scope"]')?.textContent,
      ).toContain('Typical session')
      const recordLabels = [
        ...root.querySelectorAll('[data-testid="gantt-row"][data-record-id]'),
      ].map(
        (row) =>
          row.querySelector('[data-testid="gantt-row-label"]')?.textContent,
      )
      expect(recordLabels.filter((label) => label !== 'In progress')).toEqual([
        'session.start',
        'app.page_view',
        'app.page.engagement',
        'app.page_view',
        'app.page.engagement',
        'app.page_view',
        'app.page.engagement',
        'app.page_view',
        'app.page.engagement',
      ])
    })

    const pageView = [
      ...root.querySelectorAll('[data-testid="gantt-row"][data-record-id]'),
    ].find(
      (row) =>
        row.querySelector('[data-testid="gantt-row-label"]')?.textContent ===
        'app.page_view',
    )
    if (!(pageView instanceof HTMLElement)) {
      throw new Error('app.page_view row missing')
    }
    clickElement(pageView)
    await waitFor(() => {
      const card = root.querySelector('[data-reatom-name="FrameCard"]')
      expect(card?.textContent).toContain('app.page_view')
      expectEventOverview(card, '/')
    })
  },
}

export const InvestigateCapture: Story = {
  name: 'Sessions investigate diagnostic capture without analytics consent',
  render: () =>
    renderOtlpChrome(
      [
        {
          traceId: '',
          spanId: 'diagnostic',
          timeUnixNano: '1000000000',
          eventName: 'dev.ready',
          body: { stringValue: 'Ready for development' },
        },
      ],
      STORY_RESOURCE,
    ),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.see(role('tab', 'Sessions').within(root))
    await I.click(role('row', /Diagnostic capture/).within(root))
    await I.see(role('grid', 'Session journey').within(root))
    await I.see(role('row', /dev.ready/).within(root))
    await I.click(button('Back to sessions').within(root))
    await I.see(role('grid', 'Sessions').within(root))
    await I.click(role('tab', 'Overview').within(root))
    await I.see(role('tab', 'Overview').within(root))
  },
}

const mixedRecords = [
  {
    traceId: 'journey-trace',
    spanId: 'page',
    eventName: 'app.page_view',
    timeUnixNano: '1760000000000000000',
    attributes: { 'session.id': 'dev-session', 'url.path': '/checkout' },
  },
  {
    traceId: 'journey-trace',
    spanId: 'load',
    name: 'load.checkout',
    startTimeUnixNano: '1760000000100000000',
    endTimeUnixNano: '1760000000200000000',
  },
  {
    traceId: 'journey-trace',
    spanId: 'ready',
    eventName: 'checkout.ready',
    timeUnixNano: '1760000000300000000',
    body: { stringValue: 'Checkout ready' },
  },
  {
    traceId: 'journey-trace',
    spanId: 'metric',
    eventName: 'measurement',
    timeUnixNano: '1760000000400000000',
    attributes: {
      'measurement.type': 'web-vitals',
      'measurement.values': { LCP: 200, CLS: 0.01 },
    },
  },
  {
    traceId: 'journey-trace',
    spanId: 'failure',
    eventName: 'exception',
    timeUnixNano: '1760000000500000000',
    attributes: {
      'exception.message': 'Payment rejected',
      'exception.type': 'PaymentError',
    },
  },
]

export const MixedSession: Story = {
  name: 'Mixed session preserves context across inspector and Timeline',
  tags: ['@visual'],
  globals: { viewport: { value: 'wide', isRotated: false } },
  render: () => renderOtlpChrome(mixedRecords, STORY_RESOURCE),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.fill(
      role('searchbox', 'Search sessions').within(root),
      'Payment rejected',
    )
    await I.click(role('row', /dev-session/).within(root))
    await I.seeAttribute(button('Errors').within(root), 'title', 'Errors: 1')
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      6,
    )
    // Kahraman selectOption searches document.body; native selects live in Admin's shadow root.
    await userEvent.selectOptions(
      await I.see(role('combobox', 'Journey signal').within(root)),
      'measurements',
    )
    await I.see(role('row', /web-vitals/).within(root))
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      2,
    )
    await userEvent.selectOptions(
      await I.see(role('combobox', 'Journey signal').within(root)),
      'all',
    )
    await I.click(role('row', /checkout.ready/).within(root))
    await I.see(button('Close record details').within(root))
    const { matchElementScreenshot } = await import('../../testing/visual')
    await matchElementScreenshot(root, 'session-journey-wide')
    await I.click(button('Open selected event in Timeline').within(root))
    await I.seeAttribute(
      role('tab', 'Timeline').within(root),
      'aria-selected',
      'true',
    )
    await I.click(role('tab', 'Analytics').within(root))
    await I.see(role('grid', 'Session journey').within(root))
    await I.click(button('Back to sessions').within(root))
    await I.seeInField(
      role('searchbox', 'Search sessions').within(root),
      'Payment rejected',
    )
    await I.see(role('row', /dev-session/).within(root))
  },
}

export const MixedSessionNarrow: Story = {
  name: 'Narrow session journey opens existing inspector drawer',
  tags: ['@visual'],
  globals: { viewport: { value: 'narrow', isRotated: false } },
  render: () =>
    renderOtlpChrome(mixedRecords, STORY_RESOURCE, { width: 560, height: 760 }),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.fill(
      role('searchbox', 'Search sessions').within(root),
      'Payment rejected',
    )
    await I.click(role('row', /dev-session/).within(root))
    await I.seeAttribute(button('Errors').within(root), 'title', 'Errors: 1')
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      6,
    )
    // Kahraman selectOption searches document.body; native selects live in Admin's shadow root.
    await userEvent.selectOptions(
      await I.see(role('combobox', 'Journey signal').within(root)),
      'measurements',
    )
    await I.see(role('row', /web-vitals/).within(root))
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      2,
    )
    await userEvent.selectOptions(
      await I.see(role('combobox', 'Journey signal').within(root)),
      'all',
    )
    await I.click(role('row', /checkout.ready/).within(root))
    await I.see(button('Close record details').within(root))
    await I.see(role('dialog', 'Frame').within(root))
    const { matchElementScreenshot } = await import('../../testing/visual')
    await matchElementScreenshot(root, 'session-journey-narrow')
    await I.click(button('Close record details').within(root))
    await I.see(role('grid', 'Session journey').within(root))
  },
}

export const SessionPagination: Story = {
  name: 'Session search covers the full capture with bounded rows',
  render: () =>
    renderOtlpChrome(
      Array.from({ length: 205 }, (_, index) => ({
        traceId: `trace-${index}`,
        spanId: `record-${index}`,
        eventName: `event-${index}`,
        timeUnixNano: String(1760000000000000000n + BigInt(index) * 1000000n),
        attributes: { 'session.id': `session-${index}` },
      })),
      STORY_RESOURCE,
    ),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Sessions').within(root)).all(),
      101,
    )
    await I.click(button('Next page').within(root))
    await I.see(role('row', /session-104 /).within(root))
    await I.dontSee(role('row', /session-204 /).within(root))
    const listScroller = await I.see(
      role('rowgroup').within(role('grid', 'Sessions').within(root)),
    )
    listScroller.scrollTop = 300
    await I.click(role('row', /session-94 /).within(root))
    await I.click(button('Back to sessions').within(root))
    const restoredList = await I.see(
      role('rowgroup').within(role('grid', 'Sessions').within(root)),
    )
    await waitFor(() => {
      if (restoredList.scrollTop !== 300)
        throw new Error('Session list scroll was not restored')
    })

    await I.fill(role('searchbox', 'Search sessions').within(root), 'session-0')
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Sessions').within(root)).all(),
      2,
    )
    await I.see(role('row', /session-0 /).within(root))
  },
}

export const JourneyScroll: Story = {
  name: 'Journey scroll and selection survive Timeline navigation',
  render: () =>
    renderOtlpChrome(
      Array.from({ length: 205 }, (_, index) => ({
        traceId: 'scroll-trace',
        spanId: `record-${index}`,
        eventName: `journey-${index}`,
        timeUnixNano: String(1760000000000000000n + BigInt(index) * 1000000n),
        attributes: { 'session.id': 'scroll-session' },
      })),
      STORY_RESOURCE,
    ),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.click(role('row', /scroll-session/).within(root))
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      101,
    )
    // Native scrolling and geometry are outside the actor's interaction vocabulary.
    const scroll = await I.see(
      role('rowgroup').within(role('grid', 'Session journey').within(root)),
    )
    scroll.scrollTop = 300
    await waitFor(() => {
      if (scroll.scrollTop !== 300) throw new Error('Journey did not scroll')
    })
    await I.click(role('row', /journey-10 /).within(root))
    const previous = scroll.scrollTop
    await I.click(button('Open selected event in Timeline').within(root))
    await I.click(role('tab', 'Analytics').within(root))
    const restored = await I.see(
      role('rowgroup').within(role('grid', 'Session journey').within(root)),
    )
    await waitFor(() => {
      if (restored.scrollTop !== previous)
        throw new Error('Journey scroll was not restored')
    })
    await I.seeAttribute(
      role('row', /journey-10 /).within(root),
      'aria-selected',
      'true',
    )
    await I.click(button('Next page').within(root))
    await I.see(role('row', /journey-100 /).within(root))
    await I.fill(
      role('searchbox', 'Search journey').within(root),
      'journey-204',
    )
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      2,
    )
    await I.see(role('row', /journey-204 /).within(root))
  },
}

let liveSessionAdmin: Parameters<
  NonNullable<import('./boot').OtlpChromeRenderOptions['onReady']>
>[0]['admin']
export const LiveSessionStability: Story = {
  name: 'Unrelated live capture preserves journey focus and scroller identity',
  render: () =>
    renderOtlpChrome(
      Array.from({ length: 150 }, (_, index) => ({
        traceId: 'live-trace',
        spanId: `record-${index}`,
        eventName: `live-${index}`,
        timeUnixNano: String(1760000000000000000n + BigInt(index) * 1000000n),
        attributes: { 'session.id': 'live-session' },
      })),
      STORY_RESOURCE,
      {
        source: 'live',
        onReady: ({ admin }) => {
          liveSessionAdmin = admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.click(role('row', /live-session/).within(root))
    const input = await I.see(role('searchbox', 'Search journey').within(root))
    const scroller = await I.see(
      role('rowgroup').within(role('grid', 'Session journey').within(root)),
    )
    scroller.scrollTop = 300
    await I.click(role('searchbox', 'Search journey').within(root))
    ADMIN_FRAME.run(() =>
      liveSessionAdmin.ingest([
        {
          traceId: 'other-trace',
          spanId: 'other',
          eventName: 'other.event',
          timeUnixNano: '1760000001000000000',
          attributes: { 'session.id': 'other-session' },
        },
      ]),
    )
    await waitFor(() => {
      if (
        !input.isConnected ||
        !scroller.isConnected ||
        (input.getRootNode() instanceof ShadowRoot &&
          (input.getRootNode() as ShadowRoot).activeElement !== input) ||
        scroller.scrollTop !== 300
      )
        throw new Error(
          'Unrelated capture replaced journey input/scroller or lost focus/scroll',
        )
    })
    ADMIN_FRAME.run(() =>
      liveSessionAdmin.ingest([
        {
          traceId: 'live-trace',
          spanId: 'late',
          eventName: 'late.event',
          timeUnixNano: '1760000002000000000',
          attributes: { 'session.id': 'live-session' },
        },
      ]),
    )
    const updatedScroller = await I.see(
      role('rowgroup').within(role('grid', 'Session journey').within(root)),
    )
    await waitFor(() => {
      if (
        !input.isConnected ||
        (input.getRootNode() as ShadowRoot).activeElement !== input ||
        updatedScroller.scrollTop !== 300
      )
        throw new Error('Session append lost journey focus or scroll')
    })
  },
}

export const FilteredLateException: Story = {
  name: 'Filtered journey refreshes an existing span when its exception arrives',
  render: () =>
    renderOtlpChrome(
      [
        {
          traceId: 'late-error',
          spanId: 'span-1',
          name: 'request',
          startTimeUnixNano: '1760000000000000000',
          attributes: { 'session.id': 'late-session' },
        },
        {
          traceId: 'background-trace',
          spanId: 'span-2',
          name: 'background',
          startTimeUnixNano: '1760000000000000000',
          attributes: { 'session.id': 'background-session' },
        },
      ],
      STORY_RESOURCE,
      {
        source: 'live',
        onReady: ({ admin }) => {
          liveSessionAdmin = admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot()
    await I.click(role('tab', 'Analytics').within(root))
    await I.click(role('row', /late-session/).within(root))
    await I.fill(role('searchbox', 'Search journey').within(root), 'request')
    await I.see(role('row', /Span request/).within(root))
    const input = await I.see(role('searchbox', 'Search journey').within(root))
    await I.click(role('searchbox', 'Search journey').within(root))
    ADMIN_FRAME.run(() =>
      liveSessionAdmin.ingest([
        {
          traceId: 'late-error',
          spanId: 'span-1',
          eventName: 'exception',
          timeUnixNano: '1760000001000000000',
          attributes: { 'exception.message': 'failed' },
        },
      ]),
    )
    await I.see(
      role('row', /Error request.*failed/)
        .within(root)
        .wait(),
    )
    await I.dontSee(role('row', /Span request/).within(root))
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      2,
    )
    // These enrichments deliberately coalesce before the next render. The
    // latest invalidation concerns another session, but this row still updates.
    ADMIN_FRAME.run(() => {
      liveSessionAdmin.ingest([
        {
          traceId: 'late-error',
          spanId: 'span-1',
          eventName: 'exception',
          timeUnixNano: '1760000002000000000',
          attributes: { 'exception.message': 'failed again' },
        },
      ])
      liveSessionAdmin.ingest([
        {
          traceId: 'background-trace',
          spanId: 'span-2',
          eventName: 'exception',
          timeUnixNano: '1760000002000000000',
          attributes: { 'exception.message': 'background failed' },
        },
      ])
    })
    await I.see(
      role('row', /Error request.*failed again/)
        .within(root)
        .wait(),
    )
    await I.seeNumberOfElements(
      role('row').within(role('grid', 'Session journey').within(root)).all(),
      2,
    )
    if (
      !input.isConnected ||
      (input.getRootNode() as ShadowRoot).activeElement !== input
    )
      throw new Error('Late exception replaced focused journey search')
  },
}
