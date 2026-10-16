import {
  localValuesOf,
  localValuesTextOf,
  type AdminLocalValues,
  type AdminRecord,
} from './ingest.ts'

const TEXT_CAP = 64 * 1024
const TEXT_DEPTH = 32

function parseJsonAttr(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Params, payload, state, and error for display. `source: 'local'` reads
 * {@link localValuesOf}. Otherwise params and payload are decoded from
 * `reatom.params` and `reatom.payload` (invalid JSON stays a string), state is
 * the log body, and error is `record.error`.
 */
export function recordValues(record: AdminRecord): {
  params: unknown
  payload: unknown
  state: unknown
  error: unknown
  source: 'local' | 'otlp'
} {
  const live = localValuesOf(record)
  if (live) {
    return {
      params: live.params,
      payload: live.payload,
      state: live.state,
      error: live.error,
      source: 'local',
    }
  }
  return {
    params: parseJsonAttr(record.attributes['reatom.params']),
    payload: parseJsonAttr(record.attributes['reatom.payload']),
    state: record.kind === 'log' ? record.body : undefined,
    error: record.error,
    source: 'otlp',
  }
}

/**
 * Search text for local values, capped at 64 KB and cached per record. Cycles,
 * Map, Set, bigint, functions, and symbols are rendered without throwing.
 * Records without local values return an empty string.
 */
export function recordValuesText(record: AdminRecord): string {
  return localValuesTextOf(record, renderLocalValues)
}

function renderLocalValues(values: AdminLocalValues): string {
  const seen = new WeakSet<object>()
  let text = ''

  const append = (chunk: string) => {
    if (chunk === '' || text.length >= TEXT_CAP) return
    const room = TEXT_CAP - text.length
    text += chunk.length > room ? chunk.slice(0, room) : chunk
  }

  const walk = (value: unknown, depth: number) => {
    if (text.length >= TEXT_CAP || depth > TEXT_DEPTH) return
    try {
      if (value === null || value === undefined) return
      const type = typeof value
      if (type === 'string' || type === 'number' || type === 'boolean') {
        append(String(value))
        append('\n')
        return
      }
      if (type === 'bigint') {
        append((value as bigint).toString())
        append('\n')
        return
      }
      if (type === 'symbol') {
        const description = (value as symbol).description
        if (description) {
          append(description)
          append('\n')
        }
        return
      }
      if (type === 'function') {
        const name = (value as { name?: unknown }).name
        if (typeof name === 'string' && name !== '') {
          append(name)
          append('\n')
        }
        return
      }
      if (type !== 'object') return
      const object = value as object
      if (seen.has(object)) return
      seen.add(object)
      if (value instanceof Error) {
        append(value.name)
        append('\n')
        append(value.message)
        append('\n')
        if (typeof value.stack === 'string') append(value.stack)
        append('\n')
        return
      }
      if (value instanceof Map) {
        for (const [key, entry] of value) {
          walk(key, depth + 1)
          walk(entry, depth + 1)
          if (text.length >= TEXT_CAP) return
        }
        return
      }
      if (value instanceof Set) {
        for (const entry of value) {
          walk(entry, depth + 1)
          if (text.length >= TEXT_CAP) return
        }
        return
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          walk(entry, depth + 1)
          if (text.length >= TEXT_CAP) return
        }
        return
      }
      const record = value as Record<string, unknown>
      let keys: string[]
      try {
        keys = Object.keys(record)
      } catch {
        return
      }
      for (const key of keys) {
        append(key)
        append('\n')
        let nested: unknown
        try {
          nested = record[key]
        } catch {
          continue
        }
        walk(nested, depth + 1)
        if (text.length >= TEXT_CAP) return
      }
    } catch {
      return
    }
  }

  walk(values.params, 0)
  walk(values.payload, 0)
  walk(values.state, 0)
  walk(values.error, 0)
  return text
}
