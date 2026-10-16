import { atom, top } from '@reatom/core'
import { expect, test } from 'test'

import { ADMIN_FRAME, resetAdminFrame } from './root'

const untracedRootsKey = Symbol.for('reatom.opentelemetry.untracedRoots')

test('ADMIN_FRAME.root is registered as an untraced root', () => {
  const roots = (
    globalThis as typeof globalThis & {
      [untracedRootsKey]?: WeakSet<object>
    }
  )[untracedRootsKey]
  expect(roots).toBeInstanceOf(WeakSet)
  expect(roots!.has(ADMIN_FRAME.root)).toBe(true)
})

test('reset of ADMIN_FRAME still records nothing', () => {
  const roots = (
    globalThis as typeof globalThis & {
      [untracedRootsKey]?: WeakSet<object>
    }
  )[untracedRootsKey]
  const previous = ADMIN_FRAME.root
  resetAdminFrame()
  expect(ADMIN_FRAME.root).not.toBe(previous)
  expect(roots!.has(ADMIN_FRAME.root)).toBe(true)

  const recorded: string[] = []
  ADMIN_FRAME.run(() => {
    const probe = atom(0, '_Admin.reset.probe')
    probe.set(1)
    if (!roots!.has(top().root)) recorded.push('probe')
    expect(probe()).toBe(1)
  })
  expect(recorded).toEqual([])
})
