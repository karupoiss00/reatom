export const ADMIN_SCHEME_IDS = ['light', 'dark', 'system', 'match'] as const

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
  '--admin-canvas': 'oklch(0.165 0.012 285)',
  '--admin-surface-1': 'oklch(0.195 0.012 285)',
  '--admin-surface-2': 'oklch(0.225 0.013 285)',
  '--admin-surface-3': 'oklch(0.265 0.014 285)',
  '--admin-text-1': 'oklch(0.93 0.012 295)',
  '--admin-text-2': 'oklch(0.78 0.018 295)',
  '--admin-text-3': 'oklch(0.64 0.016 295)',
  '--admin-border-1': 'oklch(0.32 0.016 285)',
  '--admin-border-2': 'oklch(0.42 0.018 285)',
  '--admin-accent': 'oklch(0.75 0.14 300)',
  '--admin-accent-strong': 'oklch(0.66 0.19 300)',
  '--admin-success': 'oklch(0.78 0.16 150)',
  '--admin-warning': 'oklch(0.82 0.16 85)',
  '--admin-error': 'oklch(0.68 0.19 25)',
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

const DAWN_VARS: AdminPaletteVars = {
  '--admin-canvas': 'oklch(0.985 0.004 285)',
  '--admin-surface-1': 'oklch(0.970 0.006 285)',
  '--admin-surface-2': 'oklch(0.945 0.008 285)',
  '--admin-surface-3': 'oklch(0.920 0.010 285)',
  '--admin-text-1': 'oklch(0.280 0.030 285)',
  '--admin-text-2': 'oklch(0.420 0.024 285)',
  '--admin-text-3': 'oklch(0.550 0.018 285)',
  '--admin-border-1': 'oklch(0.890 0.010 285)',
  '--admin-border-2': 'oklch(0.800 0.012 285)',
  '--admin-accent': 'oklch(0.520 0.160 305)',
  '--admin-accent-strong': 'oklch(0.420 0.180 305)',
  '--admin-success': 'oklch(0.420 0.140 150)',
  '--admin-warning': 'oklch(0.480 0.160 85)',
  '--admin-error': 'oklch(0.480 0.170 25)',
  '--admin-info': 'oklch(0.420 0.120 235)',
  '--admin-kind-action': 'oklch(0.480 0.120 95)',
  '--admin-kind-atom': 'oklch(0.480 0.120 160)',
  '--admin-kind-computed': 'oklch(0.480 0.120 205)',
  '--admin-kind-effect': 'oklch(0.480 0.120 345)',
  '--admin-rail-0': 'oklch(0.480 0.120 305)',
  '--admin-rail-1': 'oklch(0.480 0.120 235)',
  '--admin-rail-2': 'oklch(0.480 0.120 160)',
  '--admin-rail-3': 'oklch(0.480 0.160 85)',
  '--admin-rail-4': 'oklch(0.480 0.140 30)',
  '--admin-rail-5': 'oklch(0.480 0.140 330)',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

export function hueDistance(left: number, right: number): number {
  const delta = Math.abs(wrapHue(left) - wrapHue(right))
  return Math.min(delta, 360 - delta)
}

export function parseOklch(
  value: string,
): { l: number; c: number; h: number } | null {
  const match = value.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)/i,
  )
  if (!match) return null
  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
  }
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
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  const lr = linear(red)
  const lg = linear(green)
  const lb = linear(blue)
  const x =
    0.41239079926595934 * lr + 0.357584339383878 * lg + 0.1804807884018343 * lb
  const y =
    0.21263900587151027 * lr + 0.715168678767756 * lg + 0.07219231536073371 * lb
  const z =
    0.01933081871559182 * lr +
    0.11919477979462598 * lg +
    0.9505321522496607 * lb
  const lmsL = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z)
  const lmsM = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z)
  const lmsS = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z)
  const lightness =
    0.2104542553 * lmsL + 0.793617785 * lmsM - 0.0040720468 * lmsS
  const a = 1.9779984951 * lmsL - 2.428592205 * lmsM + 0.4505937099 * lmsS
  const b = 0.0259040371 * lmsL + 0.7827717662 * lmsM - 0.808675766 * lmsS
  const chroma = Math.hypot(a, b)
  return {
    l: lightness,
    c: chroma,
    h: wrapHue((Math.atan2(b, a) * 180) / Math.PI),
  }
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
    ? clamp(chroma * 0.16, 0, 0.016)
    : clamp(chroma * 0.06, 0, 0.01)
  const textChroma = dark
    ? clamp(chroma * 0.1, 0, 0.03)
    : clamp(chroma * 0.18, 0.018, 0.03)
  const borderChroma = dark
    ? clamp(chroma * 0.22, 0, 0.05)
    : clamp(chroma * 0.08, 0.008, 0.014)
  const accentChroma = neutral ? 0 : clamp(chroma, 0.08, dark ? 0.16 : 0.16)
  const accentLightness = dark ? 0.76 : 0.52
  const strongLightness = dark ? 0.66 : 0.42
  const statusLightness = dark ? 0.78 : 0.48
  const kindLightness = dark ? 0.8 : 0.48
  const kindChroma = dark ? 0.13 : 0.12
  const status = (statusHue: number, statusChroma: number) =>
    oklch(
      statusLightness,
      neutral ? statusChroma * 0.35 : statusChroma,
      neutral ? statusHue : mixHue(statusHue, hue, 0.18),
    )
  const kind = (kindHue: number) =>
    oklch(
      kindLightness,
      neutral ? 0.04 : kindChroma,
      separateHue(neutral ? kindHue : mixHue(kindHue, hue, 0.12), hue),
    )
  const rail = (offset: number) =>
    oklch(
      dark ? 0.76 : 0.48,
      neutral ? 0.04 : clamp(accentChroma, 0.1, 0.16),
      wrapHue(hue + offset),
    )

  return {
    '--admin-canvas': oklch(dark ? 0.165 : 0.985, surfaceChroma, hue),
    '--admin-surface-1': oklch(dark ? 0.195 : 0.97, surfaceChroma, hue),
    '--admin-surface-2': oklch(dark ? 0.225 : 0.945, surfaceChroma, hue),
    '--admin-surface-3': oklch(dark ? 0.265 : 0.92, surfaceChroma, hue),
    '--admin-text-1': oklch(dark ? 0.93 : 0.28, textChroma, hue),
    '--admin-text-2': oklch(dark ? 0.78 : 0.42, textChroma * 0.8, hue),
    '--admin-text-3': oklch(dark ? 0.64 : 0.55, textChroma * 0.6, hue),
    '--admin-border-1': oklch(dark ? 0.32 : 0.89, borderChroma, hue),
    '--admin-border-2': oklch(dark ? 0.42 : 0.8, borderChroma, hue),
    '--admin-accent': oklch(accentLightness, accentChroma, hue),
    '--admin-accent-strong': oklch(
      strongLightness,
      clamp(accentChroma * 1.15, 0, 0.2),
      hue,
    ),
    '--admin-success': status(150, 0.14),
    '--admin-warning': oklch(statusLightness, 0.16, 85),
    '--admin-error': oklch(dark ? 0.68 : 0.48, dark ? 0.19 : 0.17, 25),
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
 * The hue of the pick tints surfaces, type, and rails. Lightness is chosen for
 * the scheme so text and the accent stay readable. The default violet stays the
 * Dusk sheet in dark and the Dawn sheet in light.
 */
export function paletteVars(
  accent: string,
  scheme: AdminResolvedScheme,
): AdminPaletteVars {
  const seed = isAdminAccent(accent) ? accent : DEFAULT_ACCENT
  if (seed === DEFAULT_ACCENT && scheme === 'dark') return DUSK_VARS
  if (seed === DEFAULT_ACCENT && scheme === 'light') return DAWN_VARS
  return generatedPalette(seed, scheme)
}

function parseCssRgb(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const modern = value.match(
    /rgba?\(\s*([\d.]+)(?:\s*\/\s*|\s*,\s*|\s+)([\d.]+)(?:\s*\/\s*|\s*,\s*|\s+)([\d.]+)(?:\s*\/\s*|\s*,\s*)?([\d.]+)?/i,
  )
  if (modern) {
    return {
      r: Number(modern[1]),
      g: Number(modern[2]),
      b: Number(modern[3]),
      a: modern[4] === undefined ? 1 : Number(modern[4]),
    }
  }
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)
  if (!hex) return null
  const raw = hex[1]
  if (raw === undefined) return null
  if (raw.length === 3 || raw.length === 4) {
    const rDigit = raw[0]
    const gDigit = raw[1]
    const bDigit = raw[2]
    const aDigit = raw[3]
    if (rDigit === undefined || gDigit === undefined || bDigit === undefined) {
      return null
    }
    const r = Number.parseInt(rDigit + rDigit, 16)
    const g = Number.parseInt(gDigit + gDigit, 16)
    const b = Number.parseInt(bDigit + bDigit, 16)
    const a =
      raw.length === 4 && aDigit !== undefined
        ? Number.parseInt(aDigit + aDigit, 16) / 255
        : 1
    return { r, g, b, a }
  }
  if (raw.length === 6 || raw.length === 8) {
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
      a: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) / 255 : 1,
    }
  }
  return null
}

