export type Rgba = { r: number; g: number; b: number; a: number }

const parseHex = (hex: string): Rgba | null => {
  const digits = hex.replace('#', '')
  const expanded =
    digits.length === 3 || digits.length === 4
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits
  if (expanded.length !== 6 && expanded.length !== 8) return null
  const channel = (index: number) =>
    parseInt(expanded.slice(index, index + 2), 16)
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: expanded.length === 8 ? channel(6) / 255 : 1,
  }
}

export const parseColor = (color: string): Rgba => {
  const trimmed = color.trim()
  if (trimmed.startsWith('#')) {
    const parsed = parseHex(trimmed)
    if (parsed) return parsed
  }
  const functional = trimmed.match(/^rgba?\(([^)]+)\)$/i)
  if (functional) {
    const parts = functional[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((part) => part.trim())
    const toChannel = (part: string | undefined) =>
      part === undefined
        ? 0
        : part.endsWith('%')
          ? (Number.parseFloat(part) / 100) * 255
          : Number.parseFloat(part)
    const alphaPart = parts[3]
    const alpha =
      alphaPart === undefined
        ? 1
        : alphaPart.endsWith('%')
          ? Number.parseFloat(alphaPart) / 100
          : Number.parseFloat(alphaPart)
    return {
      r: toChannel(parts[0]),
      g: toChannel(parts[1]),
      b: toChannel(parts[2]),
      a: alpha,
    }
  }
  throw new Error(`Unsupported color format: ${color}`)
}

export const composite = (top: Rgba, bottom: Rgba): Rgba => {
  const alpha = top.a + bottom.a * (1 - top.a)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (front: number, back: number) =>
    (front * top.a + back * bottom.a * (1 - top.a)) / alpha
  return {
    r: mix(top.r, bottom.r),
    g: mix(top.g, bottom.g),
    b: mix(top.b, bottom.b),
    a: alpha,
  }
}

const linearChannel = (channel: number) => {
  const srgb = channel / 255
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

export const relativeLuminance = ({ r, g, b }: Rgba) =>
  0.2126 * linearChannel(r) +
  0.7152 * linearChannel(g) +
  0.0722 * linearChannel(b)

export const contrastRatio = (foreground: string, background: string) => {
  const opaqueWhite: Rgba = { r: 255, g: 255, b: 255, a: 1 }
  const backgroundColor = composite(parseColor(background), opaqueWhite)
  const foregroundColor = composite(parseColor(foreground), backgroundColor)
  const lighter = Math.max(
    relativeLuminance(foregroundColor),
    relativeLuminance(backgroundColor),
  )
  const darker = Math.min(
    relativeLuminance(foregroundColor),
    relativeLuminance(backgroundColor),
  )
  return (lighter + 0.05) / (darker + 0.05)
}

export const formatRgba = ({ r, g, b, a }: Rgba) =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`

/** Composites the background colors of the element and its ancestors. */
export const resolvedBackground = (element: Element) => {
  const layers: Rgba[] = []
  for (let node: Element | null = element; node; node = node.parentElement) {
    const layer = parseColor(getComputedStyle(node).backgroundColor)
    if (layer.a > 0) layers.push(layer)
    if (layer.a >= 1) break
  }
  const opaqueWhite: Rgba = { r: 255, g: 255, b: 255, a: 1 }
  return formatRgba(
    layers.reduceRight((below, layer) => composite(layer, below), opaqueWhite),
  )
}
