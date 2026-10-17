export function barLabelText(name: string, duration: string): string {
  if (duration === '') return name
  return `${name} · ${duration}`
}

export function barLabelFitsInside(
  label: string,
  barWidthFraction: number,
  trackWidthPx: number,
): boolean {
  if (!(trackWidthPx > 0) || !(barWidthFraction > 0)) return false
  const barWidthPx = barWidthFraction * trackWidthPx
  const estimatedPx = label.length * 7.2 + 12
  return barWidthPx >= estimatedPx
}

export function isQuietSpan(durationMs: number, windowMs: number): boolean {
  if (!(windowMs > 0) || !(durationMs >= 0)) return false
  return durationMs / windowMs < 0.01
}
