import { afterEach, expect, subscribe, test, vi } from 'test'

import { notify } from '../core'
import { wrap } from '../methods'
import { sleep } from '../utils'
import { visibilityAtom } from './visibilityAtom'

type MockDocument = EventTarget & { visibilityState: DocumentVisibilityState }

const installDocument = (
  visibilityState: DocumentVisibilityState = 'visible',
): MockDocument => {
  const page = Object.assign(new EventTarget(), { visibilityState })
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('document', page)
  return page
}

const setVisibility = (
  page: MockDocument,
  visibilityState: DocumentVisibilityState,
) => {
  page.visibilityState = visibilityState
  page.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('visibilityAtom does not throw without document (SSR)', () => {
  expect(() => visibilityAtom()).not.toThrow()
  expect(visibilityAtom()).toBe('visible')
  expect(visibilityAtom.visibleAtAtom()).toBeUndefined()
  expect(visibilityAtom.hiddenAtAtom()).toBeUndefined()
  const unsubscribe = visibilityAtom.subscribe()
  expect(() => unsubscribe()).not.toThrow()
})

test('visibilityAtom reads visible and hidden from document', () => {
  const page = installDocument('visible')

  expect(visibilityAtom()).toBe('visible')

  page.visibilityState = 'hidden'

  expect(visibilityAtom()).toBe('hidden')
})

test('visibilityAtom tracks visible and hidden transitions', async () => {
  const page = installDocument('visible')
  const track = subscribe(visibilityAtom)

  notify()
  await wrap(sleep())

  expect(track).toHaveBeenLastCalledWith('visible')

  setVisibility(page, 'hidden')
  await wrap(sleep())

  expect(visibilityAtom()).toBe('hidden')
  expect(track).toHaveBeenLastCalledWith('hidden')

  setVisibility(page, 'visible')
  await wrap(sleep())

  expect(visibilityAtom()).toBe('visible')
  expect(track).toHaveBeenLastCalledWith('visible')

  track.unsubscribe()
})

test('visibleAtAtom and hiddenAtAtom record transition timestamps', async () => {
  const page = installDocument('visible')
  const now = vi.spyOn(Date, 'now')

  expect(visibilityAtom.visibleAtAtom()).toBeUndefined()
  expect(visibilityAtom.hiddenAtAtom()).toBeUndefined()

  const track = subscribe(visibilityAtom)
  notify()
  await wrap(sleep())

  expect(visibilityAtom.visibleAtAtom()).toBeUndefined()
  expect(visibilityAtom.hiddenAtAtom()).toBeUndefined()

  now.mockReturnValue(1_000)
  setVisibility(page, 'hidden')
  await wrap(sleep())

  expect(visibilityAtom.hiddenAtAtom()).toBe(1_000)
  expect(visibilityAtom.visibleAtAtom()).toBeUndefined()

  now.mockReturnValue(2_000)
  setVisibility(page, 'visible')
  await wrap(sleep())

  expect(visibilityAtom.visibleAtAtom()).toBe(2_000)
  expect(visibilityAtom.hiddenAtAtom()).toBe(1_000)

  now.mockReturnValue(3_000)
  setVisibility(page, 'hidden')
  await wrap(sleep())

  expect(visibilityAtom.hiddenAtAtom()).toBe(3_000)
  expect(visibilityAtom.visibleAtAtom()).toBe(2_000)

  track.unsubscribe()
})
