import { describe, expect, subscribe, test } from 'test'

import { atom, computed, notify } from '../core'
import { reatomLinkedList } from './reatomLinkedList'
import { reatomVirtual } from './reatomVirtual'

interface Row {
  id: number
  size?: number
}

const createRows = (count: number): Array<Row> =>
  Array.from({ length: count }, (_, id) => ({ id }))

const setup = (
  count: number,
  options: { viewportSize?: number; overscan?: number } = {},
) => {
  const rows = atom(createRows(count), 'rows')
  const virtual = reatomVirtual(
    rows,
    { itemSize: 10, viewportSize: 30, overscan: 0, ...options },
    'virtual',
  )
  const ids = () => virtual.items().map(({ id }) => id)
  return { rows, virtual, ids }
}

describe('window', () => {
  test('renders the items that intersect the viewport', () => {
    const { virtual, ids } = setup(100)
    expect(ids()).toEqual([0, 1, 2])
    virtual.scrollTo(25)
    expect(ids()).toEqual([2, 3, 4, 5])
    expect(virtual().offset).toBe(2)
    expect(virtual().size).toBe(100)
  })

  test('overscan adds items on both sides', () => {
    const { virtual, ids } = setup(100, { overscan: 2 })
    virtual.scrollTo(50)
    expect(ids()).toEqual([3, 4, 5, 6, 7, 8, 9])
    virtual.scrollTo(0)
    expect(ids()).toEqual([0, 1, 2, 3, 4])
  })

  test('padding and total size stand in for the hidden items', () => {
    const { virtual } = setup(100)
    virtual.scrollTo(25)
    expect(virtual.totalSize()).toBe(1000)
    expect(virtual.padding()).toEqual({ before: 20, after: 940 })
  })

  test('sticky inset is the rendered overflow of the viewport', () => {
    const { virtual } = setup(100, { overscan: 1 })
    expect(virtual.stickyInset()).toBe(-10)
    virtual.scrollTo(50)
    expect(virtual.stickyInset()).toBe(-20)
    const { virtual: short } = setup(2)
    expect(short.stickyInset()).toBe(0)
  })

  test('the viewport size drives the window', () => {
    const { virtual, ids } = setup(100, { viewportSize: 0 })
    expect(ids()).toEqual([])
    virtual.viewportSize.set(20)
    expect(ids()).toEqual([0, 1])
  })

  test('the rendered items notify only when they change', () => {
    const { virtual, rows } = setup(10)
    const track = subscribe(virtual.items)
    rows.set([...rows(), { id: 10 }])
    notify()
    expect(track).toHaveBeenCalledTimes(1)
    virtual.scrollTo(10)
    notify()
    expect(track).toHaveBeenCalledTimes(2)
  })
})

describe('scroll offset', () => {
  test('is clamped to the scrollable range', () => {
    const { virtual, rows, ids } = setup(10)
    virtual.scrollTo(-5)
    expect(virtual.scrollOffset()).toBe(0)
    virtual.scrollTo(Infinity)
    expect(virtual.scrollOffset()).toBe(70)
    expect(ids()).toEqual([7, 8, 9])
    rows.set(rows().slice(0, 5))
    expect(virtual.scrollOffset()).toBe(20)
  })

  test('NaN throws with the field and the name', () => {
    const { virtual } = setup(10)
    expect(() => virtual.scrollTo(NaN)).toThrow(
      'The "offset" of the virtual "virtual" should be a number, received "NaN".',
    )
  })

  test('stickToEnd follows new items until a scroll away', () => {
    const { virtual, rows, ids } = setup(5)
    virtual.stickToEnd.set(true)
    expect(ids()).toEqual([2, 3, 4])
    rows.set([...rows(), { id: 5 }, { id: 6 }])
    expect(ids()).toEqual([4, 5, 6])
    virtual.scrollToIndex(0)
    expect(virtual.stickToEnd()).toBe(false)
    expect(ids()).toEqual([0, 1, 2])
  })

  test('turning stickToEnd off keeps the position', () => {
    const { virtual, rows } = setup(5)
    virtual.stickToEnd.set(true)
    rows.set([...rows(), { id: 5 }])
    expect(virtual.scrollOffset()).toBe(30)
    virtual.stickToEnd.set(false)
    expect(virtual.scrollOffset()).toBe(30)
  })

  test('stickToEnd accepts an external atom', () => {
    const following = atom(true)
    const virtual = reatomVirtual(atom(createRows(10)), {
      itemSize: 10,
      viewportSize: 30,
      stickToEnd: following,
    })
    expect(virtual.stickToEnd).toBe(following)
    expect(virtual.scrollOffset()).toBe(70)
  })
})

