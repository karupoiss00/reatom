import { expect, test } from 'test'

import { paramEntries } from './params'

test('params render as labeled items instead of an array', () => {
  expect(paramEntries(undefined)).toEqual([])
  expect(paramEntries([])).toEqual([])
  expect(paramEntries([0])).toEqual([{ label: 'Param', value: 0 }])
  expect(paramEntries([0, 'x', { ok: true }])).toEqual([
    { label: 'Param1', value: 0 },
    { label: 'Param2', value: 'x' },
    { label: 'Param3', value: { ok: true } },
  ])
  expect(paramEntries('solo')).toEqual([{ label: 'Param', value: 'solo' }])
})
