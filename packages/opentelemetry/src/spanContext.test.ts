import { expect, test } from 'vitest'

import { createChildContext } from './traceContext.ts'

test('context pairs are immutable and children share only their parent trace ID', () => {
  const parent = createChildContext()
  const child = createChildContext(parent)
  const sibling = createChildContext(parent)
  const root = createChildContext()

  for (const pair of [parent, child, sibling, root])
    expect(Object.isFrozen(pair)).toBe(true)
  expect(parent.traceId).toMatch(/^[0-9a-f]{32}$/)
  expect(parent.spanId).toMatch(/^[0-9a-f]{16}$/)
  expect(child.traceId).toBe(parent.traceId)
  expect(sibling.traceId).toBe(parent.traceId)
  expect(root.traceId).not.toBe(parent.traceId)
  expect(
    new Set([parent, child, sibling, root].map((pair) => pair.spanId)).size,
  ).toBe(4)
})
