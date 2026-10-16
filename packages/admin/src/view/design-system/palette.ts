export const ADMIN_SCHEME_IDS = ['light', 'dark', 'system'] as const

export type AdminScheme = (typeof ADMIN_SCHEME_IDS)[number]
export type AdminResolvedScheme = 'light' | 'dark'

/** Violet that matches the original dark shell accent. */
export const DEFAULT_ACCENT = '#bc98f9'

const ACCENT_PATTERN = /^#[0-9a-f]{6}$/

export function isAdminAccent(value: string): boolean {
  return ACCENT_PATTERN.test(value)
}

export type AdminPaletteVars = {
  '--admin-canvas': string
  '--admin-surface-1': string
  '--admin-surface-2': string
  '--admin-surface-3': string
  '--admin-text-1': string
  '--admin-text-2': string
  '--admin-text-3': string
  '--admin-border-1': string
  '--admin-border-2': string
  '--admin-accent': string
  '--admin-accent-strong': string
  '--admin-success': string
  '--admin-warning': string
  '--admin-error': string
  '--admin-info': string
  '--admin-kind-action': string
  '--admin-kind-atom': string
  '--admin-kind-computed': string
  '--admin-kind-effect': string
  '--admin-rail-0': string
  '--admin-rail-1': string
  '--admin-rail-2': string
  '--admin-rail-3': string
  '--admin-rail-4': string
  '--admin-rail-5': string
}

