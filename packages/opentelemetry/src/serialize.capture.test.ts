import { action, atom, computed } from '@reatom/core'
import { expect, test } from 'vitest'

import { createValueCapture } from './captureValues.ts'
import type { OtlpAttrValue } from './toOtlpValue.ts'

const representationBytes = (key: string, value: OtlpAttrValue) =>
  new TextEncoder().encode(JSON.stringify([key, value])).length

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'

test('serializes atoms, urls, dates, maps and jwt tokens', () => {
  const count = atom(1, 'counter')
  expect(
    createValueCapture().capture('state', {
      count,
      url: new URL('https://a.b/p?q=1&x=2#h'),
      date: new Date(0),
      map: new Map([[1, 2]]),
      jwt: JWT,
    }),
  ).toEqual({
    count: '[Atom counter]',
    url: 'https://a.b/p?q&x',
    date: '1970-01-01T00:00:00.000Z',
    map: { '@map': [[1, 2]] },
    jwt: '[jwt]',
  })
})

test('labels actions and computed atoms without calling them', () => {
  const save = action(() => {
    throw new Error('called')
  }, 'save')
  const doubled = computed(() => {
    throw new Error('called')
  }, 'doubled')
  const plain = function plain() {
    throw new Error('called')
  }
  const capture = createValueCapture()
  expect(capture.capture('state', save)).toBe('[Action save]')
  expect(capture.capture('state', doubled)).toBe('[Atom doubled]')
  expect(capture.capture('state', plain)).toBe('[Function]')
})

test('reads an atom name from its data descriptor and ignores inherited meta', () => {
  let reads = 0
  const count = atom(1, 'counter')
  Object.defineProperty(count, 'name', {
    configurable: true,
    get() {
      reads++
      return 'nope'
    },
  })
  expect(createValueCapture().capture('state', count)).toBe('[Atom]')
  const parent = atom(1, 'parent')
  function child() {}
  Object.setPrototypeOf(child, parent)
  expect(createValueCapture().capture('state', child)).toBe('[Function]')
  const hooked = () => {}
  Object.defineProperty(hooked, '__reatom', {
    configurable: true,
    get() {
      reads++
      return { reactive: true }
    },
  })
  expect(createValueCapture().capture('state', hooked)).toBe('[Function]')
  expect(reads).toBe(0)
})

test('formats url parts with intrinsic getters and drops userinfo, values and hash', () => {
  let reads = 0
  const unexpected = () => {
    reads++
    return 'nope'
  }
  const url = new URL('https://user:pass@a.b:8443/p?q=1&x=2&q=3#secret')
  for (const key of ['href', 'search', 'toJSON', 'toString', Symbol.toStringTag]) {
    Object.defineProperty(url, key, { configurable: true, get: unexpected })
  }
  const flagged = new URL('https://a.b/p?flag&a=1&flag')
  expect(createValueCapture().capture('state', url)).toBe(
    'https://a.b:8443/p?q&x',
  )
  expect(createValueCapture().capture('state', flagged)).toBe(
    'https://a.b/p?flag&a',
  )
  expect(createValueCapture().capture('state', new URL('https://a.b/p#h'))).toBe(
    'https://a.b/p',
  )
  expect(reads).toBe(0)
})

test('formats dates with the intrinsic toISOString and marks invalid dates', () => {
  let reads = 0
  const date = new Date(0)
  Object.defineProperty(date, 'toISOString', {
    configurable: true,
    value() {
      reads++
      return 'nope'
    },
  })
  Object.defineProperty(date, Symbol.toStringTag, {
    configurable: true,
    get() {
      reads++
      return 'URL'
    },
  })
  const capture = createValueCapture()
  expect(capture.capture('state', date)).toBe('1970-01-01T00:00:00.000Z')
  expect(capture.capture('state', new Date(Number.NaN))).toBe('[Invalid Date]')
  class Stamp extends Date {}
  expect(capture.capture('state', new Stamp(0))).toBe(
    '1970-01-01T00:00:00.000Z',
  )
  expect(reads).toBe(0)
})

