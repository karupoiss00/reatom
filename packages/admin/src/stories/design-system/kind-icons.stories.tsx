import { atom } from '@reatom/core'
import type { Meta, StoryObj } from '@storybook/html'
import { expect } from 'storybook/test'

import { button, createActor, role } from '../../../.storybook/helpers'
import { ADMIN_FRAME } from '../../root'
import { Button, tokens, type as typeRoles } from '../../view/design-system'
import { SettingsSwitch } from '../../view/otlp/SettingsScreen'
import { renderDesignCanvas } from './canvas'
import {
  iconVariants,
  kindColor,
  kindColorVars,
  KindGlyph,
  kindWords,
  MockTimeline,
  recordKinds,
  recordStatuses,
  StatusGlyph,
  statusWords,
  variantById,
  type IconVariant,
  type VariantId,
} from './kind-icons'

const I = createActor()

const meta = {
  title: 'Design System/Kind icons',
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const WIDE = { width: 1280, height: 900 }

const headingCss = `${typeRoles.title} margin: 0;`
const sectionCss = `
  display: grid;
  gap: var(--admin-space-12);
  padding: var(--admin-space-16);
`

const cellCss = `
  padding: var(--admin-space-8);
  border-bottom: 1px solid ${tokens.border1};
  text-align: left;
  vertical-align: middle;
`

const GlyphCell = ({
  variant,
  kind,
}: {
  variant: IconVariant
  kind: (typeof recordKinds)[number]
}) => (
  <td css={cellCss}>
    <span
      css={`
        display: flex;
        align-items: center;
        gap: var(--admin-space-12);
      `}
    >
      <span css={`color: ${tokens.text1};`}>
        <KindGlyph variant={variant} kind={kind} />
      </span>
      <span css={`color: ${kindColor(kind)};`}>
        <KindGlyph variant={variant} kind={kind} />
      </span>
      <span css={`color: ${kindColor(kind)};`}>
        <KindGlyph variant={variant} kind={kind} size={32} />
      </span>
    </span>
  </td>
)

const GlyphSheet = () => (
  <div
    css={`
      ${kindColorVars}
      ${sectionCss}
    `}
  >
    <h1 css={headingCss}>Kind icon variants</h1>
    <p css={`${typeRoles.body} margin: 0; color: ${tokens.text2};`}>
      Each cell shows the glyph at 14px in gray, at 14px in its kind color, and
      zoomed to 32px.
    </p>
    <table
      css={`
        border-collapse: collapse;
        ${typeRoles.ui}
      `}
    >
      <thead>
        <tr>
          <th scope="col" css={cellCss}>
            Kind
          </th>
          {iconVariants.map((variant) => (
            <th scope="col" css={cellCss}>
              {variant.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {recordKinds.map((kind) => (
          <tr>
            <th scope="row" css={cellCss}>
              {kindWords[kind]}
            </th>
            {iconVariants.map((variant) => (
              <GlyphCell variant={variant} kind={kind} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    <div
      css={`
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: var(--admin-space-8);
        ${typeRoles.meta}
        color: ${tokens.text2};
      `}
    >
      {iconVariants.map((variant) => (
        <p css="margin: 0;">{variant.summary}</p>
      ))}
    </div>
    <h2 css={headingCss}>Status glyphs (shared by every variant)</h2>
    <ul
      css={`
        display: flex;
        gap: var(--admin-space-24);
        list-style: none;
        margin: 0;
        padding: 0;
        ${typeRoles.ui}
      `}
    >
      {recordStatuses.map((status) => (
        <li
          css={`
            display: flex;
            align-items: center;
            gap: var(--admin-space-8);
          `}
        >
          <span
            css={`
              color: ${status === 'error' ? tokens.error : tokens.text2};
            `}
          >
            <StatusGlyph status={status} size={20} />
          </span>
          {statusWords[status]}
        </li>
      ))}
    </ul>
  </div>
)

export const Sheet: Story = {
  name: 'Glyph sheet: four variants',
  render: () => ADMIN_FRAME.run(() => renderDesignCanvas(<GlyphSheet />, WIDE)),
  play: async ({ canvasElement }) => {
    expect(canvasElement.textContent).toContain('A · Solid geometric')
    expect(canvasElement.textContent).toContain('D · Rail markers')
    expect(canvasElement.querySelectorAll('tbody tr')).toHaveLength(
      recordKinds.length,
    )
  },
}

const on = () => true

export const SideBySide: Story = {
  name: 'Timeline rows: variants side by side',
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(
        <div css={sectionCss}>
          <h1 css={headingCss}>Timeline rows, Icons on and Colors on</h1>
          <div
            css={`
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: var(--admin-space-16);
            `}
          >
            {iconVariants.map((variant) => (
              <section
                css={`
                  display: grid;
                  gap: var(--admin-space-8);
                  min-width: 0;
                `}
              >
                <h2 css={`${typeRoles.ui} margin: 0;`}>{variant.title}</h2>
                <MockTimeline
                  variant={() => variant}
                  label={`${variant.title} timeline`}
                  icons={on}
                  colors={on}
                />
              </section>
            ))}
          </div>
        </div>,
        { width: 1280, height: 860 },
      ),
    ),
  play: async ({ canvasElement }) => {
    expect(
      canvasElement.querySelectorAll('[data-testid="kind-mock-timeline"]'),
    ).toHaveLength(iconVariants.length)
  },
}

const switchCombos = [
  { title: 'Icons on, Colors on', icons: true, colors: true },
  { title: 'Icons on, Colors off', icons: true, colors: false },
  { title: 'Icons off, Colors on', icons: false, colors: true },
  { title: 'Icons off, Colors off', icons: false, colors: false },
]

export const SwitchMatrix: Story = {
  name: 'Switch matrix: variant A in all four combinations',
  render: () =>
    ADMIN_FRAME.run(() =>
      renderDesignCanvas(
        <div css={sectionCss}>
          <h1 css={headingCss}>Icons and Colors switches</h1>
          <div
            css={`
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: var(--admin-space-16);
            `}
          >
            {switchCombos.map((combo) => (
              <section
                css={`
                  display: grid;
                  gap: var(--admin-space-8);
                  min-width: 0;
                `}
              >
                <h2 css={`${typeRoles.ui} margin: 0;`}>{combo.title}</h2>
                <MockTimeline
                  variant={() => iconVariants[0]!}
                  label={`${combo.title} timeline`}
                  icons={() => combo.icons}
                  colors={() => combo.colors}
                />
              </section>
            ))}
          </div>
        </div>,
        { width: 1280, height: 860 },
      ),
    ),
  play: async ({ canvasElement }) => {
    const timelines = canvasElement.querySelectorAll<HTMLElement>(
      '[data-testid="kind-mock-timeline"]',
    )
    expect([...timelines].map((timeline) => timeline.dataset.icons)).toEqual([
      'true',
      'true',
      'false',
      'false',
    ])
  },
}

export const Playground: Story = {
  name: 'Playground: pick a variant and flip the switches',
  render: () =>
    ADMIN_FRAME.run(() => {
      const variantId = atom<VariantId>('solid', '_Admin.stories.kindIcons.variant')
      const icons = atom(true, '_Admin.stories.kindIcons.icons')
      const colors = atom(true, '_Admin.stories.kindIcons.colors')
      return renderDesignCanvas(
        <div css={sectionCss}>
          <h1 css={headingCss}>Kind icons playground</h1>
          <div
            role="group"
            aria-label="Display"
            css={`
              display: flex;
              flex-wrap: wrap;
              gap: var(--admin-space-8);
            `}
          >
            <SettingsSwitch label="Icons" checked={icons} />
            <SettingsSwitch label="Colors" checked={colors} />
          </div>
          <div
            role="group"
            aria-label="Variant"
            css={`
              display: flex;
              flex-wrap: wrap;
              gap: var(--admin-space-8);
            `}
          >
            {iconVariants.map((variant) => (
              <Button
                variant="ghost"
                label={variant.title}
                pressed={() => variantId() === variant.id}
                onClick={() => variantId.set(variant.id)}
              />
            ))}
          </div>
          <p css={`${typeRoles.meta} margin: 0; color: ${tokens.text2};`}>
            {() => variantById(variantId()).summary}
          </p>
          <MockTimeline
            variant={() => variantById(variantId())}
            label="Playground timeline"
            icons={icons}
            colors={colors}
          />
        </div>,
        { width: 720, height: 640 },
      )
    }),
  play: async ({ canvasElement }) => {
    const timeline = () =>
      canvasElement.querySelector<HTMLElement>(
        '[data-testid="kind-mock-timeline"]',
      )!
    await I.click(role('switch', 'Icons'))
    expect(timeline().dataset.icons).toBe('false')
    expect(timeline().dataset.colors).toBe('true')

    await I.click(role('switch', 'Colors'))
    expect(timeline().dataset.colors).toBe('false')

    await I.click(role('switch', 'Icons'))
    await I.click(role('switch', 'Colors'))
    expect(timeline().dataset.icons).toBe('true')

    await I.click(button('C · Letter badges'))
    expect(
      canvasElement
        .querySelector('[aria-label="C · Letter badges"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
  },
}
