import { catalog, expect, subscribe, test, vi } from 'test'

import { withComputed } from '../extensions'
import { identity } from '../utils'
import {
  _read,
  action,
  type Atom,
  atom,
  computed,
  context,
  createAtom,
  isConnected,
  mock,
  notify,
  top,
  withMiddleware,
  withTap,
} from './'

test('linking', () => {
  const fn = vi.fn(identity)

  const testEffect = computed(() => fn(catalog.offset()), 'linking.testEffect')

  const { store } = context().state

  expect(store.has(testEffect)).toBeFalsy()

  const un = testEffect.subscribe()
  expect(store.has(testEffect)).toBeTruthy()
  expect(fn).toBeCalledTimes(1)
  expect(fn).toBeCalledWith(0)
  const pageFrame = store.get(catalog.page)!
  const offsetFrame = store.get(catalog.offset)!
  const testEffectFrame = store.get(testEffect)!
  expect(pageFrame.pubs).toEqual([context()])
  expect(pageFrame.subs).toEqual([catalog.offset])
  expect(offsetFrame.pubs).toEqual([context(), pageFrame])
  expect(offsetFrame.subs).toEqual([testEffect])
  expect(testEffectFrame.pubs).toEqual([context(), offsetFrame])

  un()

  expect(pageFrame).toBe(store.get(catalog.page)!)
  expect(offsetFrame).toBe(store.get(catalog.offset)!)
  expect(testEffectFrame).toBe(store.get(testEffect)!)

  expect(pageFrame.subs.length).toBe(0)
  expect(offsetFrame.subs.length).toBe(0)
  expect(testEffectFrame.subs.length).toBe(0)
})

test('reading', () => {
  const bFn = vi.fn(() => catalog.page())
  const bMiddleware = vi.fn((state: number) => state)
  const b = computed(bFn, 'reading.b').extend(withTap(bMiddleware))

  expect(b()).toBe(0)
  expect(b()).toBe(0)
  expect(b()).toBe(0)
  expect(bFn).toBeCalledTimes(1)
  expect(bMiddleware).toBeCalledTimes(3)

  b.subscribe()
  expect(b()).toBe(0)
  expect(b()).toBe(0)
  expect(b()).toBe(0)
  expect(bFn).toBeCalledTimes(1)
  expect(bMiddleware).toBeCalledTimes(4)
})

test('disconnect tail deps', () => {
  expect(isConnected(catalog.visible)).toBe(false)
  catalog.preview.subscribe()
  expect(isConnected(catalog.visible)).toBe(true)
  expect(catalog.preview()?.title).toBe('Alpha')

  catalog.selectedId.set(1)
  notify()
  expect(isConnected(catalog.visible)).toBe(false)
  const staleVisible = _read(catalog.visible)!.state

  catalog.filter.set('Alph')
  notify()
  expect(catalog.preview()?.title).toBe('Beta')
  expect(isConnected(catalog.visible)).toBe(false)
  expect(_read(catalog.visible)!.state).toBe(staleVisible)
})

test('deps shift', () => {
  const name = 'depsShift'
  const dep0 = atom(0, `${name}.dep0`)
  const dep1 = atom(0, `${name}.dep1`)
  const dep2 = atom(0, `${name}.dep2`)
  const deps = [dep0, dep1, dep2]

  const a = computed(() => deps.forEach((dep) => dep()), `${name}.a`)

  a.subscribe()

  dep0.set(dep0() + 1)
  notify()
  expect(isConnected(dep0)).toBeTruthy()

  deps.shift()
  dep0.set(dep0() + 1)
  expect(isConnected(dep0)).toBeTruthy()
  notify()
  expect(isConnected(dep0)).toBeFalsy()
})

test('subscribe to cached atom', () => {
  catalog.offset()
  catalog.offset.subscribe()

  const pageFrame = _read(catalog.page)
  expect(pageFrame?.subs.length).toBe(1)
})

test('subscribe initial callback runs in the target frame', () => {
  const callbackAtoms = new Array<ReturnType<typeof top>['atom']>()

  catalog.page.subscribe(() => {
    callbackAtoms.push(top().atom)
  })

  expect(callbackAtoms).toEqual([catalog.page])

  catalog.page.set(1)
  notify()

  expect(callbackAtoms).toEqual([catalog.page, catalog.page])
})

