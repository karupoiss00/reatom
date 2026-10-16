import { expectTypeOf, test } from 'test'

import { atom, computed } from '../core'
import type { LLNode } from './reatomLinkedList'
import { reatomLinkedList } from './reatomLinkedList'
import { reatomView, type ViewAtom } from './reatomView'

test('infers items from the source', () => {
  const list = reatomLinkedList((n: number) => ({ n }))
  const lens = { offset: atom(0), limit: atom(10) }

  expectTypeOf(reatomView(list, lens)).toEqualTypeOf<
    ViewAtom<LLNode<{ n: number }>>
  >()
  expectTypeOf(
    reatomView(
      list.reatomMap(({ n }) => ({ label: String(n) })),
      lens,
    ),
  ).toEqualTypeOf<ViewAtom<LLNode<{ label: string }>>>()
  expectTypeOf(
    reatomView(
      computed(() => [1, 2, 3]),
      lens,
    ),
  ).toEqualTypeOf<ViewAtom<number>>()
})

test('rejects incomplete or static lenses', () => {
  const list = reatomLinkedList((n: number) => ({ n }))
  const offset = atom(0)

  // @ts-expect-error a forgotten limit
  reatomView(list, { offset })
  // @ts-expect-error a number read once never updates the window
  reatomView(list, { offset: offset(), limit: atom(10) })
  // @ts-expect-error a lens function is not a lens
  reatomView(list, () => ({ offset: offset(), limit: 10 }))
})

test('items are readonly', () => {
  const view = reatomView(atom([1, 2]), { offset: atom(0), limit: atom(1) })
  // @ts-expect-error memoized items must not be mutated
  view().items.push(3)
})