describe('scrollToIndex', () => {
  test('aligns like scrollIntoView', () => {
    const { virtual } = setup(100)
    virtual.scrollToIndex(10)
    expect(virtual.scrollOffset()).toBe(100)
    virtual.scrollToIndex(20, 'end')
    expect(virtual.scrollOffset()).toBe(180)
    virtual.scrollToIndex(50, 'center')
    expect(virtual.scrollOffset()).toBe(490)
  })

  test('nearest scrolls the least distance and keeps a visible item', () => {
    const { virtual } = setup(100)
    virtual.scrollTo(100)
    virtual.scrollToIndex(11, 'nearest')
    expect(virtual.scrollOffset()).toBe(100)
    virtual.scrollToIndex(15, 'nearest')
    expect(virtual.scrollOffset()).toBe(130)
    virtual.scrollToIndex(2, 'nearest')
    expect(virtual.scrollOffset()).toBe(20)
  })

  test('clamps the index and the target', () => {
    const { virtual } = setup(10)
    virtual.scrollToIndex(99)
    expect(virtual.scrollOffset()).toBe(70)
    const { virtual: empty } = setup(0)
    empty.scrollToIndex(3)
    expect(empty.scrollOffset()).toBe(0)
  })
})

describe('sizes', () => {
  test('an itemSize function estimates every item', () => {
    const sizes = [10, 20, 30, 40, 50]
    const rows = atom(sizes.map((size, id): Row => ({ id, size })))
    const virtual = reatomVirtual(rows, {
      itemSize: (row) => row.size!,
      viewportSize: 25,
      overscan: 0,
    })
    expect(virtual.totalSize()).toBe(150)
    virtual.scrollTo(15)
    expect(virtual.items().map(({ id }) => id)).toEqual([1, 2])
    expect(virtual.padding()).toEqual({ before: 10, after: 90 })
    virtual.scrollToIndex(3)
    expect(virtual.scrollOffset()).toBe(60)
  })

  test('measure corrects the estimate by item identity', () => {
    const { virtual, rows } = setup(10)
    const [first] = rows()
    virtual.measure(first!, 10)
    expect(virtual.totalSize()).toBe(100)
    virtual.measure(first!, 25)
    expect(virtual.totalSize()).toBe(115)
    rows.set([...rows()].reverse())
    expect(virtual.padding().after).toBe(115 - 30)
  })

  test('a size change above the viewport keeps the visible items in place', () => {
    const { virtual, rows, ids } = setup(100, { overscan: 3 })
    virtual.scrollTo(50)
    const visible = ids().slice(3)
    virtual.measure(rows()[2]!, 30)
    expect(virtual.scrollOffset()).toBe(70)
    virtual.measure(rows()[6]!, 30)
    expect(virtual.scrollOffset()).toBe(70)
    expect(ids().slice(3, 6)).toEqual(visible.slice(0, 3))
  })

  test('invalid sizes throw', () => {
    expect(() => reatomVirtual(atom([]), { itemSize: 0 }, 'zero')).toThrow(
      'The "itemSize" of the virtual "zero" should be a positive number, received "0".',
    )
    const { virtual, rows } = setup(3)
    expect(() => virtual.measure(rows()[0]!, -1)).toThrow(
      'The measured size in the virtual "virtual"',
    )
    const broken = reatomVirtual(
      atom([{ id: 0 }]),
      { itemSize: () => NaN },
      'broken',
    )
    expect(() => broken.totalSize()).toThrow(
      'The size of the item 0 in the virtual "broken"',
    )
  })
})

describe('sources', () => {
  test('a linked list feed that follows its tail', () => {
    const list = reatomLinkedList((id: number) => ({ id }), 'feed')
    list.createMany([[0], [1], [2], [3]])
    const virtual = reatomVirtual(list, {
      itemSize: 10,
      viewportSize: 20,
      overscan: 0,
      stickToEnd: atom(true),
    })
    expect(virtual.items().map(({ id }) => id)).toEqual([2, 3])
    list.createMany([[4], [5]])
    expect(virtual.items().map(({ id }) => id)).toEqual([4, 5])
    expect(virtual.items()[0]).toBe(list.find(({ id }) => id === 4))
  })

  test('a linked list read inside its batch throws', () => {
    const list = reatomLinkedList((id: number) => ({ id }))
    const virtual = reatomVirtual(list, { itemSize: 10 }, 'batched')
    list.batch(() => {
      list.create(1)
      expect(() => virtual.totalSize()).toThrow(
        `Can't compute the virtual "batched" inside the batching of its linked list.`,
      )
    })
  })

  test('default name derives from the source', () => {
    const virtual = reatomVirtual(
      computed(() => [1], 'numbers'),
      {
        itemSize: 1,
      },
    )
    expect(virtual.name).toMatch(/^numbers\.virtual#\d+$/)
  })
})

describe('reatomMap', () => {
  test('keeps the rendered node of an item while it stays in the window', () => {
    const { virtual } = setup(100)
    let renders = 0
    const rendered = virtual.reatomMap((row) => {
      renders++
      return { label: `#${row.id}` }
    })
    const labels = () => rendered.array().map(({ label }) => label)

    const unsubscribe = rendered.subscribe()
    notify()
    expect(labels()).toEqual(['#0', '#1', '#2'])
    const second = rendered.array()[1]

    virtual.scrollTo(10)
    notify()
    expect(labels()).toEqual(['#1', '#2', '#3'])
    expect(rendered.array()[0]).toBe(second)
    expect(renders).toBe(4)

    virtual.scrollTo(500)
    notify()
    expect(labels()).toEqual(['#50', '#51', '#52'])

    unsubscribe()
    notify()
    expect(rendered().size).toBe(0)
  })
})
