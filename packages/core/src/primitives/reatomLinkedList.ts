import type { Action, Atom, Computed } from '../core'
import {
  _enqueue,
  action,
  atom,
  computed,
  isAtom,
  named,
  ReatomError,
  top,
} from '../core'
import { withChangeHook } from '../extensions/withChangeHook'
import { withFromJson } from '../extensions/withFromJson'
import { withToJson } from '../extensions/withToJson'
import { peek } from '../methods'
import type { Fn, Rec } from '../utils'
import { isObject } from '../utils'
import {
  isLinkedListBatching,
  registerLinkedListSource,
  endLinkedListBatching,
  startLinkedListBatching,
} from './linkedListBatching'

type State<T> = T extends Atom<infer Value> ? Value : T

declare const LL_PREV: unique symbol
export type LL_PREV = typeof LL_PREV
declare const LL_NEXT: unique symbol
export type LL_NEXT = typeof LL_NEXT

export type LLNode<T extends Rec = Rec> = T & {
  [LL_PREV]: null | LLNode<T>
  [LL_NEXT]: null | LLNode<T>
}

export type LinkedListSymbols = {
  readonly LL_PREV: LL_PREV
  readonly LL_NEXT: LL_NEXT
}

export type LLChanges<Node extends LLNode> = Readonly<
  | { kind: 'create'; node: Node }
  | { kind: 'createMany'; nodes: readonly Node[] }
  | { kind: 'remove'; node: Node }
  | { kind: 'removeMany'; nodes: readonly Node[] }
  | { kind: 'swap'; a: Node; b: Node }
  | { kind: 'move'; node: Node; after: null | Node }
  | { kind: 'insert'; nodes: readonly Node[]; after: null | Node }
  | { kind: 'moveMany'; nodes: readonly Node[]; after: null | Node }
  | { kind: 'clear' }
>

export interface LinkedList<
  Node extends LLNode = LLNode,
> extends LinkedListSymbols {
  head: null | Node
  tail: null | Node
  size: number
  version: number
  changes: Array<LLChanges<Node>>
}

/** Readonly root, mapped, or filtered linked-list source. */
export interface LinkedListSource<
  Node extends LLNode = LLNode,
  Value extends LinkedList = LinkedList<Node>,
>
  extends Computed<Value>, LinkedListSymbols {
  array: Computed<Node[]>
  __reatomLinkedList: true
  /** Current membership, including singleton lists. */
  has: (node: Node) => boolean
  /** Compare present nodes in this sequence; throws for nonmembers. */
  compare: (a: Node, b: Node) => -1 | 0 | 1
  reatomMap: <T extends Rec>(
    cb: (node: Node) => T,
    options?: string | LinkedListMapOptions<Node, LLNode<T>>,
  ) => LinkedListDerivedAtom<Node, LLNode<T>>
  /**
   * A plain predicate is static. A computed predicate tracks configuration and
   * returns a new predicate to invalidate membership. Row evaluation is
   * untracked.
   */
  reatomFilter: (
    predicate: ((node: Node) => boolean) | Computed<(node: Node) => boolean>,
    name?: string,
  ) => LinkedListSource<Node>
  /** Pure incremental fold. Callbacks must not mutate a published accumulator. */
  reatomReduce: <T>(
    options: LinkedListReduceOptions<Node, T>,
    name?: string,
  ) => Computed<{ readonly state: T; readonly version: number }>
}

export interface LinkedListMapOptions<Node extends LLNode, T extends LLNode> {
  name?: string
  /** Membership entry, including a cached model returning after removal. */
  onCreate?: (node: T) => void
  /** Membership exit; cached allocation is retained weakly. */
  onRemove?: (node: T, origin: Node) => void
  onSwap?: (payload: { a: T; b: T }) => void
  onMove?: (node: T) => void
  /** A real clear/reset, never merely a missed source version. */
  onClear?: (state: LinkedListDerivedState<Node, T>) => void
}

export interface LinkedListReduceOptions<Node extends LLNode, T> {
  init: () => T
  apply: (
    previous: Readonly<T>,
    change: Readonly<LLChanges<Node>>,
    source: Readonly<LinkedList<Node>>,
  ) => T
  rebuild: (
    previous: Readonly<T> | undefined,
    source: Readonly<LinkedList<Node>>,
  ) => T
}

export type LinkedListLikeAtom<T extends LinkedList = LinkedList> = Atom<T> &
  LinkedListSource<T extends LinkedList<infer Node> ? Node : never, T>

export interface LinkedListAtom<
  Params extends any[] = any[],
  Node extends Rec = Rec,
  Key extends keyof Node = never,
> extends LinkedListLikeAtom<LinkedList<LLNode<Node>>> {
  /**
   * Applies all mutations of `cb` as one update. Inside `cb`, `find` walks the
   * in-progress state. Mutators relink nodes in place, so `list()`, `array` and
   * `map` mix the old and the new state until `cb` returns, and `reatomMap` and
   * `reatomView` throw when they have to recompute. A throw restores this
   * list's links and committed state. Nested batches join this transaction.
   * External side effects and other lists are not rolled back.
   */
  batch: Action<[cb: Fn]>

  create: Action<Params, LLNode<Node>>
  createMany: Action<[Array<Params>], Array<LLNode<Node>>>
  remove: Action<[LLNode<Node>], boolean>
  removeMany: Action<[Array<LLNode<Node>>], number>
  swap: Action<[a: LLNode<Node>, b: LLNode<Node>], void>
  move: Action<[node: LLNode<Node>, after: null | LLNode<Node>], void>
  clear: Action<[], void>

  find: (cb: (node: LLNode<Node>) => boolean) => null | LLNode<Node>

  /**
   * This lazy map is useful for working with serializable identifier, but it is
   * not recommended to use it for large (thousands elements) lists
   */
  map: Key extends never ? never : Atom<Map<State<Node[Key]>, LLNode<Node>>>

  initiateFromState: (initState: Array<Node>) => LinkedList<LLNode<Node>>
  initiateFromSnapshot: (
    initSnapshot: Array<Params>,
  ) => LinkedList<LLNode<Node>>

  /** Insert absent nodes after an anchor, or at the head for null. */
  insertMany: Action<
    [nodes: readonly Node[], after: null | LLNode<Node>],
    LLNode<Node>[]
  >
  /** Move a contiguous run without recreating its nodes. */
  moveMany: Action<
    [nodes: readonly LLNode<Node>[], after: null | LLNode<Node>],
    void
  >
}

