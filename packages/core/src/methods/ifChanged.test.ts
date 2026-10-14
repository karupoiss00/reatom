import { catalog, expect, test, vi } from 'test'

import { _read, type ActionState, computed } from '../core'
import { notify } from '../core'
import { sleep } from '../utils'
import { effect } from './effect'
import { getCalls, ifChanged } from './ifChanged'
import { wrap } from './wrap'

test('ifChanged', () => {
  const log = vi.fn<(newState: number, oldState?: number) => unknown>()
  const data = computed(() => {
    ifChanged(catalog.page, log)
  }, 'ifChanged.data')
  let un = data.subscribe()

  expect(log).toBeCalledTimes(1)
  expect(log).toBeCalledWith(0, undefined, true)

  catalog.page.set(1)
  notify()
  expect(log).toBeCalledTimes(2)
  expect(log).toBeCalledWith(1, 0, false)

  un()
  catalog.page.set(2)
  data()
  expect(log).toBeCalledTimes(3)
  expect(log).toBeCalledWith(2, 1, false)

  catalog.page.set(3)
  catalog.page.set(2)
  notify()
  data()
  expect(log).toBeCalledTimes(3)
  expect(log).toBeCalledWith(2, 1, false)
})

test('ifChanged few parents', () => {
  const log = vi.fn<(newState: number, oldState?: number) => unknown>()

  computed(() => {
    ifChanged(catalog.page, log)
    ifChanged(catalog.page, log)
  }).subscribe()
  computed(() => {
    ifChanged(catalog.page, log)
    ifChanged(catalog.page, log)
  }).subscribe()

  expect(log).toBeCalledTimes(4)

  catalog.page.set(1)
  notify()
  expect(log).toBeCalledTimes(8)
})

test('getCalls', async () => {
  const log = vi.fn<(payload: number, params: [value?: number]) => unknown>()
  const data = computed((state = 0) => {
    getCalls(catalog.page.go).forEach(({ payload, params }) =>
      log(payload, params),
    )
    return state
  }, 'ifChanged.data')
  data.subscribe()

  expect(log).toBeCalledTimes(0)
  expect(_read(catalog.page.go)?.subs).toEqual([data])

  catalog.page.go(3)
  expect(log).toBeCalledTimes(0)

  await wrap(sleep())
  expect(log).toBeCalledTimes(1)
  expect(log).toBeCalledWith(3, [3])
})

test('getCalls skip duplicates', async () => {
  const log = vi.fn<(payload: number, params: [value?: number]) => unknown>()
  const data = computed(() => {
    catalog.filter()
    getCalls(catalog.page.go).forEach(({ payload, params }) =>
      log(payload, params),
    )
  }, 'ifChangedDuplicates.data')
  data.subscribe()

  expect(log).toBeCalledTimes(0)
  expect(_read(catalog.page.go)?.subs).toEqual([data])

  catalog.page.go(3)
  expect(log).toBeCalledTimes(0)

  await wrap(sleep())
  expect(log).toBeCalledTimes(1)
  expect(log).toBeCalledWith(3, [3])

  log.mockClear()
  catalog.page.go(5)
  catalog.page.go(7)
  expect(log).toBeCalledTimes(0)
  data()
  expect(log).toBeCalledTimes(2)
  catalog.filter.set('A')
  data()
  expect(log).toBeCalledTimes(2)
})

test('getCalls in effect', async () => {
  const log = vi.fn<(call: ActionState) => unknown>()
  effect(() => {
    const calls = getCalls(catalog.page.go)
    log(calls)
  }, 'getCalls.data')

  expect(log).toBeCalledWith([])

  catalog.page.go(3)
  catalog.page.go(20)
  await wrap(sleep())
  expect(log).toBeCalledWith([
    { payload: 3, params: [3] },
    { payload: 20, params: [20] },
  ])

  catalog.page.go(2)
  await wrap(sleep())
  expect(log).toBeCalledWith([{ payload: 2, params: [2] }])
})

test('getCalls', async () => {
  expect(getCalls(catalog.page.go)).toEqual([])

  catalog.page.go(3)
  catalog.page.go(20)
  expect(getCalls(catalog.page.go)).toEqual([
    { payload: 3, params: [3] },
    { payload: 20, params: [20] },
  ])

  await wrap(sleep())

  catalog.page.go(2)
  expect(getCalls(catalog.page.go)).toEqual([{ payload: 2, params: [2] }])
})
