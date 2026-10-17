export function valueShapeLabel(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const type = typeof value
  if (type === 'number') return '{number}'
  if (type === 'string') return '{string}'
  if (type === 'boolean') return '{boolean}'
  if (type === 'bigint') return '{bigint}'
  if (type === 'symbol') return '{symbol}'
  if (type === 'function') return '{function}'
  if (type !== 'object') return '{unknown}'
  if (isThenable(value)) return 'Promise'
  if (value instanceof Map) return `Map(${safeSize(value)})`
  if (value instanceof Set) return `Set(${safeSize(value)})`
  if (Array.isArray(value)) return `[${value.length}]`
  try {
    return `{${Object.keys(value as object).length} keys}`
  } catch {
    return '{object}'
  }
}

function isThenable(value: object): boolean {
  if (typeof Promise !== 'undefined' && value instanceof Promise) return true
  const then = (value as { then?: unknown }).then
  return typeof then === 'function'
}

function safeSize(collection: Map<unknown, unknown> | Set<unknown>): number {
  try {
    return collection.size
  } catch {
    return 0
  }
}