// TODO rename to `DerivedLinkedList`
export interface LinkedListDerivedState<
  Node extends LLNode,
  T extends LLNode,
> extends LinkedList<T> {
  map: WeakMap<Node, T>
}

export interface LinkedListDerivedAtom<
  Node extends LLNode,
  T extends LLNode,
> extends LinkedListSource<T, LinkedListDerivedState<Node, T>> {}

// Journals only touched links: a failed batch restores pointers as well as its atom.
// Nested batches of the same list join the outer batch; they are not savepoints.
type LinkJournal = {
  root: object
  symbols: Set<symbol>
  fields: Map<
    LLNode,
    Map<symbol, { descriptor?: PropertyDescriptor; owner?: object }>
  >
}
const linkJournals = new Set<LinkJournal>()
const nodeOwners = new WeakMap<object, Map<symbol, object>>()
const checkOwner = (node: object, key: symbol) => {
  const owner = nodeOwners.get(node)?.get(key)
  if (owner && owner !== top().root)
    throw new ReatomError(
      'A linked list node cannot be shared across contexts. Create a fresh node per context.',
    )
}
const writeLink = (node: LLNode, key: symbol, value: LLNode | null) => {
  checkOwner(node, key)
  for (const journal of linkJournals) {
    if (journal.root !== top().root || !journal.symbols.has(key)) continue
    let fields = journal.fields.get(node)
    if (!fields) journal.fields.set(node, (fields = new Map()))
    if (!fields.has(key))
      fields.set(key, {
        descriptor: Object.getOwnPropertyDescriptor(node, key),
        owner: nodeOwners.get(node)?.get(key),
      })
  }
  if (!Reflect.set(node, key, value))
    throw new ReatomError('Linked list nodes must allow writing their links.')
  let owners = nodeOwners.get(node)
  if (!owners) nodeOwners.set(node, (owners = new Map()))
  owners.set(key, top().root)
}
const journalLinks = <T>(symbols: LinkedListSymbols[], cb: () => T): T => {
  const journal: LinkJournal = {
    root: top().root,
    symbols: new Set(
      symbols.flatMap(({ LL_PREV, LL_NEXT }) => [LL_PREV, LL_NEXT]),
    ),
    fields: new Map(),
  }
  linkJournals.add(journal)
  try {
    return cb()
  } catch (error) {
    for (const [node, fields] of journal.fields)
      for (const [key, { descriptor, owner }] of fields) {
        if (descriptor) Object.defineProperty(node, key, descriptor)
        else Reflect.deleteProperty(node, key)
        if (owner) nodeOwners.get(node)!.set(key, owner)
        else nodeOwners.get(node)?.delete(key)
      }
    throw error
  } finally {
    linkJournals.delete(journal)
  }
}

// Versions can restart on replacement. Epochs distinguish that reset from an
// unchanged source and let downstream caches release the previous allocation era.
const listEpochs = new WeakMap<LinkedList, object>()
const epochOf = (state: LinkedList): object => {
  let epoch = listEpochs.get(state)
  if (!epoch) listEpochs.set(state, (epoch = {}))
  return epoch
}

const addLL = <Node extends LLNode>(
  _state: LinkedList<Node>,
  _node: Node | Omit<Node, keyof LLNode>,
  _after: null | Node,
) => {
  const state: LinkedList = _state as any
  const node: LLNode = _node as any
  const after: null | LLNode = _after as any
  const LL_PREV: LL_PREV = state.LL_PREV as any
  const LL_NEXT: LL_NEXT = state.LL_NEXT as any

  if (node === after) return

  if (after) {
    const nextNode = after[LL_NEXT]
    writeLink(node, LL_PREV, after)
    writeLink(node, LL_NEXT, nextNode)
    writeLink(after, LL_NEXT, node)
    if (nextNode) {
      writeLink(nextNode, LL_PREV, node)
    }
    if (state.tail === after) {
      state.tail = node
    }
  } else {
    writeLink(node, LL_PREV, null)
    writeLink(node, LL_NEXT, state.head)
    if (state.head) {
      writeLink(state.head, LL_PREV, node)
    }
    if (!state.tail) {
      state.tail = node
    }
    state.head = node
  }
  state.size++
}

const removeLL = <Node extends LLNode>(
  _state: LinkedList<Node>,
  _node: Node,
) => {
  const state: LinkedList = _state as any
  const node: LLNode = _node as any
  const LL_PREV: LL_PREV = state.LL_PREV as any
  const LL_NEXT: LL_NEXT = state.LL_NEXT as any

  if (state.head === node) {
    state.head = node[LL_NEXT]
  } else if (node[LL_PREV] !== null) {
    writeLink(node[LL_PREV], LL_NEXT, node[LL_NEXT])
  }

  if (state.tail === node) {
    state.tail = node[LL_PREV]
  } else if (node[LL_NEXT] !== null) {
    writeLink(node[LL_NEXT], LL_PREV, node[LL_PREV])
  }

  writeLink(node, LL_PREV, null)
  writeLink(node, LL_NEXT, null)

  state.size--
}

