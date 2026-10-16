import { atom } from '@reatom/core'
import { expect, test } from 'test'

import { ADMIN_FRAME } from '../../root'
import { splitPanePointerMove } from './splitPointer'

test('a splitter drag writes inside the frame that wrapped the pointer', () => {
  const ratio = ADMIN_FRAME.run(() => atom(0.42, '_test.split.ratio'))
  const element = {
    hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, width: 1000 }),
  }
  const onPointerMove = ADMIN_FRAME.run(() =>
    splitPanePointerMove(element, ratio, 200, 200),
  )
  onPointerMove({ pointerId: 1, clientX: 700 })
  expect(ADMIN_FRAME.run(() => ratio())).toBe(0.7)
})
