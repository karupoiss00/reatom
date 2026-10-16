type ServerTimingEntry = {
  name?: string
  description?: unknown
}

type NavigationTiming = {
  serverTiming?: readonly ServerTimingEntry[]
}

export const readServerTimingTraceparent = (): string | undefined => {
  if (
    typeof performance === 'undefined' ||
    typeof performance.getEntriesByType !== 'function'
  )
    return
  try {
    const entries = performance.getEntriesByType('navigation')
    const navigation = entries[0] as NavigationTiming | undefined
    const timing = navigation?.serverTiming
    if (!timing) return
    for (const entry of timing) {
      if (entry.name === 'traceparent' && typeof entry.description === 'string')
        return entry.description
    }
  } catch {
    return
  }
  return
}

export const formatServerTimingTraceparent = (traceparent: string): string =>
  `traceparent;desc="${traceparent}"`