function srgbLuminance(r: number, g: number, b: number): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function schemeFromColorScheme(value: string): AdminResolvedScheme | null {
  const hasDark = /\bdark\b/i.test(value)
  const hasLight = /\blight\b/i.test(value)
  if (hasDark && !hasLight) return 'dark'
  if (hasLight && !hasDark) return 'light'
  return null
}

export function resolveHostSignals(
  colorScheme: string,
  backgroundColor: string,
): AdminResolvedScheme {
  const named = schemeFromColorScheme(colorScheme)
  if (named !== null) return named
  const painted = parseCssRgb(backgroundColor)
  if (painted === null || painted.a < 0.08) return 'dark'
  return srgbLuminance(painted.r, painted.g, painted.b) >= 0.5 ? 'light' : 'dark'
}

/**
 * Reads the host page once. `match` uses this snapshot and does not follow
 * later page changes unless the host remounts the admin.
 */
export function readHostScheme(
  from?: Document | Element | null,
): AdminResolvedScheme {
  if (typeof getComputedStyle !== 'function') return 'dark'
  const doc =
    from instanceof Document
      ? from
      : (from?.ownerDocument ??
        (typeof document === 'undefined' ? null : document))
  if (doc === null) return 'dark'
  const candidates = [
    from instanceof Element ? from : null,
    doc.body,
    doc.documentElement,
  ]
  for (const node of candidates) {
    if (!(node instanceof Element)) continue
    const style = getComputedStyle(node)
    const named = schemeFromColorScheme(style.colorScheme)
    if (named !== null) return named
  }
  for (const node of candidates) {
    if (!(node instanceof Element)) continue
    const painted = getComputedStyle(node).backgroundColor
    if ((parseCssRgb(painted)?.a ?? 0) < 0.08) continue
    return resolveHostSignals('', painted)
  }
  return 'dark'
}

export function paletteVarBlock(vars: AdminPaletteVars): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join('\n')
}
