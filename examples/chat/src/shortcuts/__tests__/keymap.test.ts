import { context } from '@reatom/core'
import { afterEach, expect, test } from 'vitest'

import { ui } from '../../app/ui'
import { resetRuntime } from '../../platform/runtime'
import { installKeymap } from '../keymap'

const pressOpenSearch = () =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }),
  )

afterEach(() => {
  resetRuntime()
})

test('after resetRuntime the keymap reinstalls into the current context', () => {
  installKeymap()
  resetRuntime()
  context.reset()
  installKeymap()

  pressOpenSearch()

  expect(ui.search()).toBe(true)
})

test('installKeymap is idempotent until reset', () => {
  installKeymap()
  installKeymap()

  pressOpenSearch()
  expect(ui.search()).toBe(true)
})

test('resetRuntime removes the window listener', () => {
  installKeymap()
  resetRuntime()

  pressOpenSearch()

  expect(ui.search()).toBe(false)
})
