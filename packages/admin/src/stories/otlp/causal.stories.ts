import type { Meta, StoryObj } from '@storybook/html'
import {
  expect as storybookExpect,
  userEvent,
  waitFor,
  within,
} from 'storybook/test'

import { button, createActor, role } from '../../../.storybook/helpers'
import type { OtlpAdmin } from '../../otlp'
import { ADMIN_FRAME } from '../../root'
import { getAdminRoot } from '../../testing/admin-root'
import { renderOtlpChrome } from './boot'

// Storybook and the workspace's Vitest currently load different assertion typings.
const expect = storybookExpect as unknown as (typeof import('vitest'))['expect']
const I = createActor()
const ms = (value: number) => String(BigInt(value) * 1_000_000n)
const span = (
  name: string,
  frame: string,
  start: number,
  causes: string[] = [],
  spanId = frame,
) => ({
  name,
  traceId: 'trace',
  spanId,
  startTimeUnixNano: ms(start),
  endTimeUnixNano: ms(start + 8),
  attributes: {
    'reatom.name': name,
    'reatom.kind': name === 'total' ? 'computed' : 'action',
    'reatom.frame.id': frame,
    'reatom.cause.ids': causes,
  },
})
let admin: OtlpAdmin
const meta = {
  title: 'OTLP/Causal timeline',
  tags: ['@smoke'],
  parameters: { layout: 'fullscreen', vitest: { testTimeout: 30_000 } },
  beforeEach: (context) => void I.init(context),
  render: () =>
    renderOtlpChrome(
      [
        span('total', '3', 0, ['1', '2']),
        span('quantity', '1', 20),
        span('price', '2', 30),
      ],
      { 'service.name': 'causal-diamond' },
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const DiamondAndSectionControls: Story = {
  name: 'Two causes converge on one row and section changes preserve it',
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    await I.within(role('main').within(root), async () => {
      const row = await I.see(role('row', 'total').wait())
      await I.click(role('row', 'total'))
      await I.seeAttribute(role('row', 'total'), 'aria-selected', 'true')
      expect(row.getAttribute('aria-description')).toContain('Clock skew')
      const rows = ui
        .getAllByRole('row')
        .filter((element: HTMLElement) =>
          element.hasAttribute('data-causal-row'),
        )
      expect(
        rows.map((element: HTMLElement) => element.getAttribute('aria-label')),
      ).toEqual(['quantity', 'price', 'total'])
      expect(row.querySelectorAll('[data-causal-edge]')).toHaveLength(1)
      expect(
        row
          .querySelector('[data-causal-edge]')
          ?.getAttribute('data-branch-relations'),
      ).toBe('2')
      expect(
        row.querySelector('[data-kind-mark]')?.getAttribute('data-kind'),
      ).toBe('computed')
      expect(row.textContent?.includes('computed')).toBe(false)
      expect(
        ui
          .getByRole('row', { name: 'quantity' })
          .querySelector('[data-kind-mark]')
          ?.getAttribute('data-kind'),
      ).toBe('action')
      const checkRailEndpoints = () => {
        const graph = row.querySelector('[role="gridcell"]')!,
          dot = graph.querySelector('[data-causal-node]')!,
          bounds = dot.getBoundingClientRect(),
          center = bounds.left + bounds.width / 2
        expect(center).toBeCloseTo(graph.getBoundingClientRect().right - 12, 0)
        for (const edge of graph.querySelectorAll<SVGPathElement>(
          '[data-causal-edge]',
        )) {
          const endpoint = edge.getPointAtLength(0),
            point = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(
              edge.getScreenCTM()!,
            )
          expect(point.x).toBeCloseTo(center, 0)
          expect(point.y).toBeCloseTo(bounds.top + bounds.height / 2, 0)
        }
      }
      checkRailEndpoints()
      const scroller = ui.getByRole('grid', { name: 'Causal records' })
      const original = scroller
      const checkSectionGeometry = () => {
        const keys = ['Graph', 'Logs', 'Time'] as const
        const active = keys.map(
          (key) =>
            ui
              .getByRole('button', { name: `${key} section` })
              .getAttribute('aria-pressed') === 'true',
        )
        const cells = Array.from(
          row.querySelectorAll<HTMLElement>('[role="gridcell"]'),
        )
        const headers = ui.getAllByRole('columnheader')
        const minima = keys.reduce(
          (sum, key, index) =>
            sum +
            (active[index]
              ? Number(
                  ui
                    .getByRole('separator', { name: `Resize ${key} column` })
                    .getAttribute('aria-valuenow'),
                )
              : 0),
          0,
        )
        const expectedWidth = Math.max(scroller.clientWidth, minima)
        expect(row.getBoundingClientRect().width).toBeCloseTo(expectedWidth, 0)
        let headerIndex = 0
        for (let index = 0; index < keys.length; index++) {
          if (active[index]) {
            const header = headers[headerIndex++]!.getBoundingClientRect()
            const cell = cells[index]!.getBoundingClientRect()
            expect(cell.width).toBeCloseTo(header.width, 0)
            expect(cell.left).toBeCloseTo(header.left, 0)
            const handle = ui
              .getByRole('separator', { name: `Resize ${keys[index]} column` })
              .getBoundingClientRect()
            expect(handle.left + handle.width / 2).toBeCloseTo(header.right, 0)
          } else expect(cells[index]!.getBoundingClientRect().width).toBe(0)
        }
        const last = active.lastIndexOf(true)
        expect(cells[last]!.getBoundingClientRect().right).toBeCloseTo(
          row.getBoundingClientRect().right,
          0,
        )
        expect(row.getBoundingClientRect().height).toBe(
          active[1] && !active[2] ? 36 : 26,
        )
        if (active[0]) {
          checkRailEndpoints()
          const dot = row
            .querySelector('[data-causal-node]')!
            .getBoundingClientRect()
          expect(dot.top + dot.height / 2).toBeCloseTo(
            row.getBoundingClientRect().top +
              row.getBoundingClientRect().height / 2,
            0,
          )
        }
      }
      await waitFor(checkSectionGeometry)
      // Every nonempty section combination keeps the same mounted event row.
      for (const key of [
        'Graph',
        'Logs',
        'Graph',
        'Time',
        'Logs',
        'Graph',
        'Time',
        'Logs',
        'Graph',
      ]) {
        await I.click(button(`${key} section`))
        expect(ui.getByRole('row', { name: 'total' })).toBe(row)
        expect(ui.getByRole('grid', { name: 'Causal records' })).toBe(original)
        await waitFor(checkSectionGeometry)
      }
      // Restore all sections before exercising the splitter from its keyboard.
      for (const key of ['Graph', 'Logs', 'Time']) {
        const control = ui.getByRole('button', { name: `${key} section` })
        if (control.getAttribute('aria-pressed') === 'false')
          await I.click(button(`${key} section`))
      }
      const splitter = ui.getByRole('separator', { name: 'Resize Logs column' })
      const before = Number(splitter.getAttribute('aria-valuenow'))
      splitter.focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(Number(splitter.getAttribute('aria-valuenow'))).toBe(before + 16)
      expect(ui.getByRole('row', { name: 'total' })).toBe(row)
      const graphSplitter = ui.getByRole('separator', {
        name: 'Resize Graph column',
      })
      graphSplitter.focus()
      await userEvent.keyboard('{ArrowLeft}')
      checkRailEndpoints()
      if (import.meta.env['VITEST']) {
        // A real provider drag exercises native pointer capture; synthetic
        // Testing Library pointer events do not own browser pointer IDs.
        const { userEvent: browserUserEvent } = await import('vitest/browser')
        await browserUserEvent.dragAndDrop(
          splitter,
          ui.getByRole('separator', { name: 'Resize Graph column' }),
        )
        expect(Number(splitter.getAttribute('aria-valuenow'))).toBe(160)
        expect(ui.getByRole('row', { name: 'total' })).toBe(row)
      }
      await userEvent.dblClick(graphSplitter)
      expect(Number(graphSplitter.getAttribute('aria-valuenow'))).toBe(116)
      await userEvent.dblClick(splitter)
      const fittedLogs = Number(splitter.getAttribute('aria-valuenow'))
      expect(fittedLogs).toBeGreaterThanOrEqual(160)
      expect(fittedLogs).toBeLessThanOrEqual(800)
      splitter.focus()
      await userEvent.keyboard('{ArrowRight}{Home}')
      expect(Number(splitter.getAttribute('aria-valuenow'))).toBe(fittedLogs)
      await userEvent.dblClick(
        ui.getByRole('separator', { name: 'Resize Time column' }),
      )
      await waitFor(checkSectionGeometry)
      await I.click(button('Waterfall'))
      await I.see(button('Expand all').wait())
      await I.click(button('Causal'))
      await I.seeAttribute(role('row', 'total').wait(), 'aria-selected', 'true')
    })
  },
}

export const ResizeFillMinimum: Story = {
  name: 'Column resizing respects fill limits and browser chords without changing saved widths',
  play: async () => {
    if (import.meta.env['VITEST']) {
      const { page } = await import('vitest/browser')
      await page.viewport(2600, 760)
    }
    const root = getAdminRoot(),
      ui = within(root)
    const row = await I.see(role('row', 'total').within(root).wait())
    const grid = ui.getByRole('grid', { name: 'Causal records' })
    const time = ui.getByRole('separator', { name: 'Resize Time column' })
    await waitFor(() =>
      expect(Number(time.getAttribute('aria-valuenow'))).toBeGreaterThan(420),
    )
    const fill = Number(time.getAttribute('aria-valuenow'))
    expect(Number(time.getAttribute('aria-valuemin'))).toBe(fill)
    expect(Number(time.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(
      fill,
    )
    time.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(Number(time.getAttribute('aria-valuenow'))).toBe(fill)

    const logs = ui.getByRole('separator', { name: 'Resize Logs column' })
    for (const flags of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Home',
        bubbles: true,
        cancelable: true,
        ...flags,
      })
      logs.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(Number(logs.getAttribute('aria-valuenow'))).toBe(300)
    }
    await I.click(role('row', 'total').within(root))
    await waitFor(() =>
      expect(row.getBoundingClientRect().width).toBeCloseTo(
        Math.max(grid.clientWidth, 836),
        0,
      ),
    )
    await I.click(button('Close record details').within(root))
    await I.click(button('Logs section').within(root))
    await I.click(button('Time section').within(root))
    const graph = ui.getByRole('separator', { name: 'Resize Graph column' })
    const graphFill = Number(graph.getAttribute('aria-valuenow'))
    expect(Number(graph.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(
      graphFill,
    )
    graph.focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(Number(graph.getAttribute('aria-valuenow'))).toBe(graphFill)
    await I.click(button('Logs section').within(root))
    await I.click(button('Time section').within(root))
    expect(Number(graph.getAttribute('aria-valuenow'))).toBe(116)
    await I.click(role('row', 'total').within(root))
    await waitFor(() =>
      expect(row.getBoundingClientRect().width).toBeCloseTo(
        Math.max(grid.clientWidth, 836),
        0,
      ),
    )
  },
}

export const HiddenSelectionAndBridges: Story = {
  name: 'A filter bridges hidden causes while the selected record stays inspectable',
  render: () =>
    renderOtlpChrome(
      [
        span('visible cause', '1', 10),
        span('hidden middle', '2', 20, ['1']),
        span('visible effect', '3', 30, ['2']),
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    await I.within(role('main').within(root), async () => {
      await I.click(role('row', 'hidden middle').wait())
      const search = ui.getByRole('searchbox', { name: /name/i })
      await userEvent.type(search, 'visible')
      await waitFor(() => {
        expect(ui.queryByRole('row', { name: 'hidden middle' })).toBeNull()
        expect(
          ui.getByRole('row', { name: 'visible effect' }).textContent,
        ).toContain('+1 hidden')
      })
      expect(ui.getByText(/Selected record is hidden/)).toBeTruthy()
      await I.click(button('Reveal selected record'))
      await I.seeAttribute(
        role('row', 'hidden middle').wait(),
        'aria-selected',
        'true',
      )
    })
  },
}

export const PendingPromotion: Story = {
  name: 'A selected pending span completes without replacing its row',
  render: () =>
    renderOtlpChrome(
      [
        {
          traceId: 'trace',
          spanId: 'pending',
          eventName: 'reatom.log',
          body: 'working',
          timeUnixNano: ms(50),
        },
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    await I.within(role('main').within(root), async () => {
      const row = await I.see(role('row', 'In progress').wait())
      await I.click(role('row', 'In progress'))
      ADMIN_FRAME.run(() =>
        admin.ingest([span('completed task', '9', 10, [], 'pending')]),
      )
      const completed = await I.see(role('row', 'completed task').wait())
      expect(completed).toBe(row)
      expect(completed.getAttribute('aria-selected')).toBe('true')
      expect(ui.queryByRole('row', { name: 'In progress' })).toBeNull()
    })
  },
}

export const NarrowAndLastRow: Story = {
  name: 'A narrow shell scrolls through all records without losing its row alignment',
  render: () =>
    renderOtlpChrome(
      Array.from({ length: 150 }, (_, index) =>
        span(
          `event ${index}`,
          String(index),
          index * 10,
          index ? [String(index - 1)] : [],
        ),
      ),
      {},
      {
        width: 560,
        height: 760,
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    const grid = await waitFor(() =>
      ui.getByRole('grid', { name: 'Causal records' }),
    )
    await waitFor(() =>
      expect(ui.getByRole('row', { name: 'event 149' })).toBeTruthy(),
    )
    // bindScroller aligns the browser after its spacer layout in a frame.
    await waitFor(() =>
      expect(
        grid.scrollHeight - grid.clientHeight - grid.scrollTop,
      ).toBeLessThanOrEqual(1),
    )
    ADMIN_FRAME.run(() => {
      admin.followLive.setFalse()
      admin.causal.virtual.scrollToIndex(50, 'start')
    })
    await waitFor(() =>
      expect(ui.getByRole('row', { name: 'event 50' })).toBeTruthy(),
    )
    // Wait for the scroll request, then keep that exact browser anchor on arrival.
    await waitFor(() =>
      expect(Math.abs(grid.scrollTop - 50 * 26)).toBeLessThanOrEqual(1),
    )
    const anchored = ui.getByRole('row', { name: 'event 50' }),
      offset = grid.scrollTop
    await I.click(button('Time section').within(root))
    await waitFor(() => {
      expect(Math.abs(grid.scrollTop - 50 * 36)).toBeLessThanOrEqual(1)
      expect(anchored.getBoundingClientRect().height).toBe(36)
      expect(ui.getByRole('row', { name: 'event 50' })).toBe(anchored)
    })
    await I.click(button('Time section').within(root))
    await waitFor(() => expect(grid.scrollTop).toBe(offset))
    ADMIN_FRAME.run(() =>
      admin.ingest([span('event 150', '150', 1500, ['149'])]),
    )
    await waitFor(() =>
      expect(
        ui.getByRole('button', { name: 'Follow live' }).textContent,
      ).toContain('1 new'),
    )
    expect(grid.scrollTop).toBe(offset)
    expect(ui.getByRole('row', { name: 'event 50' })).toBe(anchored)
    await I.click(button('Follow live').within(root))
    await waitFor(() =>
      expect(ui.getByRole('row', { name: 'event 150' })).toBeTruthy(),
    )
    await waitFor(() =>
      expect(
        grid.scrollHeight - grid.clientHeight - grid.scrollTop,
      ).toBeLessThanOrEqual(1),
    )
    const last = ui.getByRole('row', { name: 'event 150' })
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      grid.getBoundingClientRect().bottom + 1,
    )
    await I.click(button('Time section').within(root))
    await waitFor(() => {
      expect(last.getBoundingClientRect().height).toBe(36)
      expect(
        grid.scrollHeight - grid.clientHeight - grid.scrollTop,
      ).toBeLessThanOrEqual(1)
      expect(
        ui
          .getByRole('button', { name: 'Follow live' })
          .getAttribute('aria-pressed'),
      ).toBe('true')
    })
    await I.click(button('Time section').within(root))
    await waitFor(() => {
      expect(last.getBoundingClientRect().height).toBe(26)
      expect(
        grid.scrollHeight - grid.clientHeight - grid.scrollTop,
      ).toBeLessThanOrEqual(1)
    })
    const before = last
    await I.within(role('main').within(root), async () => {
      await I.click(button('Logs section'))
      await I.click(button('Time section'))
      await I.seeDisabled(button('Graph section'))
      expect(ui.getByRole('row', { name: 'event 150' })).toBe(before)
    })
  },
}

export const FastNativeScrolling: Story = {
  name: 'Fast native scrolls keep rows covering the viewport before the window catches up',
  render: () =>
    renderOtlpChrome(
      Array.from({ length: 600 }, (_, index) =>
        span(`scroll event ${index}`, String(index), index * 10),
      ),
      {},
      {
        width: 880,
        height: 760,
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    const grid: HTMLElement = await I.see(
      role('grid', 'Causal records').within(root).wait(),
    )
    ADMIN_FRAME.run(() => {
      admin.followLive.setFalse()
      admin.causal.virtual.scrollToIndex(100, 'start')
    })
    await waitFor(() => expect(grid.scrollTop).toBe(100 * 26))
    await I.see(role('row', 'scroll event 100').within(root).wait())
    const checkCoverage = () => {
      const top = grid.getBoundingClientRect().top + grid.clientTop,
        bottom = top + grid.clientHeight
      const rows = Array.from(
        grid.querySelectorAll<HTMLElement>('[data-causal-row]'),
        (row) => row.getBoundingClientRect(),
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThan(60)
      expect(Math.min(...rows.map((rect) => rect.top))).toBeLessThanOrEqual(
        top + 1,
      )
      expect(
        Math.max(...rows.map((rect) => rect.bottom)),
      ).toBeGreaterThanOrEqual(bottom - 1)
    }
    for (const height of [26, 36]) {
      if (height === 36) {
        await I.click(button('Time section').within(root))
        await waitFor(() =>
          expect(
            ui
              .getByRole('row', { name: 'scroll event 100' })
              .getBoundingClientRect().height,
          ).toBe(36),
        )
      }
      for (const index of [400, 20, 550, 100]) {
        // Browser scrolling moves the viewport immediately. Its scroll event
        // and the virtualizer's next frame have not run yet: this is the gap
        // that settled waitFor-only tests cannot observe.
        grid.scrollTop = index * height
        checkCoverage()
        await waitFor(() =>
          expect(
            ui.getByRole('row', { name: `scroll event ${index}` }),
          ).toBeTruthy(),
        )
        await waitFor(checkCoverage)
      }
    }
  },
}

export const FollowReturnsAtBottom: Story = {
  name: 'Scrolling back to the bottom resumes Follow in either row density',
  render: FastNativeScrolling.render,
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    const grid: HTMLElement = await I.see(
      role('grid', 'Causal records').within(root).wait(),
    )
    await I.within(role('main').within(root), async () => {
      const follow = ui.getByRole('button', { name: 'Follow live' })
      if (follow.getAttribute('aria-pressed') !== 'true')
        await I.click(button('Follow live'))
      for (const height of [26, 36]) {
        if (height === 36) await I.click(button('Time section'))
        await waitFor(() =>
          expect(
            grid.scrollHeight - grid.clientHeight - grid.scrollTop,
          ).toBeLessThanOrEqual(1),
        )
        grid.scrollTop -= height * 4
        await waitFor(() =>
          expect(follow.getAttribute('aria-pressed')).toBe('false'),
        )
        grid.scrollTop = grid.scrollHeight
        await waitFor(() =>
          expect(follow.getAttribute('aria-pressed')).toBe('true'),
        )
        await I.see(role('row', 'scroll event 599').wait())
      }
    })
  },
}

export const PassingRails: Story = {
  name: 'Rails cross the mounted window when both endpoints are offscreen',
  render: () =>
    renderOtlpChrome(
      Array.from({ length: 120 }, (_, index) =>
        span(
          `record ${index + 1}`,
          String(index + 1),
          index * 10,
          index >= 110 ? [String(index - 109)] : [],
        ),
      ),
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    ADMIN_FRAME.run(() => {
      admin.followLive.setFalse()
      admin.causal.virtual.scrollToIndex(50, 'start')
    })
    await waitFor(() => {
      const middle = ui.getByRole('row', { name: 'record 51' })
      expect(middle.querySelectorAll('[data-causal-bus]')).toHaveLength(4)
      expect(ui.queryByRole('row', { name: 'record 1' })).toBeNull()
      expect(ui.queryByRole('row', { name: 'record 111' })).toBeNull()
      expect(
        ui.getByRole('columnheader', { name: /Graph/ }).textContent,
      ).toContain('4 tracks')
      expect(ui.getByText('6 relationships summarized')).toBeTruthy()
    })
    const grid = ui.getByRole('grid', { name: 'Causal records' })
    await waitFor(() => expect(grid.scrollTop).toBe(50 * 26))
    const strip = root.querySelector<HTMLElement>(
      '[aria-label="Graph continuations"]',
    )!
    const controls = within(strip).getAllByRole('button')
    controls[0]!.focus()
    strip.scrollLeft = 24
    const horizontal = strip.scrollLeft
    for (const offset of [50 * 26 + 1, 50 * 26 + 12, 51 * 26 + 5]) {
      ADMIN_FRAME.run(() => admin.causal.virtual.scrollTo(offset))
      await waitFor(() => expect(grid.scrollTop).toBe(offset))
      expect(root.querySelector('[aria-label="Graph continuations"]')).toBe(
        strip,
      )
      expect(within(strip).getAllByRole('button')).toEqual(controls)
      expect((root.getRootNode() as ShadowRoot).activeElement).toBe(controls[0])
      expect(strip.scrollLeft).toBe(horizontal)
    }
    await I.within(role('main').within(root), async () => {
      const splitter = ui.getByRole('separator', {
        name: 'Resize Graph column',
      })
      splitter.focus()
      await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(
        ui.getByRole('columnheader', { name: /Graph/ }).textContent,
      ).toContain('2 tracks')
      await I.click(button('Expand graph column'))
      await I.see(role('row', 'record 51'))
      expect(
        ui.getByRole('columnheader', { name: /Graph/ }).textContent,
      ).toContain('4 tracks')
    })
  },
}

export const FullDirectedChain: Story = {
  name: 'Selection highlights the whole directed chain and leaves side branches neutral',
  render: () =>
    renderOtlpChrome(
      [
        span('root cause', '1', 0),
        span('parent cause', '2', 1, ['1']),
        span('side sibling', '3', 2, ['2']),
        span('co-cause', '4', 3),
        span('selected target', '5', 4, ['2']),
        span('next effect', '6', 5, ['5', '4', '2']),
        span('last effect', '7', 6, ['6']),
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    await I.click(role('row', 'selected target').within(root).wait())
    const grid = ui.getByRole('grid', { name: 'Causal records' })
    for (const name of [
      'root cause',
      'parent cause',
      'next effect',
      'last effect',
    ])
      expect(
        ui.getByRole('row', { name }).getAttribute('data-causal-related'),
      ).toBe('true')
    for (const name of ['side sibling', 'co-cause'])
      expect(
        ui.getByRole('row', { name }).getAttribute('data-causal-related'),
      ).toBeNull()
    const parent: HTMLElement = ui.getByRole('row', { name: 'parent cause' })
    // Parent's star also contains a sibling and a parent→effect bypass.
    // Those member branches must stay neutral even though its trunk is active.
    const parentBus = parent
      .querySelector('[data-causal-edge][data-branch-relations="3"]')!
      .getAttribute('data-causal-edge')!
    for (const name of ['side sibling', 'next effect']) {
      const row = ui.getByRole('row', { name })
      const active = Array.from(
        row.querySelectorAll('[data-causal-highlight-branch]'),
      ) as Element[]
      expect(
        active.some(
          (edge) =>
            edge.getAttribute('data-causal-highlight-branch') === parentBus,
        ),
      ).toBe(false)
    }
    const before = ui.getByRole('row', { name: 'last effect' })
    await I.click(button('Graph section').within(root))
    expect(ui.getByRole('row', { name: 'last effect' })).toBe(before)
    expect(before.getAttribute('data-causal-related')).toBe('true')
    expect(ui.getByRole('grid', { name: 'Causal records' })).toBe(grid)
    expect(grid.getAttribute('aria-rowcount')).toBe('8')
  },
}

export const StableFilterCounters: Story = {
  name: 'Filter counters grow without moving controls or the timeline',
  globals: { viewport: { value: 'wide', isRotated: false } },
  render: () =>
    renderOtlpChrome(
      [],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    const labels = [
      'Errors',
      'Actions',
      'Atoms',
      'Computed',
      'LOG',
      'Aborted and suspense',
      'Mount logs',
    ]
    const buttons: HTMLElement[] = labels.map((name) =>
      ui.getByRole('button', { name, exact: true }),
    )
    const grid = ui.getByRole('grid', { name: 'Causal records' })
    const measure = () =>
      [...buttons, buttons[0]!.parentElement!, grid].map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return [x, y, width, height]
      })
    const before = measure()
    let previous = 0
    for (const count of [1, 9, 10, 99, 100, 999, 1000]) {
      const records = Array.from({ length: count - previous }, (_, delta) => {
        const i = previous + delta,
          action = span(`counter action ${i}`, `a-${i}`, i)
        const update = (kind: string, mount = false) => ({
          eventName: `reatom.${kind}.update`,
          traceId: 'trace',
          spanId: `a-${i}`,
          timeUnixNano: ms(i),
          body: '0',
          attributes: {
            'reatom.name': `${mount ? 'mount' : kind} ${i}`,
            'reatom.kind': kind,
            'reatom.frame.id': `${mount ? 'mount' : kind}-${i}`,
            'reatom.cause.ids': mount ? [] : [`a-${i}`],
          },
        })
        return [
          { ...action, status: { code: 2, message: 'counter error' } },
          {
            ...span(`aborted ${i}`, `abort-${i}`, i),
            attributes: {
              'reatom.kind': 'action',
              'reatom.outcome': 'abort',
              'reatom.frame.id': `abort-${i}`,
            },
          },
          update('atom'),
          update('computed'),
          update('computed', true),
          {
            eventName: 'reatom.log',
            traceId: 'trace',
            spanId: `a-${i}`,
            timeUnixNano: ms(i),
            body: 'counter log',
          },
        ]
      }).flat()
      ADMIN_FRAME.run(() => admin.ingest(records))
      await waitFor(() =>
        expect(buttons[6]!.getAttribute('title')).toContain(
          `Mount logs: ${count}.`,
        ),
      )
      expect(measure()).toEqual(before)
      labels.forEach((name, index) =>
        expect(ui.getByRole('button', { name, exact: true })).toBe(
          buttons[index],
        ),
      )
      previous = count
    }
    // Exercise the compact display threshold as well as ordinary digit growth.
    ADMIN_FRAME.run(() =>
      admin.ingest(
        Array.from({ length: 10_001 }, (_, i) => ({
          eventName: 'reatom.log',
          traceId: 'trace',
          spanId: 'a-0',
          timeUnixNano: ms(2000 + i),
          body: 'more logs',
        })),
      ),
    )
    await waitFor(() =>
      expect(buttons[4]!.getAttribute('title')).toBe('LOG: 14001'),
    )
    expect(measure()).toEqual(before)
    expect(buttons[4]!.textContent).toContain('14K')
  },
}

export const StableFilterCountersNarrow: Story = {
  ...StableFilterCounters,
  name: 'Filter counter growth preserves the wrapped narrow layout',
  globals: { viewport: { value: 'narrow', isRotated: false } },
}

export const SharedBusWithAThousandEffects: Story = {
  name: 'A thousand effects share one bus and remain individually searchable',
  render: () =>
    renderOtlpChrome(
      [
        span('themeAtom', 'theme', 0),
        ...Array.from({ length: 1000 }, (_, index) =>
          span(`theme effect ${index}`, `effect-${index}`, index + 1, [
            'theme',
          ]),
        ),
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    ADMIN_FRAME.run(() => {
      admin.followLive.setFalse()
      admin.causal.virtual.scrollToIndex(0, 'start')
    })
    const anchor = await I.see(role('row', 'themeAtom').within(root).wait())
    expect(
      ui
        .getByRole('grid', { name: 'Causal records' })
        .getAttribute('aria-rowcount'),
    ).toBe('1002')
    expect(
      ui.getByRole('columnheader', { name: /Graph/ }).textContent,
    ).toContain('1 track')
    expect(root.querySelectorAll('[data-causal-bus]').length).toBeLessThan(60)
    expect(
      anchor
        .querySelector('[data-causal-edge]')
        ?.getAttribute('data-branch-relations'),
    ).toBe('1000')
    const portal = await I.see(
      button('1000 recorded effects of themeAtom').within(root),
    )
    portal.focus()
    await userEvent.keyboard(' ')
    await waitFor(() =>
      expect(
        ui.getByText('0 recorded causes · 1000 recorded effects'),
      ).toBeTruthy(),
    )
    const list = ui.getByRole('list', { name: 'Related records' })
    expect(within(list).getAllByRole('listitem').length).toBeLessThan(12)
    await I.fill(
      role('searchbox', 'Find related record').within(root),
      'theme effect 999',
    )
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')).toHaveLength(1),
    )
    await I.click(button('Trace theme effect 999').within(root))
    expect(ui.getByRole('row', { name: 'themeAtom' })).toBe(anchor)
    expect(root.querySelectorAll('[data-causal-trace]').length).toBeGreaterThan(
      0,
    )
    await I.click(button('Graph section').within(root))
    await I.seeDisabled(button('Trace theme effect 999').within(root))
    await I.click(button('Graph section').within(root))
    await I.click(button('Go to theme effect 999').within(root))
    await I.seeAttribute(
      role('row', 'theme effect 999').within(root).wait(),
      'aria-selected',
      'true',
    )
  },
}

export const SharedBusWithAThousandCauses: Story = {
  name: 'A convergence bus names its computed below the viewport',
  render: () =>
    renderOtlpChrome(
      [
        ...Array.from({ length: 1000 }, (_, index) =>
          span(`input ${index}`, `input-${index}`, index),
        ),
        span(
          'total',
          'total',
          1001,
          Array.from({ length: 1000 }, (_, index) => `input-${index}`),
        ),
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    ADMIN_FRAME.run(() => {
      admin.followLive.setFalse()
      admin.causal.virtual.scrollToIndex(0, 'start')
    })
    await I.see(role('row', 'input 0').within(root).wait())
    await I.click(button('Go to total below').within(root).wait())
    await I.seeAttribute(
      role('row', 'total').within(root).wait(),
      'aria-selected',
      'true',
    )
    await I.click(button('1000 recorded causes of total').within(root))
    await waitFor(() =>
      expect(
        ui.getByText('1000 recorded causes · 0 recorded effects'),
      ).toBeTruthy(),
    )
    expect(
      within(ui.getByRole('list', { name: 'Related records' })).getAllByRole(
        'listitem',
      ).length,
    ).toBeLessThan(12)
  },
}

export const IndependentBusCrossovers: Story = {
  name: 'Independent buses cross without inventing a causal junction',
  render: () =>
    renderOtlpChrome(
      [
        span('hub A', 'A', 0),
        span('hub B', 'B', 1),
        span('effect A1', 'A1', 2, ['A']),
        span('effect B1', 'B1', 3, ['B']),
        span('effect A2', 'A2', 4, ['A']),
        span('effect B2', 'B2', 5, ['B']),
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    const second = await I.see(role('row', 'hub B').within(root).wait())
    const before = Array.from(
      root.querySelectorAll('[data-causal-bus]'),
      (edge) => edge.getAttribute('data-causal-bus'),
    )
    expect(second.querySelector('[data-causal-crossover]')).toBeTruthy()
    expect(second.querySelector('[data-causal-tap]')).toBeTruthy()
    await I.click(role('row', 'hub A').within(root))
    expect(
      Array.from(root.querySelectorAll('[data-causal-bus]'), (edge) =>
        edge.getAttribute('data-causal-bus'),
      ),
    ).toEqual(before)
    expect(
      ui
        .getByRole('row', { name: 'effect A1' })
        .getAttribute('data-causal-related'),
    ).toBe('true')
    expect(
      ui
        .getByRole('row', { name: 'hub B' })
        .getAttribute('data-causal-related'),
    ).toBeNull()
    expect(
      ui
        .getByRole('grid', { name: 'Causal records' })
        .getAttribute('aria-rowcount'),
    ).toBe('7')
  },
}

export const IncomingAndOutgoingBuses: Story = {
  name: 'Incoming and outgoing buses stay distinct at a selected record',
  render: () =>
    renderOtlpChrome(
      [
        span('parent', '1', 0),
        span('selected computed', '2', 1, ['1']),
        span('later sibling', '3', 2, ['1']),
        span('first effect', '4', 3, ['1', '2']),
        span('second effect', '5', 4, ['2']),
        span('third effect', '6', 5, ['2']),
      ],
      {},
      {
        onReady: (app) => {
          admin = app.admin
        },
      },
    ),
  play: async () => {
    const root = getAdminRoot(),
      ui = within(root)
    await I.click(role('row', 'selected computed').within(root).wait())
    const row: HTMLElement = ui.getByRole('row', { name: 'selected computed' })
    const trunks = Array.from(
      row.querySelectorAll<SVGPathElement>('[data-causal-highlight]'),
    )
    expect(trunks).toHaveLength(2)
    expect(new Set(trunks.map((path) => path.getBBox().x)).size).toBe(2)
    // Incoming emphasis stops at the event center even though the neutral
    // parent bus continues to a later sibling. The outgoing bus starts there.
    const ordered = trunks
      .map((path) => path.getBBox())
      .sort((a, b) => a.y - b.y)
    expect(ordered[0]!.y + ordered[0]!.height).toBe(13)
    expect(ordered[1]!.y).toBe(13)
    const effect = ui.getByRole('row', { name: 'first effect' })
    const emphasis = effect.querySelector('[data-causal-highlight-branch]')!
    // A neutral nearer branch must not paint over the selected farther branch.
    for (const neutral of effect.querySelectorAll('[data-causal-edge]'))
      expect(
        neutral.compareDocumentPosition(emphasis) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    expect(
      ui
        .getByRole('row', { name: 'later sibling' })
        .getAttribute('data-causal-related'),
    ).toBeNull()
    await I.click(button('Time section').within(root))
    await waitFor(() => {
      const expanded = Array.from(
        row.querySelectorAll<SVGPathElement>('[data-causal-highlight]'),
      )
        .map((path) => path.getBBox())
        .sort((a, b) => a.y - b.y)
      expect(row.getBoundingClientRect().height).toBe(36)
      expect(expanded[0]!.y + expanded[0]!.height).toBe(18)
      expect(expanded[1]!.y).toBe(18)
    })
    await I.click(button('1 recorded causes of selected computed').within(root))
    await I.click(button('Trace parent').within(root))
    const traces = root.querySelectorAll('[data-causal-trace]')
    expect(traces.length).toBeGreaterThan(0)
    for (const trace of traces)
      expect(
        trace.previousElementSibling?.hasAttribute('data-causal-trace-halo'),
      ).toBe(true)
    expect(row.getAttribute('aria-selected')).toBe('true')
  },
}
