/**
 * JSON representation for safe captured values: bigint keeps decimal precision,
 * and byte arrays become ordinary JSON arrays. Stored values stay untouched.
 */
export function stringifyJson(
  value: unknown,
  space?: number,
): string | undefined {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === 'bigint'
        ? item.toString()
        : item instanceof Uint8Array
          ? Array.from(item)
          : item,
    space,
  )
}

/** Detached JSON-compatible copy for external response boundaries. */
export function toJsonValue(value: unknown): unknown {
  const text = stringifyJson(value)
  return text === undefined ? undefined : JSON.parse(text)
}
