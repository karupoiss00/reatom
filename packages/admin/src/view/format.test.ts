import { expect, test } from 'test'

import { formatPreview } from './format'

test('formatPreview compacts arrays and nested objects onto one line', () => {
  expect(formatPreview(['X', null, null])).toBe('["X", null, null]')
  expect(formatPreview({ a: 1, b: { c: 2 } })).toBe('{"a": 1, "b": {"c": 2}}')
  expect(formatPreview([['X'], [null]])).toBe('[["X"], [null]]')
})

test('formatPreview keeps string content with commas and quotes intact', () => {
  expect(formatPreview('a, "b"')).toBe('a, "b"')
  expect(formatPreview(['a,b', 'c"d'])).toBe('["a,b", "c\\"d"]')
  expect(formatPreview({ 'k, "v"': 'x}y[' })).toBe('{"k, \\"v\\"": "x}y["}')
})

test('formatPreview truncates long values with an ellipsis', () => {
  const preview = formatPreview(['x'.repeat(100)])
  expect(preview.length).toBe(88)
  expect(preview.endsWith('…')).toBe(true)
})
