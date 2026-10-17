import { expect, test } from 'test'

import { valueShapeLabel } from './valueShape.ts'

test('valueShapeLabel names primitives, collections, and null separately from undefined', () => {
  expect(valueShapeLabel(12)).toBe('{number}')
  expect(valueShapeLabel('hi')).toBe('{string}')
  expect(valueShapeLabel(true)).toBe('{boolean}')
  expect(valueShapeLabel(null)).toBe('null')
  expect(valueShapeLabel(undefined)).toBe('undefined')
  expect(valueShapeLabel(Array.from({ length: 12 }))).toBe('[12]')
  expect(valueShapeLabel({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toBe('{5 keys}')
  expect(valueShapeLabel(new Map([[1, 2], [3, 4], [5, 6]]))).toBe('Map(3)')
  expect(valueShapeLabel(Promise.resolve(1))).toBe('Promise')
  expect(valueShapeLabel({ then() {} })).toBe('Promise')
})
