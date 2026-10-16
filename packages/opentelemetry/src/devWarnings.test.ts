import { expect, test } from 'vitest'

import { developmentFromSignals } from './devWarnings.ts'

test('development follows NODE_ENV, then the bundler flag, and stays quiet when both are missing', () => {
  expect(developmentFromSignals('production', true)).toBe(false)
  expect(developmentFromSignals('production', undefined)).toBe(false)
  expect(developmentFromSignals('development', undefined)).toBe(true)
  expect(developmentFromSignals('development', false)).toBe(true)
  expect(developmentFromSignals('test', undefined)).toBe(true)
  expect(developmentFromSignals(undefined, true)).toBe(true)
  expect(developmentFromSignals(undefined, false)).toBe(false)
  expect(developmentFromSignals(undefined, undefined)).toBe(false)
  expect(developmentFromSignals('', undefined)).toBe(false)
})
