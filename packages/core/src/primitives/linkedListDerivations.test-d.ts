import { expectTypeOf, test } from 'test'

import type { Computed } from '../core'
import { atom, computed } from '../core'
import { deatomize } from '../methods'
import type { LinkedListSource, LLNode } from './reatomLinkedList'
import { reatomLinkedList } from './reatomLinkedList'
import { reatomView, type ViewAtom } from './reatomView'
import { reatomVirtual, type VirtualAtom } from './reatomVirtual'

test('readonly derivations preserve inferred node types through every consumer', () => {
  const source = reatomLinkedList((id: number) => ({ id }))
  const visible = source.reatomFilter(
    computed(() => (row: { id: number }) => row.id > 0),
  )
  expectTypeOf(visible).toEqualTypeOf<
    LinkedListSource<LLNode<{ id: number }>>
  >()
  const mapped = visible.reatomMap((row) => ({ value: atom(row.id) }))
  expectTypeOf(deatomize(mapped)).toEqualTypeOf<{ value: number }[]>()
  expectTypeOf(
    reatomView(visible, { offset: atom(0), limit: atom(10) }),
  ).toEqualTypeOf<ViewAtom<LLNode<{ id: number }>>>()
  expectTypeOf(reatomVirtual(visible, { itemSize: 26 })).toEqualTypeOf<
    VirtualAtom<LLNode<{ id: number }>>
  >()
  const count = mapped.reatomReduce({
    init: () => 0,
    apply: (previous) => previous,
    rebuild: (_, current) => current.size,
  })
  expectTypeOf(count).toEqualTypeOf<
    Computed<{ readonly state: number; readonly version: number }>
  >()
  if (false) {
    // @ts-expect-error Derived sources do not expose mutation.
    visible.set(source())
    // @ts-expect-error Derived sources do not expose root actions.
    mapped.create({ value: atom(2) })
    // @ts-expect-error Predicate results must be boolean.
    source.reatomFilter((row) => row.id)
  }
})

test('change payloads and reduction snapshots are readonly', () => {
  const source = reatomLinkedList((id: number) => ({ id }))
  const change = source().changes[0]!
  if (false) {
    if (change.kind === 'insert') {
      // @ts-expect-error Consumers must not rewrite event runs.
      change.nodes.push(source.array()[0]!)
    }
    // @ts-expect-error Consumers must not rewrite event kinds.
    change.kind = 'clear'
  }
  source.reatomReduce({
    init: () => new Map<number, string>(),
    apply(previous, event, state) {
      // @ts-expect-error Source state is readonly inside reduction callbacks.
      state.size = 0
      // @ts-expect-error Change fields are readonly inside reduction callbacks.
      event.kind = 'clear'
      return previous
    },
    rebuild: () => new Map(),
  })
})
