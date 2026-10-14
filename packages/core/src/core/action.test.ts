import { catalog, expect, subscribe, test } from 'test'

import { getStackTrace } from '../methods'
import type { Frame } from './'
import { _read, action, computed, notify, withMiddleware } from './'

test('action', () => {
  const name = 'action'
  const testAction = action((...params: any[]) => params, `${name}.testAction`)
  expect(testAction(1, 2, 3)).toEqual([1, 2, 3])
})

test('action cause stack', () => {
  const getTrace = (frame?: Frame) =>
    getStackTrace(frame)
      .replaceAll('catalog.', '')
      .replace(/\[#\d*\]/g, '')

  let logData
  const log = computed(() => {
    catalog.offset()
    logData = getTrace()
  }, 'log')
  log.subscribe()

  expect(logData).toBe('─log\n └─ offset\n    └─ page')

  catalog.page.next()
  notify()

  expect(logData).toBe('─log\n └─ offset\n    └─ page\n       └─ page.next')
  expect(getTrace(_read(log)!).replaceAll('\n', ' ')).toBe(
    '─log  └─ offset     └─ page        └─ page.next',
  )
})

test('actionState', () => {
  const name = 'actionState'
  const act = action((a: number, b: number) => a + b, `${name}.act`)

  act(0, 1)
  act(1, 2)
  expect(_read(act)!.state).toEqual([
    { params: [0, 1], payload: 1 },
    { params: [1, 2], payload: 3 },
  ])

  notify()
  expect(_read(act)!.state).toEqual([])
})

test('no args', () => {
  const name = 'noArgs'
  let i = 0
  const act = action(() => ++i, `${name}.act`)

  act()
  act()
  expect(_read(act)!.state).toEqual([
    { params: [], payload: 1 },
    { params: [], payload: 2 },
  ])
})

test('subscribe', () => {
  const sub = subscribe(catalog.page.go)
  expect(sub).toHaveBeenCalledTimes(0)

  catalog.page.go()
  notify()
  expect(sub).toHaveBeenCalledTimes(1)
  expect(sub).toHaveBeenCalledWith(0, [])

  catalog.page.go(1)
  notify()
  expect(sub).toHaveBeenCalledTimes(2)
  expect(sub).toHaveBeenCalledWith(1, [1])
})

action(() => 123).extend(
  withMiddleware(
    () =>
      (next, ...params) =>
        next(...params),
  ),
)
