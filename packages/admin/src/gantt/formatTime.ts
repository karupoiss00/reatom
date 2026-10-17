export function formatAxisOffset(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : ''
  const abs = Math.abs(offsetMs)
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`
  if (abs < 60_000) {
    const seconds = abs / 1000
    return `${sign}${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  }
  if (abs < 3_600_000) return `${sign}${Math.round(abs / 60_000)}m`
  if (abs < 86_400_000) return `${sign}${Math.round(abs / 3_600_000)}h`
  return `${sign}${Math.round(abs / 86_400_000)}d`
}