test('update propagation for atom with listener', () => {
  const cbOffset = subscribe(catalog.offset)
  const cbRange = subscribe(catalog.rangeEnd)

  expect(cbOffset).toBeCalledTimes(1)
  expect(cbRange).toBeCalledTimes(1)

  catalog.page.set(1)
  notify()

  expect(cbOffset).toBeCalledTimes(2)
  expect(cbOffset).toBeCalledWith(1)
  expect(cbRange).toBeCalledTimes(2)
  expect(cbRange).toBeCalledWith(2)

  cbRange.unsubscribe()
  expect(_read(catalog.offset)!.subs.length).toBe(1)
  expect(_read(catalog.rangeEnd)!.subs.length).toBe(0)
  catalog.page.set(2)
  notify()
  expect(cbOffset).toBeCalledTimes(3)
  expect(cbOffset).toBeCalledWith(2)

  catalog.rangeEnd.subscribe(cbRange)
  expect(_read(catalog.offset)!.subs.length).toBe(2)

  computed(() => catalog.rangeEnd()).subscribe()
  expect(_read(catalog.offset)!.subs.length).toBe(2)
})

test('conditional deps duplication', () => {
  const fn = subscribe(
    computed(() => catalog.preview(), 'conditionalDeps.testEffect'),
  )

  expect(fn).toBeCalledTimes(1)
  expect(fn).toBeCalledWith({ id: 0, title: 'Alpha' })

  expect(isConnected(catalog.selected)).toBe(true)
  expect(isConnected(catalog.visible)).toBe(true)

  catalog.selectedId.set(1)
  notify()
  expect(fn).toBeCalledTimes(2)
  expect(fn).toBeCalledWith({ id: 1, title: 'Beta' })

  expect(isConnected(catalog.selected)).toBe(true)
  expect(isConnected(catalog.visible)).toBe(false)

  catalog.filter.set('Alph')
  notify()
  expect(fn).toBeCalledTimes(2)

  catalog.items.set((current) =>
    current.map((item) => (item.id === 1 ? { id: 1, title: 'Beta!' } : item)),
  )
  notify()
  expect(fn).toBeCalledTimes(3)
  expect(fn).toBeCalledWith({ id: 1, title: 'Beta!' })

  catalog.selectedId.set(null)
  notify()
  expect(fn).toBeCalledTimes(4)
  expect(fn).toBeCalledWith({ id: 0, title: 'Alpha' })

  expect(isConnected(catalog.selected)).toBe(true)
  expect(isConnected(catalog.visible)).toBe(true)

  fn.unsubscribe()
  expect(isConnected(catalog.selected)).toBe(false)
  expect(isConnected(catalog.visible)).toBe(false)
})

test('computed without dependencies', () => {
  const name = 'noDeps'

  const a = createAtom(
    {
      initState: 0,
      computed: (state) => state + 1,
    },
    `${name}.a`,
  )

  expect(a()).toBe(1)
  expect(a()).toBe(1)
  expect(a.set(10)).toBe(11)

  a.subscribe()
  expect(a()).toBe(11)
  expect(a()).toBe(11)
  expect(a.set(100)).toBe(101)
})

test('error tracking', () => {
  const name = 'errorTracking'
  const a = atom(0, `${name}.a`)
  const b = computed(() => {
    const aState = a()
    if (aState < 5) throw new Error('error')
    success = true
    return a()
  }, `${name}.b`)
  computed(() => {
    try {
      b()
    } catch {
      // nothing
    }
  }, `${name}.effect`).subscribe()
  let success = false

  expect(isConnected(b)).toBe(true)
  expect(() => b()).toThrow()

  a.set(1)
  notify()
  expect(() => b()).toThrow()

  a.set(10)
  notify()
  expect(success).toBe(true)
  expect(b()).toBe(10)
})

test('middleware connection', () => {
  const name = 'middlewareConnection'
  const before = atom(null, `${name}.before`)
  const after = atom(null, `${name}.after`)
  const target = atom(null, `${name}.target`).extend(
    (middleware) =>
      ((...a: Parameters<typeof middleware>) => {
        before()
        const state = middleware(...a)
        after()
        return state
      }) as typeof middleware,
  )

  target.subscribe()
  expect(isConnected(target)).toBe(true)
  expect(isConnected(before)).toBe(false)
  expect(isConnected(after)).toBe(false)
})

