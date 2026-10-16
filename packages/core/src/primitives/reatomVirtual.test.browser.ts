import { expect, test } from 'test'

import { atom } from '../core'
import { effect, take, wrap } from '../methods'
import { rAF } from '../web/rAF'
import { reatomVirtual } from './reatomVirtual'

const ROW = 20

const nextFrames = async (count = 2) => {
  for (let index = 0; index < count; index++) await wrap(take(rAF))
}

const mountList = (count: number) => {
  const rows = atom(
    Array.from({ length: count }, (_, id) => ({ id })),
    'browserRows',
  )
  const virtual = reatomVirtual(
    rows,
    { itemSize: ROW, overscan: 2 },
    'browserVirtual',
  )

  const scroller = document.createElement('div')
  scroller.style.cssText = 'height: 100px; overflow-y: auto;'
  const before = document.createElement('div')
  const content = document.createElement('div')
  content.style.position = 'sticky'
  const after = document.createElement('div')
  scroller.append(before, content, after)
  document.body.append(scroller)

  const render = effect(() => {
    const { before: beforeSize, after: afterSize } = virtual.padding()
    const inset = `${virtual.stickyInset()}px`
    before.style.height = `${beforeSize}px`
    after.style.height = `${afterSize}px`
    content.style.top = inset
    content.style.bottom = inset
    content.replaceChildren(
      ...virtual.items().map(({ id }) => {
        const row = document.createElement('div')
        row.style.height = `${ROW}px`
        row.textContent = String(id)
        return row
      }),
    )
  }, 'browserRender')

  const unbind = virtual.bindScroller(scroller)

  const dispose = () => {
    unbind()
    render.unsubscribe()
    scroller.remove()
  }

  return { rows, virtual, scroller, content, dispose }
}

test('bindScroller feeds the viewport and the scroll position', async () => {
  const { virtual, scroller, dispose } = mountList(1000)
  expect(virtual.viewportSize()).toBe(100)
  expect(scroller.style.overflowAnchor).toBe('none')
  expect(scroller.scrollHeight).toBe(1000 * ROW)

  scroller.scrollTop = 4000
  await wrap(nextFrames())
  expect(virtual.scrollOffset()).toBe(4000)
  expect(virtual().offset).toBe(198)
  expect(virtual.items().length).toBe(9)

  dispose()
  expect(scroller.style.overflowAnchor).toBe('')
})

test('programmatic scrolls move the scroller', async () => {
  const { virtual, scroller, content, dispose } = mountList(1000)
  virtual.scrollToIndex(500)
  await wrap(nextFrames())
  expect(scroller.scrollTop).toBe(500 * ROW)
  const firstVisible = content.children[2]!
  expect(firstVisible.textContent).toBe('500')
  expect(
    firstVisible.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top,
  ).toBe(0)
  dispose()
})

test('stickToEnd follows appends until the user scrolls up', async () => {
  const { rows, virtual, scroller, dispose } = mountList(100)
  virtual.stickToEnd.set(true)
  await wrap(nextFrames())
  expect(scroller.scrollTop).toBe(100 * ROW - 100)

  rows.set([...rows(), { id: 100 }, { id: 101 }])
  await wrap(nextFrames())
  expect(scroller.scrollTop).toBe(102 * ROW - 100)
  expect(virtual.stickToEnd()).toBe(true)

  scroller.scrollTop = 200
  await wrap(nextFrames())
  expect(virtual.stickToEnd()).toBe(false)
  expect(virtual.scrollOffset()).toBe(200)
  dispose()
})

test('the rendered block never leaves the viewport before the window catches up', async () => {
  const { scroller, content, dispose } = mountList(1000)
  await wrap(nextFrames())
  scroller.scrollTop = 10000
  const contentRect = content.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  expect(contentRect.top).toBeLessThanOrEqual(scrollerRect.top)
  expect(contentRect.bottom).toBeGreaterThanOrEqual(scrollerRect.bottom)
  dispose()
})
