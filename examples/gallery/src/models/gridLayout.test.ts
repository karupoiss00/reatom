import { clearStack, context } from '@reatom/core'
import { expect, test } from 'vitest'

import {
  resolveAutoColumnCount,
  resolveEffectiveGap,
  resolveGridDensity,
  resolveMaxColumnCount,
  resolveRawCellSize,
} from './gridLayout'
import { gridColumns, gridColumnsLabel, increaseGridColumns } from './view'

test.beforeEach(() => clearStack())

test('grid density thresholds', () => {
  expect(resolveGridDensity(0)).toBe('comfortable')
  expect(resolveGridDensity(1)).toBe('micro')
  expect(resolveGridDensity(40)).toBe('micro')
  expect(resolveGridDensity(63)).toBe('micro')
  expect(resolveGridDensity(64)).toBe('tiny')
  expect(resolveGridDensity(99)).toBe('tiny')
  expect(resolveGridDensity(100)).toBe('compact')
  expect(resolveGridDensity(159)).toBe('compact')
  expect(resolveGridDensity(160)).toBe('comfortable')
  expect(resolveGridDensity(400)).toBe('comfortable')
})

test('effective gap is capped by 15% of the raw cell and 2px floor', () => {
  expect(resolveEffectiveGap(200, 16)).toBe(16)
  expect(resolveEffectiveGap(100, 16)).toBe(15)
  expect(resolveEffectiveGap(20, 16)).toBe(3)
  expect(resolveEffectiveGap(6, 16)).toBe(2)
  expect(resolveEffectiveGap(400, 0)).toBe(0)
})

test('raw cell size uses the configured gap', () => {
  expect(resolveRawCellSize(1436, 8, 16)).toBe((1436 - 16 * 7) / 8)
  expect(resolveRawCellSize(0, 4, 16)).toBe(-12)
  expect(resolveRawCellSize(100, 0, 16)).toBe(0)
})

test('max column count keeps cells above the minimum size', () => {
  expect(resolveMaxColumnCount(0, 16)).toBe(100)
  expect(resolveMaxColumnCount(1436, 16)).toBe(Math.floor(1452 / 56))
  expect(resolveMaxColumnCount(216, 16)).toBe(4)
  expect(resolveMaxColumnCount(40, 0)).toBe(1)
})

test('auto column count prefers 200px cells', () => {
  expect(resolveAutoColumnCount(0, 16)).toBe(1)
  expect(resolveAutoColumnCount(448, 16)).toBe(2)
  expect(resolveAutoColumnCount(1436, 16)).toBe(6)
})

test('increaseGridColumns increments below the max', () =>
  context.start(() => {
    gridColumns.set(4)
    increaseGridColumns()
    expect(gridColumns()).toBe(5)
  }))

test('increaseGridColumns stops at the max column count', () =>
  context.start(() => {
    gridColumns.set(100)
    increaseGridColumns()
    expect(gridColumns()).toBe(100)
  }))

test('gridColumnsLabel shows the auto setting and effective count', () =>
  context.start(() => {
    gridColumns.set(0)
    expect(gridColumnsLabel()).toBe('auto')
    gridColumns.set(7)
    expect(gridColumnsLabel()).toBe('7')
  }))