test('computed should not accept params', () => {
  const name = 'computedNoParams'
  const dep = atom(0, `${name}.a`)
  const bComputed = vi.fn(() => dep())
  const lowLevelComputed = createAtom({ computed: bComputed }, `${name}.b`)
  const normalComputed = computed(() => dep(), `${name}.c`)

  expect(lowLevelComputed()).toBe(0)
  expect(lowLevelComputed()).toBe(0)
  expect(normalComputed()).toBe(0)
  expect(bComputed).toBeCalledTimes(1)

  dep.set((s) => s + 1)
  expect(lowLevelComputed()).toBe(1)
  expect(normalComputed()).toBe(1)
  expect(bComputed).toBeCalledTimes(2)

  expect(lowLevelComputed.set(2)).toBe(2)
  expect(lowLevelComputed()).toBe(2)
  // @ts-expect-error
  expect(() => normalComputed.set(2)).toThrow()
  // // @ts-expect-error
  // expect(() => normalComputed(2)).toThrow()
  expect(normalComputed()).toBe(1)
  expect(bComputed).toBeCalledTimes(2)
})

test('deps state cache do not cache deps pubs', async () => {
  const factory = atom<null | Atom<number | number>>(null)
  const proxyFn = vi.fn(() => factory()?.() ?? null)
  const proxy = computed(proxyFn)
  const consumerFn = vi.fn(() => proxy())
  const consumer = computed(consumerFn)

  expect(consumer()).toBe(null)

  const dep = factory.set(
    // @ts-ignore
    () => atom(null),
  )!

  proxyFn.mockClear()
  consumerFn.mockClear()

  // relinking process is trying to invalidate deps
  // and if it's states didn't change (null === null)
  // it may cache the deps, which is wrong and
  // it is where the original issue comes from
  // (`proxy` has only one pub, but should have two)
  consumer.subscribe()

  expect(proxyFn).toBeCalledTimes(1)
  expect(consumerFn).toBeCalledTimes(0)

  const { store } = context().state
  expect(store.get(consumer)!.subs.length).toBe(1)
  expect(store.get(proxy)!.subs.length).toBe(1)
  expect(store.get(dep)!.subs.length).toBe(1)

  dep.set(1)
  notify()
  expect(consumer()).toBe(1)
})

test('bidirectional link', () => {
  const name = 'bidirectionalLink'

  const single = atom(0, `${name}.single`).extend(
    withComputed(() => double() / 2),
  )
  const double: Atom<number> = atom(0, `${name}.double`).extend(
    withComputed(() => single() * 2),
  )

  expect(single()).toBe(0)
  expect(double()).toBe(0)

  single.set(1)
  expect(single()).toBe(1)
  expect(double()).toBe(2)

  double.set(8)
  expect(single()).toBe(4)
  expect(double()).toBe(8)

  single.subscribe()
  double.set(10)
  notify()
  expect(context().state.store.get(single)!.state).toBe(5)
})

test('middlewares order', () => {
  const name = 'middlewaresOrder'
  let logs: number[] = []
  const a = atom(0, `${name}.a`).extend(
    withMiddleware(() => (next, ...args) => {
      logs.push(1)
      return next(...args)
    }),
    withMiddleware(() => (next, ...args) => {
      logs.push(2)
      return next(...args)
    }),
  )

  expect(a()).toBe(0)
  expect(logs).toEqual([2, 1])
})

test('read middleware', () => {
  const name = 'readMiddleware'

  let externalState = 1

  const a = atom(0, `${name}.a`).extend(
    withMiddleware(
      () =>
        (next, ...args) => {
          top().state = externalState
          return next(...args)
        },
      'read',
    ),
  )

  expect(a()).toBe(1)
})

