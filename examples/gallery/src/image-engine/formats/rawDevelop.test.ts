import { describe, expect, test } from 'vitest'

import type { RawImageData } from 'libraw-wasm'

import { shouldDevelopAtHalfSize, takeRgbBuffer } from './rawDevelop'

function rgbImage(
  data: Uint8Array,
  width: number,
  height: number,
  colors = 3,
  dataSize = data.byteLength,
): RawImageData & { data: Uint8Array } {
  return {
    width,
    height,
    colors,
    bits: 8,
    dataSize,
    data,
  }
}

describe('shouldDevelopAtHalfSize', () => {
  test('full-size develop never uses half size', () => {
    expect(shouldDevelopAtHalfSize(undefined, 6000)).toBe(false)
  })

  test('missing or zero source long edge stays full resolution', () => {
    expect(shouldDevelopAtHalfSize(2560, undefined)).toBe(false)
    expect(shouldDevelopAtHalfSize(2560, 0)).toBe(false)
  })

  test('uses half size when the target fits in half the sensor', () => {
    expect(shouldDevelopAtHalfSize(2560, 6000)).toBe(true)
    expect(shouldDevelopAtHalfSize(3000, 6000)).toBe(true)
  })

  test('stays full resolution above half the sensor long edge', () => {
    expect(shouldDevelopAtHalfSize(3001, 6000)).toBe(false)
  })

  test('rejects NaN and Infinity', () => {
    expect(shouldDevelopAtHalfSize(Number.NaN, 6000)).toBe(false)
    expect(shouldDevelopAtHalfSize(2560, Number.NaN)).toBe(false)
    expect(shouldDevelopAtHalfSize(Number.POSITIVE_INFINITY, 6000)).toBe(false)
    expect(shouldDevelopAtHalfSize(2560, Number.POSITIVE_INFINITY)).toBe(false)
    expect(shouldDevelopAtHalfSize(Number.NaN, Number.POSITIVE_INFINITY)).toBe(
      false,
    )
  })
})

describe('takeRgbBuffer', () => {
  test('returns the existing buffer when it is exactly the RGB payload', () => {
    const expectedLength = 2 * 2 * 3
    const buffer = new ArrayBuffer(expectedLength)
    const data = new Uint8Array(buffer)

    expect(takeRgbBuffer(rgbImage(data, 2, 2))).toBe(buffer)
  })

  test('copies a compact prefix when the buffer is larger', () => {
    const expectedLength = 2 * 2 * 3
    const data = new Uint8Array(expectedLength + 8)
    data.fill(9)

    const result = takeRgbBuffer(rgbImage(data, 2, 2, 3, expectedLength))

    expect(result).not.toBe(data.buffer)
    expect(result?.byteLength).toBe(expectedLength)
    expect(result && new Uint8Array(result)).toEqual(
      data.subarray(0, expectedLength),
    )
  })

  test('copies when the view is a window into a larger buffer', () => {
    const expectedLength = 2 * 2 * 3
    const backing = new Uint8Array(expectedLength + 4)
    backing.fill(4)
    const view = backing.subarray(2, 2 + expectedLength)

    const result = takeRgbBuffer(rgbImage(view, 2, 2))

    expect(result).not.toBe(backing.buffer)
    expect(result?.byteLength).toBe(expectedLength)
    expect(result && new Uint8Array(result)).toEqual(view)
  })

  test('copies shared memory instead of returning it', () => {
    const expectedLength = 2 * 2 * 3
    const shared = new SharedArrayBuffer(expectedLength)
    const data = new Uint8Array(shared)
    data.fill(5)

    const result = takeRgbBuffer(rgbImage(data, 2, 2))

    expect(result).not.toBe(shared)
    expect(result).toBeInstanceOf(ArrayBuffer)
    expect(result?.byteLength).toBe(expectedLength)
    expect(result && new Uint8Array(result)).toEqual(data)
  })

  test('returns null when the payload is shorter than width * height * 3', () => {
    const data = new Uint8Array(2 * 2 * 3 - 1)
    expect(takeRgbBuffer(rgbImage(data, 2, 2))).toBeNull()
  })

  test('returns null when the image is not 3-channel RGB', () => {
    const data = new Uint8Array(2 * 2 * 4)
    expect(takeRgbBuffer(rgbImage(data, 2, 2, 4))).toBeNull()
  })

  test('treats a non-positive color count as RGB', () => {
    const expectedLength = 2 * 2 * 3
    const buffer = new ArrayBuffer(expectedLength)
    const data = new Uint8Array(buffer)

    expect(takeRgbBuffer(rgbImage(data, 2, 2, 0))).toBe(buffer)
  })
})