const swapLL = <Node extends LLNode>(
  _state: LinkedList<Node>,
  _a: Node,
  _b: Node,
): void => {
  const state: LinkedList = _state as any
  const a: LLNode = _a as any
  const b: LLNode = _b as any
  const LL_PREV: LL_PREV = state.LL_PREV as any
  const LL_NEXT: LL_NEXT = state.LL_NEXT as any

  if (a === b) return

  if (state.head === b) return swapLL(state, b, a)

  const prevA = a[LL_PREV]
  const nextA = a[LL_NEXT]
  const prevB = b[LL_PREV]
  const nextB = b[LL_NEXT]

  if (nextA === b) {
    writeLink(a, LL_NEXT, nextB)
    writeLink(b, LL_PREV, prevA)
    writeLink(b, LL_NEXT, a)
    writeLink(a, LL_PREV, b)

    if (nextB) writeLink(nextB, LL_PREV, a)
    if (prevA) writeLink(prevA, LL_NEXT, b)
  } else if (nextB === a) {
    writeLink(b, LL_NEXT, nextA)
    writeLink(a, LL_PREV, prevB)
    writeLink(a, LL_NEXT, b)
    writeLink(b, LL_PREV, a)

    if (nextA) writeLink(nextA, LL_PREV, b)
    if (prevB) writeLink(prevB, LL_NEXT, a)
  } else {
    if (prevA) writeLink(prevA, LL_NEXT, b)
    if (nextA) writeLink(nextA, LL_PREV, b)
    if (prevB) writeLink(prevB, LL_NEXT, a)
    if (nextB) writeLink(nextB, LL_PREV, a)

    writeLink(a, LL_PREV, prevB)
    writeLink(a, LL_NEXT, nextB)
    writeLink(b, LL_PREV, prevA)
    writeLink(b, LL_NEXT, nextA)
  }

  if (state.head === a) {
    state.head = b
  } else if (state.head === b) {
    state.head = a
  }

  if (state.tail === a) {
    state.tail = b
  } else if (state.tail === b) {
    state.tail = a
  }
}

const moveLL = <Node extends LLNode>(
  state: LinkedList<Node>,
  node: Node,
  after: null | Node,
) => {
  removeLL(state, node)
  addLL(state, node, after)
}

const clearLL = <Node extends LLNode>(state: LinkedList<Node>) => {
  const LL_PREV: LL_PREV = state.LL_PREV as any
  const LL_NEXT: LL_NEXT = state.LL_NEXT as any
  let node: null | LLNode = state.head
  state.head = null
  state.tail = null
  state.size = 0
  while (node) {
    const next = node[LL_NEXT]
    writeLink(node, LL_PREV, null)
    writeLink(node, LL_NEXT, null)
    node = next
  }
}

export const toArray = <T extends Rec>(
  { head, LL_NEXT }: LinkedList<LLNode<T>>,
  prev?: Array<LLNode<T>>,
): Array<LLNode<T>> => {
  let arr: Array<LLNode<T>> = []
  let i = 0
  while (head) {
    if (prev !== undefined && prev[i] !== head) prev = undefined
    arr.push(head)
    head = head[LL_NEXT as LL_NEXT]
    i++
  }
  return arr.length === prev?.length ? prev : arr
}

/**
 * Creates a reactive linked list for collections where inserts, removals, and
 * reordering are part of the main workflow.
 *
 * @remarks
 *   Each item becomes a node with hidden prev/next links, so you can `move` or
 *   `swap` existing items without rebuilding the whole collection. You can
 *   start from existing nodes, a node factory, or a config with `initState` /
 *   `initSnapshot`. Use `array()` when rendering with normal array helpers,
 *   `key` when you need lookup by a stable id, and `batch()` when importing or
 *   reordering many nodes at once.
 * @example
 *   // Build a reorderable upload queue
 *   const uploads = reatomLinkedList(
 *     {
 *       create: (fileName: string) => ({
 *         fileName,
 *         progress: atom(0),
 *       }),
 *       key: 'fileName',
 *     },
 *     'uploads',
 *   )
 *
 *   uploads.create('cover.png')
 *   const hero = uploads.create('hero.png')
 *
 *   uploads.move(hero, null)
 *   uploads.map().get('cover.png')?.progress.set(100)
 *
 *   uploads.array().map((upload) => ({
 *     fileName: upload.fileName,
 *     progress: upload.progress(),
 *   }))
 *   // [
 *   //   { fileName: 'hero.png', progress: 0 },
 *   //   { fileName: 'cover.png', progress: 100 },
 *   // ]
 *
 * @example
 *   // Keep derived row state in sync with the source order
 *   const backlog = reatomLinkedList(
 *     (title: string) => ({ title }),
 *     'backlog',
 *   )
 *   const rows = backlog.reatomMap(
 *     (task) => ({
 *       title: task.title,
 *       expanded: atom(false),
 *     }),
 *     'backlogRows',
 *   )
 *
 *   const docsTask = backlog.create('Write docs')
 *   backlog.create('Ship release')
 *
 *   rows.array()[0].expanded.set(true)
 *   backlog.remove(docsTask)
 *
 *   rows.array().map((row) => ({
 *     title: row.title,
 *     expanded: row.expanded(),
 *   }))
 *   // [{ title: 'Ship release', expanded: false }]
 */
export function reatomLinkedList<
  Node extends Rec,
  Params extends any[] = [Node],
  Key extends keyof Node = never,
>(initState: Array<Node>, name?: string): LinkedListAtom<Params, Node, Key>

export function reatomLinkedList<
  Params extends any[],
  Node extends Rec,
  Key extends keyof Node = never,
>(
  initState: (...params: Params) => Node,
  name?: string,
): LinkedListAtom<Params, Node, Key>

export function reatomLinkedList<
  Params extends any[],
  Node extends Rec,
  Key extends keyof Node = never,
>(
  initState: {
    create: (...params: Params) => Node
    initState?: Array<Node>
    key?: Key
  },
  name?: string,
): LinkedListAtom<Params, Node, Key>

export function reatomLinkedList<
  Params extends any[],
  Node extends Rec,
  Key extends keyof Node = never,
>(
  initState: {
    create?: (...params: Params) => Node
    initState: Array<Node>
    key?: Key
  },
  name?: string,
): LinkedListAtom<Params, Node, Key>

export function reatomLinkedList<
  Params extends any[],
  Node extends Rec,
  Key extends keyof Node = never,
>(
  initSnapshot: {
    create: (...params: Params) => Node
    initSnapshot?: Array<Params>
    key?: Key
  },
  name?: string,
): LinkedListAtom<Params, Node, Key>

export function reatomLinkedList<
  Params extends any[],
  Node extends Rec,
  Key extends keyof Node = never,
