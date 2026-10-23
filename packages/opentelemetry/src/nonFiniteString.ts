/** Stable scalar normalization shared by captured data and wire encoding. */
export const nonFiniteString = (
  value: number,
): 'NaN' | 'Infinity' | '-Infinity' | undefined => {
  if (Number.isFinite(value)) return undefined
  if (Number.isNaN(value)) return 'NaN'
  return value > 0 ? 'Infinity' : '-Infinity'
}
