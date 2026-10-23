/** Exact TextEncoder byte length, stopping once an optional budget is exceeded. */
export const utf8Length = (value: string, stopAfter = Infinity): number => {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index++
    } else bytes += 3
    if (bytes > stopAfter) return bytes
  }
  return bytes
}