>(
  options:
    | Array<Node>
    | ((...params: Params) => Node)
    | {
        create?: (...params: Params) => Node
        initState?: Array<Node>
        key?: Key
      }
    | {
        create: (...params: Params) => Node
        initSnapshot?: Array<Params>
        key?: Key
      },
  name: string = named('linkedListAtom'),
): LinkedListAtom<Params, Node, Key> {
  const LL_PREV: LL_PREV = Symbol('Reatom linked list prev') as any
  const LL_NEXT: LL_NEXT = Symbol('Reatom linked list next') as any

  const {
    create: userCreate = (...params: Params) => params[0],
    key = undefined,
    ...restOptions
  } = typeof options === 'function'
    ? {
        create: options,
      }
    : Array.isArray(options)
      ? {
          create: (...params: Params) => params[0],
          initState: options,
        }
      : options

  const isInList = (node: Node): boolean => {
    if (!node || !(LL_PREV in node) || !(LL_NEXT in node)) return false
    if (nodeOwners.get(node)?.get(LL_NEXT) !== top().root) return false

    return (
      node[LL_PREV] !== null ||
      node[LL_NEXT] !== null ||
      (STATE?.head === node && STATE?.tail === node)
    )
  }

  const throwModel = (node: Node) => {
    if (!isObject(node) && typeof node !== 'function')
      throw new ReatomError('Linked list nodes must be objects or functions.')
    checkOwner(node, LL_NEXT)
    if (isInList(node))
      throw new ReatomError('The data is already in a linked list.')
  }

  const hasOurKeys = (node: Node): boolean =>
    !!node && LL_PREV in node && LL_NEXT in node

  const throwNotModel = (node: Node) => {
    if (!hasOurKeys(node))
      throw new ReatomError('The passed data is not a linked list node.')
  }

  // for batching
  let STATE: null | LinkedList<LLNode<Node>> = null
  let batchRoot: object | null = null
  let batchFailure: { error: unknown } | null = null
  const checkBatchFailure = () => {
    if (batchFailure) throw batchFailure.error
  }

  const linkedList = atom(() => {
    if ('initState' in restOptions)
      return createLinkedListFromState(restOptions.initState ?? [])
    else if ('initSnapshot' in restOptions)
      return createLinkedListFromSnapshot(restOptions.initSnapshot ?? [])
    else return createLinkedListFromState([])
  }, name)

  const createLinkedListFromState = (
    initState: Node[],
  ): LinkedList<LLNode<Node>> => {
    const state = {
      LL_PREV,
      LL_NEXT,
      size: 0,
      version: 1,
      changes: [],
      head: null,
      tail: null,
    } as LinkedList<LLNode<Node>>

    const previousState = STATE
    STATE = state
    try {
      if (new Set(initState).size !== initState.length)
        throw new ReatomError('Duplicate nodes in initial linked list.')
      for (const node of initState) throwModel(node)
      journalLinks([state], () => {
        for (const node of initState) {
          addLL(state, node, state.tail)
        }
      })
    } finally {
      STATE = previousState
    }

    return state
  }

  const createLinkedListFromSnapshot = (
    initSnapshot: Params[],
  ): LinkedList<LLNode<Node>> => {
    return createLinkedListFromState(
      initSnapshot.map((params) => userCreate(...params)),
    )
  }

  const batchFn = <T>(cb: Fn): T => {
    if (STATE) {
      if (batchRoot && batchRoot !== top().root)
        throw new ReatomError('A linked list batch cannot span contexts.')
      try {
        return cb()
      } catch (error) {
        batchFailure ??= { error }
        throw error
      }
    }

    let result: T
    const committed = peek(linkedList)
    try {
      journalLinks([committed], () =>
        linkedList.set(({ head, tail, size, version, LL_PREV, LL_NEXT }) => {
          STATE = {
            LL_PREV,
            LL_NEXT,
            size,
            version: version + 1,
            changes: [],
            head,
            tail,
          }
          listEpochs.set(STATE, epochOf(committed))
          batchRoot = top().root
          batchFailure = null
          startLinkedListBatching(linkedList)

          try {
            result = cb()
            // Joined operations are not savepoints. Even if user code caught
            // their error, a partially completed operation cannot be committed
            // without its change payload.
            checkBatchFailure()

            return STATE
          } finally {
            STATE = null
            batchRoot = null
            batchFailure = null
            endLinkedListBatching(linkedList)
          }
        }),
      )
    } catch (error) {
      linkedList.set(committed)
      throw error
    }

    return result!
  }

  const batch = action(batchFn, `${name}._batch`)

  const addNode = (params: Params): LLNode<Node> => {
    const node = userCreate(...params) as LLNode<Node>

    if (!isObject(node) && typeof node !== 'function')
      throw new ReatomError(
        `reatomLinkedList can operate only with objects or functions, received "${node}".`,
      )

    throwModel(node)

    addLL(STATE!, node, STATE!.tail)

    return node
  }

  const delNode = (node: LLNode<Node>): boolean => {
    throwNotModel(node)

    if (
      node[LL_PREV] === null &&
      node[LL_NEXT] === null &&
      STATE!.tail !== node
    )
      return false

    removeLL(STATE!, node)

    return true
  }

  const create = action((...params: Params): LLNode<Node> => {
    return batchFn(() => {
      const node = addNode(params)
      STATE!.changes.push({ kind: 'create', node })
      return node
    })
  }, `${name}.create`)

  const createMany = action(
    (paramsArray: Array<Params>): Array<LLNode<Node>> => {
      return batchFn(() => {
        const nodes: Array<LLNode<Node>> = []

        for (const params of paramsArray) {
          nodes.push(addNode(params))
        }

        STATE!.changes.push({ kind: 'createMany', nodes })

        return nodes
      })
    },
    `${name}.createMany`,
  )

  const remove = action((node: LLNode<Node>): boolean => {
    return batchFn(() => {
      const result = delNode(node)
      if (result) STATE!.changes.push({ kind: 'remove', node })
      return result
    })
  }, `${name}.remove`)

  const removeMany = action((nodes: Array<LLNode<Node>>): number => {
    return batchFn(() => {
      const removedNodes: Array<LLNode<Node>> = []

      for (const node of nodes) {
        if (delNode(node)) {
          removedNodes.push(node)
        }
      }

      if (removedNodes.length > 0) {
        STATE!.changes.push({ kind: 'removeMany', nodes: removedNodes })
      }

      return removedNodes.length
    })
  }, `${name}.removeMany`)

  const swap = action((a: LLNode<Node>, b: LLNode<Node>): void => {
    return batchFn(() => {
      throwNotModel(a)
      throwNotModel(b)
      if (!isInList(a) || !isInList(b))
        throw new ReatomError('Swap requires present nodes.')

      if (a === b) return

      swapLL(STATE!, a, b)

      STATE!.changes.push({ kind: 'swap', a, b })
    })
  }, `${name}.swap`)

  const move = action(
    (node: LLNode<Node>, after: null | LLNode<Node>): void => {
      return batchFn(() => {
        throwNotModel(node)
        if (!isInList(node) || (after && !isInList(after)))
          throw new ReatomError('Move requires present nodes and anchor.')
        if (node === after || node[LL_PREV] === after) return

        moveLL(STATE!, node, after)

        STATE!.changes.push({ kind: 'move', node, after })
      })
    },
    `${name}.move`,
  )

  const clear = action((): void => {
    return batchFn(() => {
      clearLL(STATE!)
      listEpochs.set(STATE!, {})

      STATE!.changes.push({ kind: 'clear' })
    })
  }, `${name}.clear`)

  const find = (cb: (node: LLNode<Node>) => boolean): null | LLNode<Node> => {
    // read the atom anyway to keep the dependency of a calling computed
    const committed = linkedList()
    for (
      let { head } =
        batchRoot === top().root ? (STATE ?? committed) : committed;
      head;
      head = head[LL_NEXT]
    ) {
      if (cb(head)) return head
    }
    return null
  }

  const array: LinkedListAtom<Params, Node, Key>['array'] = computed(
    (state: Array<LLNode<Node>> = []) => toArray(linkedList(), state),
    `${name}.array`,
  )

  const map = key
    ? (computed(
        () =>
          new Map(
            // use array as it already memoized and simplifies the order tracking
            array().map((node) => {
              const keyValue = node[key]
              return [isAtom(keyValue) ? keyValue() : keyValue, node] as const
            }),
          ),
      ) as LinkedListAtom<Params, Node, Key>['map'])
    : (undefined as never)

  const insertMany = action(
    (input: readonly Node[], after: null | LLNode<Node>) =>
      batchFn(() => {
        const nodes = [...input] as LLNode<Node>[]
        if (after && !isInList(after))
          throw new ReatomError('Insert anchor is not in this list.')
        if (new Set(nodes).size !== nodes.length)
          throw new ReatomError('Duplicate nodes in insert run.')
        for (const node of nodes) {
          if (!isObject(node) && typeof node !== 'function')
            throw new ReatomError('Linked list nodes must be objects.')
          throwModel(node)
        }
        let anchor = after
        for (const node of nodes) {
          addLL(STATE!, node, anchor)
          anchor = node
        }
        if (nodes.length)
          STATE!.changes.push({ kind: 'insert', nodes: [...nodes], after })
        return nodes
      }),
    `${name}.insertMany`,
  )

  const moveMany = action(
    (input: readonly LLNode<Node>[], after: null | LLNode<Node>) =>
      batchFn(() => {
        const nodes = [...input]
        if (after && !isInList(after))
          throw new ReatomError('Move anchor is not in this list.')
        if (!nodes.length) return
        if (new Set(nodes).size !== nodes.length || nodes.includes(after!))
          throw new ReatomError('Invalid move run or anchor.')
        for (let i = 0; i < nodes.length; i++) {
          if (
            !isInList(nodes[i]!) ||
            (i && nodes[i - 1]![LL_NEXT] !== nodes[i])
          )
            throw new ReatomError('Move requires a contiguous ordered run.')
        }
        if (nodes[0]![LL_PREV] === after) return
        for (const node of nodes) removeLL(STATE!, node)
        let anchor = after
        for (const node of nodes) {
          addLL(STATE!, node, anchor)
          anchor = node
        }
        STATE!.changes.push({ kind: 'moveMany', nodes, after })
      }),
    `${name}.moveMany`,
  )

  return linkedList.extend(
    () => ({
      LL_PREV,
      LL_NEXT,
      batch,
      create,
      createMany,
      remove,
      removeMany,
      swap,
      move,
      clear,

      find,

      array,
      map,
      initiateFromState: createLinkedListFromState,
      initiateFromSnapshot: createLinkedListFromSnapshot,

      ...linkedListDerivations(
        linkedList as LinkedListSource<LLNode<Node>>,
        name,
      ),
      insertMany,
      moveMany,

      __reatomLinkedList: true as const,
    }),
    withChangeHook((_, prev) => {
      if (prev) {
        _enqueue(() => {
          prev.changes = []
        }, 'cleanup')
      }
    }),
    withFromJson((snapshot) => {
      if (!Array.isArray(snapshot)) {
        throw new ReatomError('Linked list snapshot should be an array.')
      }

      return createLinkedListFromSnapshot(
        snapshot.map((value) => [value] as Params),
      )
    }),
    withToJson((state) => toArray(state)),
  ) as LinkedListAtom<Params, Node, Key>
}

