/**
 * Receiver-bound native readers/copying; application byte-array methods stay
 * unused.
 */
export const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)!.get as (this: Uint8Array) => number
export const copyBytes = Uint8Array.prototype.set
