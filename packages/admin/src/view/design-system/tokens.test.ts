import { expect, test } from 'test'

import { paletteVars } from './palette'
import { adminThemeVars } from './tokens'

test('the default dark accent keeps the original dusk sheet', () => {
  expect(adminThemeVars).toContain('--admin-canvas: oklch(0.16 0.02 245)')
  expect(adminThemeVars).toContain('--admin-accent: oklch(0.75 0.14 300)')
  expect(paletteVars('#bc98f9', 'dark')['--admin-canvas']).toBe(
    'oklch(0.16 0.02 245)',
  )
})

test('a picked hue tints the calculated palette', () => {
  const dark = paletteVars('#c2410c', 'dark')
  const light = paletteVars('#c2410c', 'light')
  expect(dark['--admin-accent']).not.toContain(' 300')
  expect(light['--admin-canvas'].startsWith('oklch(0.985')).toBe(true)
  expect(dark['--admin-canvas'].startsWith('oklch(0.160')).toBe(true)
})
