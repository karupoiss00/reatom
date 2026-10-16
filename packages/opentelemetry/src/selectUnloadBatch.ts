const ENVELOPES = {
  resourceSpans: { prefix: '{"resourceSpans":[', suffix: ']}' },
  resourceLogs: { prefix: '{"resourceLogs":[', suffix: ']}' },
} as const

export type UnloadContainer = keyof typeof ENVELOPES

const utf8 = new TextEncoder()

export interface SelectUnloadBatchInput<T> {
  items: readonly T[]
  maxBytes: number
  encode: (item: T) => string
  container?: UnloadContainer
}

/**
 * Selects owned records newest first. `encode` returns one complete
 * ResourceSpans or ResourceLogs JSON object per record; failures propagate
 * to the lease owner.
 */
export const selectUnloadBatch = <T>({
  items,
  maxBytes,
  encode,
  container = 'resourceSpans',
}: SelectUnloadBatchInput<T>): {
  body: string
  keptCount: number
  droppedCount: number
} => {
  const { prefix, suffix } = ENVELOPES[container]
  const envelopeBytes = prefix.length + suffix.length
  if (!Number.isFinite(maxBytes) || maxBytes <= envelopeBytes) {
    return { body: '', keptCount: 0, droppedCount: items.length }
  }

  const parts: string[] = []
  let usedBytes = envelopeBytes
  for (let index = items.length - 1; index >= 0; index--) {
    const part = encode(items[index]!)
    const partBytes = utf8.encode(part).byteLength
    // Oversized records do not prevent selection of older eligible records.
    if (envelopeBytes + partBytes > maxBytes) continue

    const addedBytes = partBytes + (parts.length > 0 ? 1 : 0)
    if (usedBytes + addedBytes > maxBytes) break
    parts.push(part)
    usedBytes += addedBytes
  }

  return {
    body: parts.length > 0 ? prefix + parts.reverse().join(',') + suffix : '',
    keptCount: parts.length,
    droppedCount: items.length - parts.length,
  }
}

export const selectLogsUnloadBatch = <T>(
  input: Omit<SelectUnloadBatchInput<T>, 'container'>,
) => selectUnloadBatch({ ...input, container: 'resourceLogs' })