const DUSK_VARS: AdminPaletteVars = {
  '--admin-canvas': 'oklch(0.16 0.02 245)',
  '--admin-surface-1': 'oklch(0.185 0.022 245)',
  '--admin-surface-2': 'oklch(0.215 0.025 245)',
  '--admin-surface-3': 'oklch(0.255 0.028 245)',
  '--admin-text-1': 'oklch(0.94 0.012 275)',
  '--admin-text-2': 'oklch(0.73 0.025 275)',
  '--admin-text-3': 'oklch(0.58 0.028 275)',
  '--admin-border-1': 'oklch(0.3 0.025 245)',
  '--admin-border-2': 'oklch(0.4 0.03 245)',
  '--admin-accent': 'oklch(0.75 0.14 300)',
  '--admin-accent-strong': 'oklch(0.66 0.19 300)',
  '--admin-success': 'oklch(0.78 0.16 150)',
  '--admin-warning': 'oklch(0.82 0.16 85)',
  '--admin-error': 'oklch(0.70 0.19 25)',
  '--admin-info': 'oklch(0.74 0.13 235)',
  '--admin-kind-action': 'oklch(0.86 0.15 95)',
  '--admin-kind-atom': 'oklch(0.80 0.13 160)',
  '--admin-kind-computed': 'oklch(0.70 0.11 205)',
  '--admin-kind-effect': 'oklch(0.74 0.15 345)',
  '--admin-rail-0': 'oklch(0.75 0.14 300)',
  '--admin-rail-1': 'oklch(0.74 0.13 235)',
  '--admin-rail-2': 'oklch(0.78 0.14 160)',
  '--admin-rail-3': 'oklch(0.82 0.16 85)',
  '--admin-rail-4': 'oklch(0.72 0.16 30)',
  '--admin-rail-5': 'oklch(0.72 0.18 330)',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function hueDistance(left: number, right: number): number {
  const delta = Math.abs(wrapHue(left) - wrapHue(right))
  return Math.min(delta, 360 - delta)
}

function mixHue(base: number, toward: number, amount: number): number {
  let delta = wrapHue(toward - base)
  if (delta > 180) delta -= 360
  return wrapHue(base + delta * amount)
}

function separateHue(hue: number, accent: number): number {
  if (hueDistance(hue, accent) >= 22) return hue
  const clockwise = wrapHue(hue + 34)
  const counter = wrapHue(hue - 34)
  return hueDistance(clockwise, accent) >= hueDistance(counter, accent)
    ? clockwise
    : counter
}

function oklch(lightness: number, chroma: number, hue: number): string {
  return `oklch(${lightness.toFixed(3)} ${Math.max(0, chroma).toFixed(3)} ${wrapHue(hue).toFixed(1)})`
}

function hexToOklch(accent: string): { l: number; c: number; h: number } {
  const red = Number.parseInt(accent.slice(1, 3), 16) / 255
  const green = Number.parseInt(accent.slice(3, 5), 16) / 255
  const blue = Number.parseInt(accent.slice(5, 7), 16) / 255
  const linear = (channel: number) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  const lr = linear(red)
  const lg = linear(green)
  const lb = linear(blue)
  const x =
    0.41239079926595934 * lr + 0.357584339383878 * lg + 0.1804807884018343 * lb
  const y =
    0.21263900587151027 * lr + 0.715168678767756 * lg + 0.07219231536073371 * lb
  const z =
    0.01933081871559182 * lr + 0.11919477979462598 * lg + 0.9505321522496607 * lb
  const lmsL = Math.cbrt(
    0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z,
  )
  const lmsM = Math.cbrt(
    0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z,
  )
  const lmsS = Math.cbrt(
    0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z,
  )
  const lightness = 0.2104542553 * lmsL + 0.793617785 * lmsM - 0.0040720468 * lmsS
  const a = 1.9779984951 * lmsL - 2.428592205 * lmsM + 0.4505937099 * lmsS
  const b = 0.0259040371 * lmsL + 0.7827717662 * lmsM - 0.808675766 * lmsS
  const chroma = Math.hypot(a, b)
  return { l: lightness, c: chroma, h: wrapHue((Math.atan2(b, a) * 180) / Math.PI) }
}

function generatedPalette(
  accent: string,
  scheme: AdminResolvedScheme,
): AdminPaletteVars {
  const seed = hexToOklch(accent)
  const neutral = seed.c < 0.02
  const hue = neutral ? 270 : seed.h
  const chroma = neutral ? 0 : clamp(seed.c, 0, 0.2)
  const dark = scheme === 'dark'
  const surfaceChroma = dark
    ? clamp(chroma * 0.16, 0, 0.04)
    : clamp(chroma * 0.12, 0, 0.028)
  const textChroma = clamp(chroma * 0.1, 0, 0.03)
  const borderChroma = clamp(chroma * 0.22, 0, 0.05)
  const accentChroma = neutral ? 0 : clamp(chroma, 0.08, dark ? 0.16 : 0.18)
  const accentLightness = dark ? 0.76 : 0.46
  const strongLightness = dark ? 0.66 : 0.38
  const statusLightness = dark ? 0.78 : 0.48
  const kindLightness = dark ? 0.8 : 0.46
  const status = (statusHue: number, statusChroma: number) =>
    oklch(
      statusLightness,
      neutral ? statusChroma * 0.35 : statusChroma,
      neutral ? statusHue : mixHue(statusHue, hue, 0.18),
    )
  const kind = (kindHue: number) =>
    oklch(
      kindLightness,
      neutral ? 0.04 : 0.13,
      separateHue(neutral ? kindHue : mixHue(kindHue, hue, 0.12), hue),
    )
  const rail = (offset: number) =>
    oklch(
      dark ? 0.76 : 0.48,
      neutral ? 0.04 : clamp(accentChroma, 0.1, 0.16),
      wrapHue(hue + offset),
    )

  return {
    '--admin-canvas': oklch(dark ? 0.16 : 0.985, surfaceChroma, hue),
    '--admin-surface-1': oklch(dark ? 0.19 : 0.965, surfaceChroma, hue),
    '--admin-surface-2': oklch(dark ? 0.225 : 0.94, surfaceChroma * 1.15, hue),
    '--admin-surface-3': oklch(dark ? 0.27 : 0.9, surfaceChroma * 1.3, hue),
    '--admin-text-1': oklch(dark ? 0.94 : 0.25, textChroma, hue),
    '--admin-text-2': oklch(dark ? 0.74 : 0.42, textChroma, hue),
    '--admin-text-3': oklch(dark ? 0.6 : 0.52, textChroma * 0.8, hue),
    '--admin-border-1': oklch(dark ? 0.32 : 0.86, borderChroma, hue),
    '--admin-border-2': oklch(dark ? 0.44 : 0.74, borderChroma, hue),
    '--admin-accent': oklch(accentLightness, accentChroma, hue),
    '--admin-accent-strong': oklch(
      strongLightness,
      clamp(accentChroma * 1.15, 0, 0.2),
      hue,
    ),
    '--admin-success': status(150, 0.14),
    '--admin-warning': status(85, 0.14),
    '--admin-error': status(25, 0.16),
    '--admin-info': status(235, 0.12),
    '--admin-kind-action': kind(95),
    '--admin-kind-atom': kind(160),
    '--admin-kind-computed': kind(205),
    '--admin-kind-effect': kind(345),
    '--admin-rail-0': rail(0),
    '--admin-rail-1': rail(55),
    '--admin-rail-2': rail(115),
    '--admin-rail-3': rail(170),
    '--admin-rail-4': rail(220),
    '--admin-rail-5': rail(285),
  }
}

/**
 * Builds the shell colors from one picked accent.
 *
 * The hue of the pick tints surfaces, type, and rails. Lightness is chosen
 * for the scheme so text and the accent stay readable. The default violet on
 * a dark scheme stays the original Dusk sheet.
 */
export function paletteVars(
  accent: string,
  scheme: AdminResolvedScheme,
): AdminPaletteVars {
  const seed = isAdminAccent(accent) ? accent : DEFAULT_ACCENT
  if (seed === DEFAULT_ACCENT && scheme === 'dark') return DUSK_VARS
  return generatedPalette(seed, scheme)
}

export function paletteVarBlock(vars: AdminPaletteVars): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n')
}
