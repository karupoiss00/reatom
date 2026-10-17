import { expect, test } from 'test'

import { hueDistance, parseOklch, paletteVars } from './palette'
import {
  adminThemeVars,
  barFilled,
  barHatch,
  barHollow,
  barTick,
  kindPill,
  kindStripe,
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
  const error = parseOklch(dark['--admin-error'])
  const warning = parseOklch(dark['--admin-warning'])
  const accent = parseOklch(dark['--admin-accent'])
  expect(error?.h).toBeCloseTo(25, 0)
  expect(warning?.h).toBeCloseTo(85, 0)
  expect(accent?.h).toBeCloseTo(300, 0)
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