test('reactivity restored after error', () => {
  const name = 'reactivityRestoredAfterError'
  const source = atom(0, `${name}.source`)
  let shouldThrow = false
  const dep = computed(() => {
    source()
    if (shouldThrow) throw new Error('error')
    return 'state'
  }, `${name}.dep`)
  const consumer = computed(() => {
    return dep()
  }, `${name}.consumer`)
  const states = new Array<string>()

  consumer.subscribe((state) => states.push(state))
  expect(states).toEqual(['state'])

  shouldThrow = true
  source.set(1)
  notify()
  expect(states).toEqual(['state'])
  expect(() => consumer()).toThrow('error')

  shouldThrow = false
  source.set(2)
  notify()
  expect(consumer()).toBe('state')
  expect(states).toEqual(['state'])
})

test('error propagation for subscribe callback', () => {
  const name = 'errorSubscribe'

  const flag = atom(false, `${name}.flag`)
  const dep = computed(() => {
    if (flag()) {
      throw new Error(name)
    }
    return 'state'
  }, `${name}.dep`)

  const listener = subscribe(dep)
  expect(listener).toBeCalledTimes(1)
  expect(listener).toBeCalledWith('state')

  flag.set(true)
  notify()
  // without errorCb the throw escapes to the notify queue; userCb is skipped
  expect(listener).toBeCalledTimes(1)
  expect(() => dep()).toThrow(name)
})

test('subscribe errorCb receives thrown error and skips userCb', () => {
  const name = 'subscribeErrorCb'
  const source = atom(0, `${name}.source`)
  let shouldThrow = false
  const dep = computed(() => {
    let n = source()
    if (shouldThrow) throw new Error(name)
    return `ok-${n}`
  }, `${name}.dep`)

  const states: string[] = []
  const errors: unknown[] = []

  dep.subscribe(
    (state) => states.push(state),
    (error) => errors.push(error),
  )
  expect(states).toEqual(['ok-0'])
  expect(errors).toEqual([])

  shouldThrow = true
  source.set(1)
  notify()
  expect(states).toEqual(['ok-0'])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toBeInstanceOf(Error)
  expect((errors[0] as Error).message).toBe(name)

  shouldThrow = false
  source.set(2)
  notify()
  expect(states).toEqual(['ok-0', 'ok-2'])
  expect(errors).toHaveLength(1)
})

test('subscribe userCb fires on recovery to the same state after errorCb', () => {
  const name = 'subscribeErrorRecoverySameState'
  const source = atom(0, `${name}.source`)
  let shouldThrow = false
  const dep = computed(() => {
    source()
    if (shouldThrow) throw new Error(name)
    return 'same'
  }, `${name}.dep`)

  const states: string[] = []
  const errors: unknown[] = []

  dep.subscribe(
    (state) => states.push(state),
    (error) => errors.push(error),
  )
  expect(states).toEqual(['same'])

  shouldThrow = true
  source.set(1)
  notify()
  expect(errors).toHaveLength(1)
  expect(states).toEqual(['same'])

  shouldThrow = false
  source.set(2)
  notify()
  // the subscriber saw an error last, so an equal state must still be delivered
  expect(states).toEqual(['same', 'same'])
  expect(errors).toHaveLength(1)
})

test('subscribe errorCb receives initial error', () => {
  const name = 'subscribeInitError'
  const dep = computed(() => {
    throw new Error(name)
  }, `${name}.dep`)

  const states: string[] = []
  const errors: unknown[] = []

  dep.subscribe(
    (state) => states.push(state),
    (error) => errors.push(error),
  )
  expect(states).toEqual([])
  expect(errors).toHaveLength(1)
  expect((errors[0] as Error).message).toBe(name)
})

test('subscribe without errorCb still throws on init', () => {
  const name = 'subscribeInitThrow'
  const dep = computed(() => {
    throw new Error(name)
  }, `${name}.dep`)

  expect(() => dep.subscribe(() => {})).toThrow(name)
})

test('mock action returns the mocked payload', () => {
  const name = 'mockAction'
  const doSmth = action((n: number) => n * 2, name)
  const unmock = mock(doSmth, (n) => n * 10)

  expect(doSmth(1)).toBe(10)

  unmock()
  expect(doSmth(1)).toBe(2)
})

test('mock atom intercepts set', () => {
  const name = 'mockAtom'
  const counter = atom(0, name)
  const unmock = mock(counter, (value: number) => value + 100)

  counter.set(1)
  expect(counter()).toBe(101)

  unmock()
  counter.set(2)
  expect(counter()).toBe(2)
})
