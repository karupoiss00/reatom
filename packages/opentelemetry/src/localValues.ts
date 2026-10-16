/**
 * Live values for one locally kept record. Only the keys that apply to that
 * record are set. Each value is the original reference: not copied, masked, or
 * truncated, and never written into the exported OTLP payload.
 */
export type LocalValues = {
  params?: readonly unknown[]
  payload?: unknown
  state?: unknown
  error?: unknown
}

/**
 * `false` stores nothing. `true` stores live values except on targets with
 * `withOTel({ captureValues: false })`. `'all'` stores them for those targets
 * too. Active only while local records are kept (`endpoint: null` or
 * `keepRecords`).
 */
export type LocalValuesMode = boolean | 'all'
