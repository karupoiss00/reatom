import { expect, subscribe, test } from 'test'

import {
  collapsedPreview,
  createInspectorFields,
  formatLeaf,
  readFieldPage,
} from './model'

test('collapsed preview shows shallow values and skips nested fields', () => {
  const preview = collapsedPreview({
    board: ['X', 'O', null],
    nested: { secret: 1 },
    winner: 'X',
  })

  expect(preview).toContain('Object {')
  expect(preview).toContain('board: Array(3)')
  expect(preview).toContain('"X"')
  expect(preview).toContain('winner: "X"')
  expect(preview).toContain('nested: Object')
  expect(preview.includes('secret')).toBe(false)
})

test('collapsed object preview keeps the first three keys', () => {
  expect(collapsedPreview({ a: 1, b: 2, c: 3, d: 4 })).toBe(
    'Object {a: 1, b: 2, c: 3, …}',
  )
  expect(collapsedPreview({ a: 1, b: 2, c: 3 })).toBe(
    'Object {a: 1, b: 2, c: 3}',
  )
})

test('collapsed array preview quotes cells and marks holes', () => {
  const cells: Array<string | null | undefined> = ['X', 'O', null]
  delete cells[1]
  expect(collapsedPreview(cells)).toContain('"X", empty, null')
  expect(collapsedPreview(['X', 'O'])).toBe('Array(2) ["X", "O"]')
})

test('formatLeaf matches inspector literals', () => {
  expect(formatLeaf(-0).text).toBe('-0')
  expect(formatLeaf(1n).text).toBe('1n')
  expect(formatLeaf('hello').text).toBe('"hello"')
  expect(formatLeaf(null).tone).toBe('null')
})

test('field page stays lazy, labeled, and actionable', () => {
  const value = Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => [`k${index}`, index]),
  )
  const hooks = {
    fieldLabel: (key: string) => key.toUpperCase(),
    fieldActions: (key: string) =>
      key === 'k0' ? [{ label: 'Show k0 on the timeline', onClick() {} }] : [],
    expandable: (entry: unknown) => entry !== value.k1,
  }
  const page = readFieldPage(value, hooks, 20)
  expect(page?.entries).toHaveLength(20)
  expect(page?.truncated).toBe(true)
  expect(page?.entries[0]?.label).toBe('K0')
  expect(page?.entries[0]?.actions?.[0]?.label).toBe('Show k0 on the timeline')
  expect(
    readFieldPage({ a: { secret: 1 } }, {}, 20)?.entries.map(
      (entry) => entry.key,
    ),
  ).toEqual(['a'])
  expect(readFieldPage(value, { expandable: () => false }, 20)).toBeNull()
  const rest = readFieldPage(value, {}, 40)
  expect(rest?.truncated).toBe(false)
  expect(rest?.entries).toHaveLength(25)
})

test('map and set row ids follow the key, not the index', () => {
  const mapFields = createInspectorFields('_Admin.inspector.map')
  const before = new Map<unknown, unknown>([
    ['keep', 1],
    ['later', 2],
  ])
  const beforePage = readFieldPage(before, {}, 20)
  mapFields.sync(beforePage?.entries ?? [])
  const keepId = beforePage?.entries.find((entry) => entry.value === 1)?.id
  const keep = keepId ? mapFields.rows.map().get(keepId) : undefined
  const after = new Map<unknown, unknown>([
    ['inserted', 0],
    ['keep', 1],
    ['later', 2],
  ])
  const afterPage = readFieldPage(after, {}, 20)
  mapFields.sync(afterPage?.entries ?? [])
  expect(afterPage?.entries.find((entry) => entry.value === 1)?.id).toBe(keepId)
  expect(mapFields.rows.map().get(keepId!)).toBe(keep)
  expect(keep?.value()).toBe(1)

  const setFields = createInspectorFields('_Admin.inspector.set')
  const setBefore = new Set(['keep', 'later'])
  const setBeforePage = readFieldPage(setBefore, {}, 20)
  setFields.sync(setBeforePage?.entries ?? [])
  const setKeepId = setBeforePage?.entries.find(
    (entry) => entry.value === 'keep',
  )?.id
  const setKeep = setKeepId ? setFields.rows.map().get(setKeepId) : undefined
  const setAfter = new Set(['inserted', 'keep', 'later'])
  const setAfterPage = readFieldPage(setAfter, {}, 20)
  setFields.sync(setAfterPage?.entries ?? [])
  expect(
    setAfterPage?.entries.find((entry) => entry.value === 'keep')?.id,
  ).toBe(setKeepId)
  expect(setFields.rows.map().get(setKeepId!)).toBe(setKeep)
  expect(setKeep?.label()).toBe('1')
})

test('string and number map keys stay distinct', () => {
  const page = readFieldPage(
    new Map<unknown, unknown>([
      ['1', 'a'],
      [1, 'b'],
    ]),
    {},
    20,
  )
  expect(page?.entries.map((entry) => entry.label)).toEqual(['"1"', '1'])
  expect(page?.entries.map((entry) => entry.id)).toEqual([
    'map:string:1',
    'map:number:1',
  ])
})

test('symbols with the same description stay separate rows', () => {
  const left = Symbol('s')
  const right = Symbol('s')
  const page = readFieldPage({ [left]: 1, [right]: 2 }, {}, 20)
  const symbols = page?.entries.filter((entry) => entry.tone === 'symbol') ?? []
  expect(symbols.map((entry) => entry.id)).toEqual([
    'symbol:Symbol(s)',
    'symbol:Symbol(s)#2',
  ])
  const fields = createInspectorFields('_Admin.inspector.symbols')
  fields.sync(page?.entries ?? [])
  expect([...fields.rows.map().values()].map((row) => row.value())).toEqual([
    1, 2,
  ])
})

test('an unrelated field update keeps the other field node', () => {
  const fields = createInspectorFields('_Admin.inspector.test')
  const nested = { n: 1 }
  fields.sync([
    { key: 'board', value: nested },
    { key: 'winner', value: 'X' },
  ])
  const board = fields.rows.map().get('board')
  const winner = fields.rows.map().get('winner')
  const winnerUpdates = subscribe(winner!.value)
  fields.sync([
    { key: 'board', value: { n: 2 } },
    { key: 'winner', value: 'X' },
  ])
  expect(fields.rows.map().get('board')).toBe(board)
  expect(fields.rows.map().get('winner')).toBe(winner)
  expect(winnerUpdates).toHaveBeenCalledTimes(1)
  expect(board!.value()).toEqual({ n: 2 })
  expect(winner!.value()).toBe('X')
})
