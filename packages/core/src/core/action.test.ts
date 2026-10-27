import { catalog, expect, subscribe, test } from 'test'

import { addCallHook } from '../extensions'
import {
  framePromise,
  getCalls,
  getStackTrace,
  schedule,
  wrap,
} from '../methods'
import { sleep } from '../utils'
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

test('calls log of many calls in one tick', () => {
  const act = action((n: number) => n * 2, 'manyCalls.act')
  const count = 20_000

  for (let i = 0; i < count; i++) act(i)

  const calls = _read(act)!.state
  expect(calls).toHaveLength(count)
  expect(calls[0]).toEqual({ params: [0], payload: 0 })
  expect(calls[count - 1]).toEqual({
    params: [count - 1],
    payload: 2 * (count - 1),
  })

  notify()
  expect(_read(act)!.state).toEqual([])

  act(1)
  expect(_read(act)!.state).toEqual([{ params: [1], payload: 2 }])
})

test('calls per tick scale linearly, not quadratically', () => {
  const act = action((n: number) => n * 2, 'linearCalls.act')

  const batch = (count: number) => {
    const start = performance.now()
    for (let i = 0; i < count; i++) act(i)
    const duration = performance.now() - start
    notify()
    return duration
  }
  const time = (count: number) =>
    Math.min(batch(count), batch(count), batch(count))

  time(1000) // warmup
  // 4x calls should cost about 4x time; the quadratic copy costs ~16x
  expect(time(20_000)).toBeLessThan(time(5_000) * 8)
})

// logs past 256 calls in a tick are appended in place, fill past that
const fill = (act: (n: number) => unknown) => {
  let filled = Array.from({ length: 300 }, (_, i) => i - 300)
  filled.forEach((n) => act(n))
  return filled
}

test('calls log snapshots between calls in one tick', async () => {
  const act = action((n: number) => {
    framePromise().then((payload) => resolved.push(payload))
    return n
  }, 'callsSnapshots.act')
  const resolved: unknown[] = []
  const log = computed(
    () => getCalls(act).map(({ payload }) => payload),
    'callsSnapshots.log',
  )

  const filled = fill(act)
  act(10)
  act(11)
  const first = getCalls(act)
  expect(log()).toEqual([...filled, 10, 11])
  act(12)
  act(13)
  expect(log()).toEqual([12, 13])
  expect(first.map(({ payload }) => payload)).toEqual([...filled, 10, 11])
  expect(getCalls(act).map(({ payload }) => payload)).toEqual([
    ...filled,
    10,
    11,
    12,
    13,
  ])

  await wrap(sleep())
  expect(resolved).toEqual([...filled, 10, 11, 12, 13])

  act(14)
  expect(log()).toEqual([14])
})

test('reentrant calls: framePromise and log order', async () => {
  const resolved: number[] = []
  const act = action((n: number) => {
    if (n === 11) {
      framePromise().then((payload) => resolved.push(payload as number))
      act(12)
    }
    return n
  }, 'reentrant.act')

  const filled = fill(act)
  act(10)
  act(11)

  // the log keeps every call in completion order: the nested call lands
  // before the outer call that started it
  expect(getCalls(act).map(({ payload }) => payload)).toEqual([
    ...filled,
    10,
    12,
    11,
  ])

  await wrap(sleep())
  // the promise belongs to its own call, not to a log position
  expect(resolved).toEqual([11])
})

test('subscribe inside a call', async () => {
  const payloads: number[] = []
  const act = action((n: number) => {
    if (n === 11) act.subscribe((payload) => payloads.push(payload))
    return n
  }, 'subInside.act')

  const filled = fill(act)
  act(10)
  act(11)
  act(12)
  // a subscriber added mid-call is not notified within the current tick
  expect(payloads).toEqual([])

  await wrap(sleep())
  // the flush delivers the log captured at subscribe time
  expect(payloads).toEqual([...filled, 10, 11, 12])

  act(13)
  await wrap(sleep())
  expect(payloads).toEqual([...filled, 10, 11, 12, 13])
})

test('notify inside a call', async () => {
  const resolved: unknown[] = []
  const act = action((n: number) => {
    if (n === 10) {
      framePromise().then((payload) => resolved.push(payload))
      // notify() flushes hooks synchronously, before this payload exists
      notify()
    }
    return n
  }, 'notifyInside.act')

  const filled = fill(act)
  act(10)

  expect(getCalls(act).map(({ payload }) => payload)).toEqual([...filled, 10])

  await wrap(sleep())
  // the hook ran before the payload existed and read the previous call
  expect(resolved).toEqual([-1])
})

test('framePromise in a middleware after a nested call', async () => {
  let resolved: unknown
  const inner = action(
    (n: number) => `inner${n}`,
    'nestedMiddleware.inner',
  ).extend(
    withMiddleware(() => (next, ...params) => {
      const state = next(...params)
      framePromise().then((payload) => (resolved = payload))
      return state
    }),
  )
  const outer = action((n: number) => {
    if (n === 10) inner(1)
    return 'outer'
  }, 'nestedMiddleware.outer')

  fill(outer)
  outer(10)

  await wrap(sleep())
  expect(resolved).toBe('inner1')
})

test('a removed call hook keeps its calls log snapshot', async () => {
  const payloads: number[] = []
  const act = action((n: number) => n, 'removedHook.act')
  const stop = addCallHook(act, (payload) => payloads.push(payload))

  const filled = fill(act)
  stop()
  act(10)
  act(11)

  await wrap(sleep())
  expect(payloads).toEqual(filled)
})

test('framePromise after the payload of a call sharing the log', async () => {
  const later: Array<Promise<unknown>> = []
  let bound: () => Promise<unknown> = () => Promise.resolve()
  const act = action((n: number) => {
    if (n === 10) {
      later.push(schedule(() => framePromise(), 'hook'))
      bound = wrap(() => framePromise())
    }
    return n
  }, 'afterPayload.act')

  fill(act)
  act(10)
  act(11)
  later.push(bound())

  expect(await wrap(Promise.all(later))).toEqual([10, 10])
})