/**
 * Checks whether a value is a linked list atom or a linked-list derivative
 * created by `reatomLinkedList`.
 *
 * @example
 *   // Enable drag-and-drop only for linked lists
 *   const canReorder = (value: unknown) =>
 *     isLinkedListAtom(value) && value().size > 1
 */
export const isLinkedListAtom = (thing: any): thing is LinkedListSource =>
  thing?.__reatomLinkedList === true

const guardList = (source: object) => {
  if (isLinkedListBatching(source))
    throw new ReatomError(
      "Can't compute a linked list derivation inside batching.",
    )
}

const emptyList = <Node extends LLNode>(
  symbols: LinkedListSymbols,
): LinkedList<Node> => ({
  ...symbols,
  head: null,
  tail: null,
  size: 0,
  version: 0,
  changes: [],
})
const containsLL = <Node extends LLNode>(
  state: LinkedList<Node>,
  node: Node,
): boolean =>
  !!node &&
  nodeOwners.get(node)?.get(state.LL_NEXT) === top().root &&
  (state.head === node ||
    node[state.LL_PREV] != null ||
    node[state.LL_NEXT] != null)

/** Reconcile a reset/predicate edit without removing retained members. */
const reconcileLL = <Node extends LLNode>(
  state: LinkedList<Node>,
  desired: Node[],
) => {
  const wanted = new Set(desired)
  if (wanted.size !== desired.length)
    throw new ReatomError('A derived list must contain distinct nodes.')
  const removed: Node[] = []
  for (let node = state.head; node;) {
    const next = node[state.LL_NEXT] as Node | null
    if (!wanted.has(node)) {
      removed.push(node)
      removeLL(state, node)
    }
    node = next
  }
  if (removed.length) state.changes.push({ kind: 'removeMany', nodes: removed })
  let after: Node | null = null
  for (let i = 0; i < desired.length;) {
    const node = desired[i]!
    const expected: Node | null = (
      after ? after[state.LL_NEXT] : state.head
    ) as Node | null
    if (expected === node) {
      after = node
      i++
      continue
    }
    if (containsLL(state, node)) {
      moveLL(state, node, after)
      state.changes.push({ kind: 'move', node, after })
      after = node
      i++
      continue
    }
    const nodes: Node[] = []
    const anchor = after
    while (i < desired.length && !containsLL(state, desired[i]!)) {
      const next = desired[i++]!
      addLL(state, next, after)
      nodes.push(next)
      after = next
    }
    state.changes.push({ kind: 'insert', nodes, after: anchor })
  }
}

