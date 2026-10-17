import { expect, test } from 'test'

import {
  hueDistance,
  parseOklch,
  paletteVars,
  resolveHostSignals,
} from './palette'
import {
  adminThemeVars,
  barFilled,
  barHatch,
  barHollow,
  barTick,
  kindPill,
  kindStripe,
  tokens,
} from './tokens'

test('the default dark accent uses violet-tinted neutrals', () => {
  const canvas = paletteVars('#bc98f9', 'dark')['--admin-canvas']
  const parsed = parseOklch(canvas)
  expect(parsed).not.toBeNull()
  if (!parsed) return
  expect(parsed.l).toBeCloseTo(0.165, 3)
  expect(parsed.c).toBeLessThanOrEqual(0.016)
  expect(hueDistance(parsed.h, 300)).toBeLessThan(hueDistance(parsed.h, 245))
  expect(adminThemeVars).toContain('--admin-canvas: oklch(0.165 0.012 285)')
  expect(adminThemeVars).toContain('--admin-accent: oklch(0.75 0.14 300)')
  expect(adminThemeVars).toContain('--admin-kind-stripe: 3px')
  expect(adminThemeVars).toContain('--admin-error-wash:')
  expect(adminThemeVars).toContain('--admin-bar-hatch:')
  expect(adminThemeVars).toContain('admin-capture-pulse')
})

test('error, warning, and accent stay three different hues', () => {
  const dark = paletteVars('#bc98f9', 'dark')
  const light = paletteVars('#bc98f9', 'light')
  const error = parseOklch(dark['--admin-error'])
  const warning = parseOklch(dark['--admin-warning'])
  const accent = parseOklch(dark['--admin-accent'])
  expect(error?.h).toBeCloseTo(25, 0)
  expect(warning?.h).toBeCloseTo(85, 0)
  expect(accent?.h).toBeCloseTo(300, 0)
  expect(parseOklch(light['--admin-error'])?.h).toBeCloseTo(25, 0)
  expect(parseOklch(light['--admin-warning'])?.h).toBeCloseTo(85, 0)
  expect(hueDistance(parseOklch(light['--admin-accent'])?.h ?? 0, 305)).toBeLessThan(8)
})

test('the default light accent uses a designed dawn sheet', () => {
  const light = paletteVars('#bc98f9', 'light')
  const canvas = parseOklch(light['--admin-canvas'])
  const text = parseOklch(light['--admin-text-1'])
  const accent = parseOklch(light['--admin-accent'])
  const error = parseOklch(light['--admin-error'])
  const action = parseOklch(light['--admin-kind-action'])
  expect(canvas).not.toBeNull()
  expect(text).not.toBeNull()
  expect(accent).not.toBeNull()
  expect(error).not.toBeNull()
  expect(action).not.toBeNull()
  if (!canvas || !text || !accent || !error || !action) return
  expect(canvas.l).toBeCloseTo(0.985, 3)
  expect(canvas.c).toBeLessThanOrEqual(0.016)
  expect(text.l).toBeCloseTo(0.28, 2)
  expect(accent.l).toBeCloseTo(0.52, 2)
  expect(error.l).toBeCloseTo(0.48, 2)
  expect(action.l).toBeCloseTo(0.48, 2)
  expect(action.c).toBeCloseTo(0.12, 2)
  expect(light['--admin-canvas']).toBe('oklch(0.985 0.004 285)')
  expect(adminThemeVars).toContain('--admin-bar-ink:')
  expect(adminThemeVars).toContain('--admin-graph-dot:')
  expect(adminThemeVars).toContain('--admin-shadow:')
  expect(tokens.barInk).toBe('var(--admin-bar-ink)')
})

test('kind hues do not swap between dark and light', () => {
  const dark = paletteVars('#bc98f9', 'dark')
  const light = paletteVars('#bc98f9', 'light')
  const kinds = [
    '--admin-kind-action',
    '--admin-kind-atom',
    '--admin-kind-computed',
    '--admin-kind-effect',
  ] as const
  for (const key of kinds) {
    const darkHue = parseOklch(dark[key])?.h
    const lightHue = parseOklch(light[key])?.h
    expect(darkHue).toBeDefined()
    expect(lightHue).toBeDefined()
    if (darkHue === undefined || lightHue === undefined) return
    expect(hueDistance(darkHue, lightHue)).toBeLessThan(2)
  }
})

test('match host picks light from a light page background', () => {
  expect(resolveHostSignals('normal', 'rgb(248, 248, 250)')).toBe('light')
  expect(resolveHostSignals('', 'rgb(18, 16, 28)')).toBe('dark')
  expect(resolveHostSignals('light', 'rgb(18, 16, 28)')).toBe('light')
  expect(resolveHostSignals('dark', 'rgb(248, 248, 250)')).toBe('dark')
})

test('a picked hue tints neutrals and still separates kind hues by 22°', () => {
  const dark = paletteVars('#c2410c', 'dark')
  const light = paletteVars('#c2410c', 'light')
  const canvas = parseOklch(dark['--admin-canvas'])
  const accent = parseOklch(dark['--admin-accent'])
  expect(canvas).not.toBeNull()
  expect(accent).not.toBeNull()
  if (!canvas || !accent) return
  expect(canvas.c).toBeLessThanOrEqual(0.016)
  expect(hueDistance(canvas.h, accent.h)).toBeLessThan(8)
  expect(dark['--admin-accent']).not.toContain(' 300')
  expect(light['--admin-canvas'].startsWith('oklch(0.985')).toBe(true)

  const kinds = [
    dark['--admin-kind-action'],
    dark['--admin-kind-atom'],
    dark['--admin-kind-computed'],
    dark['--admin-kind-effect'],
  ].map((value) => parseOklch(value)?.h)
  for (const hue of kinds) {
    expect(hue).toBeDefined()
    if (hue === undefined) return
    expect(hueDistance(hue, accent.h)).toBeGreaterThanOrEqual(22)
  }
})

test('bar paints are one helper, and hatch does not animate', () => {
  expect(barFilled('var(--admin-kind-action)')).toContain('20%')
  expect(barHollow()).toContain('box-shadow: inset 0 0 0 1px')
  expect(barTick()).toContain('width: 2px')
  expect(barHatch).toBe('var(--admin-bar-hatch)')
  expect(adminThemeVars).toContain('repeating-linear-gradient')
  expect(adminThemeVars).not.toMatch(/--admin-bar-hatch:[^;]*animation/)
  expect(kindStripe('var(--admin-kind-action)')).toContain(
    'var(--admin-kind-stripe)',
  )
  expect(kindPill('var(--admin-kind-action)')).toContain('uppercase')
})
