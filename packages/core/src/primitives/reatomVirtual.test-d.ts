import { expectTypeOf, test } from 'test'

import { atom, computed } from '../core'
import type { LLNode } from './reatomLinkedList'
import { reatomLinkedList } from './reatomLinkedList'
import type { ViewAtom } from './reatomView'
import { reatomVirtual, type VirtualAtom } from './reatomVirtual'

test('infers items from the source and is a view', () => {
  const list = reatomLinkedList((n: number) => ({ n }))
  const virtual = reatomVirtual(list, { itemSize: 10 })
  expectTypeOf(virtual).toEqualTypeOf<VirtualAtom<LLNode<{ n: number }>>>()
  expectTypeOf(virtual).toMatchTypeOf<ViewAtom<LLNode<{ n: number }>>>()

  const rows = computed(() => [{ id: 'a', height: 20 }])
  reatomVirtual(rows, { itemSize: (row) => row.height })
})

test('rejects wrong options', () => {
  const rows = atom([{ id: 'a' }])
  // @ts-expect-error a forgotten size estimate
  reatomVirtual(rows, {})
  // @ts-expect-error the estimate reads the item type
  reatomVirtual(rows, { itemSize: (row) => row.height })
  // @ts-expect-error stickToEnd is an atom, a boolean read once never updates
  reatomVirtual(rows, { itemSize: 10, stickToEnd: true })
})

test('reatomMap renders window items', () => {
  const virtual = reatomVirtual(atom([{ id: 'a' }]), { itemSize: 10 })
  const rendered = virtual.reatomMap((row) => ({ label: row.id }))
  type RenderedNode = NonNullable<ReturnType<typeof rendered>['head']>
  expectTypeOf<RenderedNode['label']>().toEqualTypeOf<string>()
})