test('serializes map and set entries with budgets, redaction and intrinsic iterators', () => {
  let reads = 0
  const map = new Map<unknown, unknown>([
    ['password', 'hunter2'],
    ['note', 'ada@example.com'],
    [1, JWT],
  ])
  const originalEntries = Map.prototype.entries
  Map.prototype.entries = function entries(this: Map<unknown, unknown>) {
    reads++
    return originalEntries.call(this)
  }
  const key = {
    toString() {
      reads++
      return 'password'
    },
  }
  map.set(key, 'visible')
  try {
    const seen: unknown[] = []
    const captured = createValueCapture((redactionKey, value) => {
      if (redactionKey === 'password') seen.push(value)
      return redactionKey === 'note' ? 'replaced' : value
    }).capture('state', map)
    expect(captured).toEqual({
      '@map': [
        ['password', '[redacted]'],
        ['note', 'replaced'],
        [1, '[jwt]'],
        [{ toString: '[Function]' }, 'visible'],
      ],
    })
    expect(seen).toEqual(['hunter2'])
    expect(reads).toBe(0)
  } finally {
    Map.prototype.entries = originalEntries
  }

  const set = new Set(['ada@example.com', 'hunter2'])
  const originalValues = Set.prototype.values
  Set.prototype.values = function values(this: Set<unknown>) {
    reads++
    return originalValues.call(this)
  }
  try {
    expect(createValueCapture().capture('state', set)).toEqual({
      '@set': ['[email]', 'hunter2'],
    })
    expect(reads).toBe(0)
  } finally {
    Set.prototype.values = originalValues
  }

  class Bag extends Map {}
  const bag = new Bag()
  bag.set('a', 1)
  expect(createValueCapture().capture('state', bag)).toEqual({
    '@map': [['a', 1]],
  })
  const circular = new Map<string, unknown>()
  circular.set('self', circular)
  expect(createValueCapture().capture('state', circular)).toEqual({
    '@map': [['self', '[Circular]']],
  })
})

test('stops map traversal on the shared entry and byte budgets', () => {
  const wide = new Map(Array.from({ length: 500 }, (_, index) => [index, index]))
  const wideResult = createValueCapture().capture('state', wide) as {
    '@map': OtlpAttrValue[]
  }
  expect(wideResult['@map'].length).toBeLessThanOrEqual(100)
  expect(wideResult['@map'].at(-1)).toBe('[Truncated]')
  expect(wideResult['@map'][0]).toEqual([0, 0])

  const heavy = new Map<string, string>()
  for (let index = 0; index < 500; index++) {
    heavy.set(`k${index}`, 'v'.repeat(100))
  }
  const heavyResult = createValueCapture().capture('state', heavy)
  expect(JSON.stringify(heavyResult)).toContain('[Truncated]')
  expect(representationBytes('state', heavyResult)).toBeLessThanOrEqual(8192)
})

test('names class instances from the constructor data descriptor', () => {
  let reads = 0
  class Box {
    leaked = 'class-field'
    get secret() {
      reads++
      return 'private'
    }
    toJSON() {
      reads++
      return { leaked: this.leaked }
    }
  }
  const capture = createValueCapture()
  expect(capture.capture('state', new Box())).toBe('[Box]')
  function HTMLInputElement() {}
  expect(
    capture.capture('node', Object.create(HTMLInputElement.prototype)),
  ).toBe('[HTMLInputElement]')
  expect(capture.capture('state', new (class { n = 1 })())).toBe('[Opaque]')

  const prototype = {}
  Object.defineProperty(prototype, 'constructor', {
    configurable: true,
    get() {
      reads++
      return function Secret() {}
    },
  })
  expect(capture.capture('state', Object.create(prototype))).toBe('[Opaque]')
  function Widget() {}
  Object.defineProperty(Widget, 'name', {
    configurable: true,
    get() {
      reads++
      return 'Widget'
    },
  })
  expect(capture.capture('state', Object.create(Widget.prototype))).toBe(
    '[Opaque]',
  )
  expect(reads).toBe(0)
  expect(
    JSON.stringify(capture.capture('state', new Box())).includes('class-field'),
  ).toBe(false)
})

test('scrubs jwt tokens and bearer credentials inside the scan bound', () => {
  const capture = createValueCapture()
  expect(capture.capture('note', `prefix ${JWT} suffix`)).toBe(
    'prefix [jwt] suffix',
  )
  expect(capture.capture('note', `again ${JWT}`)).toBe('again [jwt]')
  expect(capture.capture('note', `not${JWT}`)).toBe(`not${JWT}`)
  expect(capture.capture('note', 'Authorization: Bearer abc.def')).toBe(
    'Authorization: Bearer [redacted]',
  )
  expect(capture.capture('note', `bearer ${JWT}`)).toBe('Bearer [redacted]')
  expect(capture.capture('note', `mail ada@example.com ${JWT}`)).toBe(
    'mail [email] [jwt]',
  )
  const unit = 'abcdefghij@example.com '
  const head = `${unit.repeat(178)}xx`
  expect(head).toHaveLength(4096)
  expect(capture.capture('note', `${head}${JWT}`)).toBe(
    `${'[email] '.repeat(178)}xx${JWT}`,
  )
})