const attachList = <Node extends LLNode, Value extends LinkedList<Node>>(
  target: Computed<Value>,
  symbols: LinkedListSymbols,
  source: object,
): LinkedListSource<Node, Value> => {
  registerLinkedListSource(target, source)
  return Object.assign(
    target,
    symbols,
    {
      array: computed(
        (previous?: Node[]) => toArray(target(), previous) as Node[],
        `${target.name}.array`,
      ),
      __reatomLinkedList: true as const,
    },
    linkedListDerivations(target as LinkedListSource<Node, Value>, target.name),
  )
}

const linkedListDerivations = <Node extends LLNode>(
  source: LinkedListSource<Node>,
  name: string,
) => {
  // Labels are private per-context cache data, never persistent event identities.
  const order = computed(
    (previous?: {
      version: number
      epoch: object
      labels: WeakMap<Node, number>
      tail: Node | null
    }) => {
      guardList(source)
      const state = source()
      const epoch = epochOf(state)
      if (previous?.version === state.version && previous.epoch === epoch)
        return previous
      if (previous?.epoch !== epoch) previous = undefined
      const labels = previous?.labels ?? new WeakMap<Node, number>()
      let tail = previous?.tail ?? null
      let append = !!previous && state.version === previous.version + 1
      const additions: Node[] = []
      for (const change of state.changes) {
        if (change.kind === 'create') {
          additions.push(change.node)
          tail = change.node
        } else if (
          change.kind === 'createMany' ||
          (change.kind === 'insert' && change.after === tail)
        ) {
          for (const node of change.nodes) additions.push(node)
          tail = change.nodes.at(-1) ?? tail
        } else {
          append = false
          break
        }
      }
      if (append) {
        let label = previous!.tail ? labels.get(previous!.tail)! : 0
        for (const node of additions) labels.set(node, (label += 1024))
        if (!Number.isFinite(label) || label > Number.MAX_SAFE_INTEGER)
          append = false
      }
      // A single positional run has known final boundaries. Allocate within
      // that gap without scanning unaffected nodes; exhausted gaps relabel.
      if (
        !append &&
        previous &&
        state.version === previous.version + 1 &&
        state.changes.length === 1
      ) {
        const change = state.changes[0]!
        const nodes =
          change.kind === 'insert' || change.kind === 'moveMany'
            ? change.nodes
            : change.kind === 'move'
              ? [change.node]
              : []
        if (nodes.length) {
          const leftNode = nodes[0]![state.LL_PREV] as Node | null
          const rightNode = nodes.at(-1)![state.LL_NEXT] as Node | null
          const left = leftNode ? labels.get(leftNode)! : 0
          const right = rightNode
            ? labels.get(rightNode)!
            : left + 1024 * (nodes.length + 1)
          const gap = (right - left) / (nodes.length + 1)
          if (gap >= 1 && right <= Number.MAX_SAFE_INTEGER) {
            for (let i = 0; i < nodes.length; i++)
              labels.set(nodes[i]!, left + gap * (i + 1))
            append = true
          }
        }
      }
      if (!append) {
        // Preserve labels where a newly inserted run fits in the surrounding gap.
        let left = 0
        let pending: Node[] = []
        let valid = !!previous
        for (
          let node = state.head;
          node;
          node = node[state.LL_NEXT] as Node | null
        ) {
          const label = labels.get(node)
          if (label === undefined) {
            pending.push(node)
            continue
          }
          if (
            label <= left ||
            (pending.length && (label - left) / (pending.length + 1) < 1)
          ) {
            valid = false
            break
          }
          for (let i = 0; i < pending.length; i++)
            labels.set(
              pending[i]!,
              left + ((label - left) * (i + 1)) / (pending.length + 1),
            )
          pending = []
          left = label
        }
        if (valid) for (const node of pending) labels.set(node, (left += 1024))
        else {
          let label = 0
          for (
            let node = state.head;
            node;
            node = node[state.LL_NEXT] as Node | null
          )
            labels.set(node, (label += 1024))
        }
      }
      return { version: state.version, epoch, labels, tail: state.tail }
    },
    `${name}._order`,
  )

  return {
    has: (node: Node) => {
      guardList(source)
      return containsLL(source(), node)
    },
    compare: (a: Node, b: Node): -1 | 0 | 1 => {
      guardList(source)
      const state = source()
      if (!containsLL(state, a) || !containsLL(state, b))
        throw new ReatomError(
          `Comparison in "${name}" requires two present linked list nodes.`,
        )
      const labels = order().labels
      return a === b ? 0 : labels.get(a)! < labels.get(b)! ? -1 : 1
    },
    reatomMap: <T extends Rec>(
      cb: (node: Node) => T,
      options: string | LinkedListMapOptions<Node, LLNode<T>> = {},
    ): LinkedListDerivedAtom<Node, LLNode<T>> => {
      const { name: mapName = named(`${name}.reatomMap`), ...hooks } =
        typeof options === 'string' ? { name: options } : options
      const symbols = {
        LL_PREV: Symbol('map prev') as LL_PREV,
        LL_NEXT: Symbol('map next') as LL_NEXT,
      }
      type Value = LinkedListDerivedState<Node, LLNode<T>> & {
        sourceVersion: number
        sourceEpoch: object
        origins: WeakMap<LLNode<T>, Node>
      }
      const target = computed((previous?: Value): Value => {
        guardList(source)
        const input = source()
        const sourceEpoch = epochOf(input)
        if (
          previous?.sourceVersion === input.version &&
          previous.sourceEpoch === sourceEpoch
        )
          return previous
        return journalLinks([symbols], () => {
          const state: Value = previous
            ? {
                ...previous,
                changes: [],
                sourceVersion: input.version,
                sourceEpoch,
              }
            : {
                ...emptyList<LLNode<T>>(symbols),
                map: new WeakMap(),
                origins: new WeakMap(),
                sourceVersion: input.version,
                sourceEpoch,
              }
          const reset = !!previous && previous.sourceEpoch !== sourceEpoch
          if (reset) {
            hooks.onClear?.(previous)
            clearLL(state)
            state.map = new WeakMap()
            state.origins = new WeakMap()
            state.changes.push({ kind: 'clear' })
          }
          listEpochs.set(state, reset || !previous ? {} : epochOf(previous))
          const get = (origin: Node): LLNode<T> => {
            let node = state.map.get(origin)
            if (!node) {
              node = peek(cb, origin) as LLNode<T>
              if (!isObject(node) && typeof node !== 'function')
                throw new ReatomError(
                  'A linked list mapper must return an object or function.',
                )
              checkOwner(node, symbols.LL_NEXT)
              if (state.origins.has(node) && state.origins.get(node) !== origin)
                throw new ReatomError(
                  'A linked list mapper must return distinct nodes.',
                )
              state.map.set(origin, node)
              state.origins.set(node, origin)
            }
            return node
          }
          const incremental =
            previous && !reset && input.version === previous.sourceVersion + 1
          if (!incremental) {
            const before = toArray(state)
            const desired: LLNode<T>[] = []
            for (
              let node = input.head;
              node;
              node = node[input.LL_NEXT] as Node | null
            )
              desired.push(get(node))
            const old = new Set(before),
              wanted = new Set(desired)
            reconcileLL(state, desired)
            for (const change of state.changes)
              if (change.kind === 'move') hooks.onMove?.(change.node)
            for (const node of before)
              if (!wanted.has(node))
                hooks.onRemove?.(node, state.origins.get(node)!)
            for (const node of desired)
              if (!old.has(node)) hooks.onCreate?.(node)
          } else
            for (const change of input.changes) {
              switch (change.kind) {
                case 'create':
                case 'createMany':
                case 'insert': {
                  const origins =
                    change.kind === 'create' ? [change.node] : change.nodes
                  const nodes = origins.map(get)
                  const after =
                    change.kind === 'insert'
                      ? change.after
                        ? get(change.after)
                        : null
                      : state.tail
                  let anchor = after
                  for (const node of nodes) {
                    addLL(state, node, anchor)
                    anchor = node
                    hooks.onCreate?.(node)
                  }
                  if (change.kind === 'create')
                    state.changes.push({ kind: 'create', node: nodes[0]! })
                  else if (change.kind === 'createMany')
                    state.changes.push({ kind: 'createMany', nodes })
                  else state.changes.push({ kind: 'insert', nodes, after })
                  break
                }
                case 'remove':
                case 'removeMany': {
                  const origins =
                    change.kind === 'remove' ? [change.node] : change.nodes
                  const nodes = origins.map(get)
                  for (let i = 0; i < nodes.length; i++) {
                    removeLL(state, nodes[i]!)
                    hooks.onRemove?.(nodes[i]!, origins[i]!)
                  }
                  state.changes.push(
                    change.kind === 'remove'
                      ? { kind: 'remove', node: nodes[0]! }
                      : { kind: 'removeMany', nodes },
                  )
                  break
                }
                case 'move':
                case 'moveMany': {
                  const nodes = (
                    change.kind === 'move' ? [change.node] : change.nodes
                  ).map(get)
                  const after = change.after ? get(change.after) : null
                  for (const node of nodes) removeLL(state, node)
                  let anchor = after
                  for (const node of nodes) {
                    addLL(state, node, anchor)
                    anchor = node
                    hooks.onMove?.(node)
                  }
                  state.changes.push(
                    change.kind === 'move'
                      ? { kind: 'move', node: nodes[0]!, after }
                      : { kind: 'moveMany', nodes, after },
                  )
                  break
                }
                case 'swap': {
                  const a = get(change.a),
                    b = get(change.b)
                  swapLL(state, a, b)
                  state.changes.push({ kind: 'swap', a, b })
                  hooks.onSwap?.({ a, b })
                  break
                }
                case 'clear':
                  hooks.onClear?.({ ...state })
                  clearLL(state)
                  state.map = new WeakMap()
                  state.origins = new WeakMap()
                  state.changes.push({ kind: 'clear' })
                  break
              }
            }
          state.version =
            (previous?.version ?? 0) +
            (state.changes.length || !previous ? 1 : 0)
          return state
        })
      }, mapName)
      return attachList(target, symbols, source) as LinkedListDerivedAtom<
        Node,
        LLNode<T>
      >
    },
    reatomFilter: (
      predicate: ((node: Node) => boolean) | Computed<(node: Node) => boolean>,
      filterName: string = named(`${name}.reatomFilter`),
    ): LinkedListSource<Node> => {
      const symbols = {
        LL_PREV: Symbol('filter prev') as LL_PREV,
        LL_NEXT: Symbol('filter next') as LL_NEXT,
      }
      // Replay against our own prior input order. The upstream links already
      // describe the final commit and cannot locate an old or removed anchor.
      const inputSymbols = {
        LL_PREV: Symbol('filter input prev') as LL_PREV,
        LL_NEXT: Symbol('filter input next') as LL_NEXT,
      }
      type Value = LinkedList<Node> & {
        sourceVersion: number
        sourceEpoch: object
        input: LinkedList<Node>
        predicate: (node: Node) => boolean
      }
      const target = computed((previous?: Value): Value => {
        guardList(source)
        const input = source(),
          test = isAtom(predicate) ? predicate() : predicate
        const sourceEpoch = epochOf(input)
        if (
          previous?.sourceVersion === input.version &&
          previous.sourceEpoch === sourceEpoch &&
          previous.predicate === test
        )
          return previous
        return journalLinks([symbols, inputSymbols], () => {
          const state: Value = previous
            ? {
                ...previous,
                changes: [],
                sourceVersion: input.version,
                sourceEpoch,
                input: { ...previous.input },
                predicate: test,
              }
            : {
                ...emptyList<Node>(symbols),
                sourceVersion: input.version,
                sourceEpoch,
                input: emptyList<Node>(inputSymbols),
                predicate: test,
              }
          const reset = !!previous && previous.sourceEpoch !== sourceEpoch
          listEpochs.set(state, reset || !previous ? {} : epochOf(previous))
          if (reset) {
            clearLL(state)
            state.changes.push({ kind: 'clear' })
          }
          const incremental =
            previous &&
            !reset &&
            previous.predicate === test &&
            input.version === previous.sourceVersion + 1
          const predecessor = (anchor: Node | null): Node | null => {
            while (anchor && !containsLL(state, anchor))
              anchor = anchor[inputSymbols.LL_PREV] as Node | null
            return anchor
          }
          const insert = (
            nodes: readonly Node[],
            after: Node | null,
            shadow: boolean,
          ) => {
            let anchor = after
            for (const node of nodes) {
              addLL(shadow ? state.input : state, node, anchor)
              anchor = node
            }
          }
          if (incremental)
            for (const change of input.changes) {
              if (
                change.kind === 'create' ||
                change.kind === 'createMany' ||
                change.kind === 'insert'
              ) {
                const origins =
                  change.kind === 'create' ? [change.node] : change.nodes
                const after =
                  change.kind === 'insert' ? change.after : state.input.tail
                const visibleAfter = predecessor(after)
                insert(origins, after, true)
                const nodes = origins.filter((node) => peek(test, node))
                insert(nodes, visibleAfter, false)
                if (nodes.length)
                  state.changes.push(
                    change.kind === 'insert'
                      ? { kind: 'insert', nodes, after: visibleAfter }
                      : { kind: 'createMany', nodes },
                  )
              } else if (
                change.kind === 'remove' ||
                change.kind === 'removeMany'
              ) {
                const nodes = (
                  change.kind === 'remove' ? [change.node] : change.nodes
                ).filter((node) => containsLL(state, node))
                for (const node of nodes) removeLL(state, node)
                for (const node of change.kind === 'remove'
                  ? [change.node]
                  : change.nodes)
                  removeLL(state.input, node)
                if (nodes.length)
                  state.changes.push({ kind: 'removeMany', nodes })
              } else if (change.kind === 'move' || change.kind === 'moveMany') {
                const origins =
                  change.kind === 'move' ? [change.node] : change.nodes
                const nodes = origins.filter((node) => containsLL(state, node))
                for (const node of origins) removeLL(state.input, node)
                const after = predecessor(change.after)
                insert(origins, change.after, true)
                if (nodes.length && nodes[0]![symbols.LL_PREV] !== after) {
                  for (const node of nodes) removeLL(state, node)
                  insert(nodes, after, false)
                  state.changes.push({ kind: 'moveMany', nodes, after })
                }
              } else if (change.kind === 'swap') {
                const { a, b } = change
                swapLL(state.input, a, b)
                if (containsLL(state, a) && containsLL(state, b)) {
                  swapLL(state, a, b)
                  state.changes.push({ kind: 'swap', a, b })
                } else {
                  const node = containsLL(state, a)
                    ? a
                    : containsLL(state, b)
                      ? b
                      : null
                  if (node) {
                    const after = predecessor(
                      node[inputSymbols.LL_PREV] as Node | null,
                    )
                    if (node[symbols.LL_PREV] !== after) {
                      moveLL(state, node, after)
                      state.changes.push({ kind: 'move', node, after })
                    }
                  }
                }
              } else if (change.kind === 'clear') {
                clearLL(state)
                clearLL(state.input)
                state.changes.push({ kind: 'clear' })
              }
            }
          else {
            const desired: Node[] = []
            clearLL(state.input)
            for (
              let node = input.head;
              node;
              node = node[input.LL_NEXT] as Node | null
            ) {
              addLL(state.input, node, state.input.tail)
              if (peek(test, node)) desired.push(node)
            }
            reconcileLL(state, desired)
          }
          state.version =
            (previous?.version ?? 0) +
            (state.changes.length || !previous ? 1 : 0)
          return state
        })
      }, filterName)
      return attachList(target, symbols, source)
    },
    reatomReduce: <T>(
      options: LinkedListReduceOptions<Node, T>,
      reduceName: string = named(`${name}.reatomReduce`),
    ) => {
      type Value = {
        state: T
        version: number
        sourceVersion: number
        sourceEpoch: object
      }
      return computed((previous?: Value): Value => {
        guardList(source)
        const input = source()
        const sourceEpoch = epochOf(input)
        if (
          previous?.sourceVersion === input.version &&
          previous.sourceEpoch === sourceEpoch
        )
          return previous
        let state: T
        if (
          !previous ||
          previous.sourceEpoch !== sourceEpoch ||
          input.version !== previous.sourceVersion + 1
        )
          state = peek(
            options.rebuild,
            previous ? previous.state : peek(options.init),
            input,
          )
        else {
          state = previous.state
          for (const change of input.changes)
            state = peek(options.apply, state, change, input)
        }
        return {
          state,
          version: (previous?.version ?? 0) + 1,
          sourceVersion: input.version,
          sourceEpoch,
        }
      }, reduceName)
    },
  }
}
