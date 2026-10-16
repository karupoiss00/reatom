import type {
  Action,
  Atom,
  Computed,
  LinkedList,
  LinkedListLikeAtom,
  LLNode,
  VirtualAtom,
  VirtualOptions,
} from '@reatom/core'
import {
  action,
  atom,
  computed,
  isLinkedListAtom,
  named,
  reatomVirtual,
} from '@reatom/core'

/**
 * `waterfall` shows the span tree with expand and collapse, `log` shows every
 * node flat by start time.
 */
export type GanttMode = 'waterfall' | 'log'

/** A time interval in the units of the `start` and `end` accessors. */
export interface GanttTime {
  start: number
  end: number
}

/**
 * Bar position as fractions of the visible time: `left: 0` is the window start,
 * `left + width: 1` is the window end. Values outside `[0, 1]` are clipped
 * bars. Multiply by the track width to get pixels.
 */
export interface GanttBar {
  left: number
  width: number
}

export interface GanttOptions<Node> {
  /** Start time of a node. Instants and bars share this axis. */
  start: (node: Node) => number
  /** End time of a node. `undefined` makes it an instant (a zero-width bar). */
  end?: (node: Node) => number | undefined
  /** Key other nodes point at with `parentId`. Needed for the waterfall tree. */
  id?: (node: Node) => string | undefined
  /** Key of the parent node. A node whose parent is not in the source is a root. */
  parentId?: (node: Node) => string | undefined
  /** Initial mode. Defaults to `waterfall`. */
  mode?: GanttMode
  /**
   * Row virtualization, see `reatomVirtual`. Defaults to `{ itemSize: 1 }`, so
   * scroll offsets and the viewport size count rows.
   */
  virtual?: VirtualOptions<Node>
}

export type GanttSource<Node> =
  Computed<ReadonlyArray<Node>> | LinkedListLikeAtom<LinkedList<Node & LLNode>>

export interface Gantt<Node> {
  /** Current row sequence: the same node objects the source holds. */
  rows: Computed<ReadonlyArray<Node>>
  /**
   * The rendered window over `rows` with its scroll state and geometry:
   * `virtual.items()` are the rows to render, `virtual.padding()` the spacers.
   */
  virtual: VirtualAtom<Node>

  mode: Atom<GanttMode>
  /** Nodes whose children are shown in waterfall mode. */
  expanded: Atom<ReadonlySet<Node>>
  expand: Action<[node: Node], void>
  collapse: Action<[node: Node], void>
  toggle: Action<[node: Node], void>
  /** Expands every node that has children. */
  expandAll: Action<[], void>
  collapseAll: Action<[], void>
  isExpanded: (node: Node) => boolean
  /** Children of a node in start order, whether or not they are visible. */
  children: (node: Node) => ReadonlyArray<Node>
  /** Tree depth of a visible row; `0` for roots and in log mode. */
  depth: (node: Node) => number

  /** From the earliest start to the latest end of all nodes, `null` if empty. */
  range: Computed<null | GanttTime>
  /** Manual time window. `null` fits `range` and follows new records. */
  timeWindow: Atom<null | GanttTime>
  /** `timeWindow` or, when it is `null`, `range`. */
  visibleTime: Computed<null | GanttTime>
  /** A time the user points at, for a cursor line. */
  cursor: Atom<null | number>
  /**
   * Narrows the visible time by `factor` (`2` zooms in, `0.5` out) around
   * `anchor`, the window center by default.
   */
  zoom: Action<[factor: number, anchor?: number], void>
  /** Shifts the visible time by `delta`. */
  pan: Action<[delta: number], void>
  /** Drops the manual window, so `visibleTime` follows `range` again. */
  fit: Action<[], void>
  /** Bar position of a node in `visibleTime`, `null` without a range. */
  bar: (node: Node) => null | GanttBar
  /**
   * Index of the first row starting at or after `time`, `rows().length` when
   * none does. Searches root rows in waterfall mode.
   */
  rowIndexAt: (time: number) => number
  /** Scrolls so the row at `rowIndexAt(time)` is first, or as close as it gets. */
  scrollToTime: Action<[time: number], void>
  /** Scrolls the least distance that makes the row visible. */
  scrollToRow: Action<[node: Node], void>

  selected: Atom<null | Node>
  select: Action<[node: null | Node], void>
  /**
   * Moves the selection by `delta` rows and scrolls to it. Without a visible
   * selection it starts from the first row (`delta > 0`) or the last one.
   */
  moveSelection: Action<[delta: number], void>
}

interface GanttTree<Node> {
  roots: ReadonlyArray<Node>
  children: Map<Node, ReadonlyArray<Node>>
}

interface GanttLayout<Node> {
  rows: ReadonlyArray<Node>
  depth: Map<Node, number>
  rootIndexes: null | ReadonlyArray<number>
}

const NO_CHILDREN: ReadonlyArray<never> = []

const sortByStart = <Node>(
  nodes: ReadonlyArray<Node>,
  getStart: (node: Node) => number,
): ReadonlyArray<Node> => {
  for (let index = 1; index < nodes.length; index++) {
    if (getStart(nodes[index - 1]!) > getStart(nodes[index]!)) {
      return [...nodes].sort((a, b) => getStart(a) - getStart(b))
    }
  }
  return nodes
}

/**
 * Position of an interval in a time window as fractions of the window. An
 * `undefined` end is an instant with zero width.
 */
export const barGeometry = (
  start: number,
  end: number | undefined,
  window: GanttTime,
): GanttBar => {
  const windowLength = window.end - window.start
  if (windowLength <= 0) return { left: 0, width: 0 }
  const duration = end === undefined ? 0 : Math.max(0, end - start)
  return {
    left: (start - window.start) / windowLength,
    width: duration / windowLength,
  }
}

/**
 * Headless Gantt model over a sequence of timed nodes: a row sequence (span
 * tree or flat log), a virtualized row window through `reatomVirtual`, a time
 * axis, and selection.
 *
 * @remarks
 *   The source is a `reatomLinkedList`, a `reatomMap` list, or any atom of an
 *   array, for example a computed of filtered records. Gantt keeps no copy of
 *   the nodes: `rows` and `virtual.items` hold the same objects, and the expand
 *   set and the selection are keyed by node identity.
 *
 *   `rows` is rebuilt on every source change: O(n) in log mode when the source is
 *   already in start order (the source array is reused), O(n log n) otherwise;
 *   the waterfall tree is O(n) plus sorting siblings, and expand or collapse
 *   only walks the expanded rows. Scrolling only slices the window: rows have
 *   one height unless `virtual.itemSize` is a function or rows are measured.
 *
 *   Parent links must form a forest: nodes in a parent cycle have no root and are
 *   never shown.
 *
 *   Do not read the model inside a `batch()` of a linked list source, the window
 *   throws there.
 * @example
 *   const gantt = reatomGantt(
 *     filteredRecords,
 *     {
 *       start: (record) => record.start,
 *       end: (record) => record.end,
 *       id: (record) => record.spanId,
 *       parentId: (record) => record.parentSpanId,
 *       virtual: { itemSize: 24, overscan: 8, stickToEnd: followLive },
 *     },
 *     'gantt',
 *   )
 *
 *   const unbind = gantt.virtual.bindScroller(scrollerElement)
 *   const rowElements = gantt.virtual.reatomMap((row) => {
 *     const bar = gantt.bar(row)
 *     return renderRow(row, gantt.depth(row), bar && bar.left * trackWidth)
 *   })
 */
export function reatomGantt<Node extends LLNode>(
  source: LinkedListLikeAtom<LinkedList<Node>>,
  options: GanttOptions<Node>,
  name?: string,
): Gantt<Node>

export function reatomGantt<Node>(
  source: Computed<ReadonlyArray<Node>>,
  options: GanttOptions<Node>,
  name?: string,
): Gantt<Node>

export function reatomGantt<Node>(
  source: GanttSource<Node>,
  options: GanttOptions<Node>,
  name: string = named('gantt'),
): Gantt<Node> {
  const {
    start: getStart,
    end: getEnd,
    id: getId,
    parentId: getParentId,
  } = options

  const nodes = computed(
    (): ReadonlyArray<Node> =>
      isLinkedListAtom(source)
        ? (source.array() as ReadonlyArray<Node>)
        : (source as Computed<ReadonlyArray<Node>>)(),
    `${name}.nodes`,
  )

  const mode = atom<GanttMode>(options.mode ?? 'waterfall', `${name}.mode`)
  const expanded = atom<ReadonlySet<Node>>(new Set<Node>(), `${name}.expanded`)

  const tree = computed((): GanttTree<Node> => {
    const allNodes = nodes()
    const children = new Map<Node, ReadonlyArray<Node>>()
    if (!getId || !getParentId) {
      return { roots: sortByStart(allNodes, getStart), children }
    }

    const nodesById = new Map<string, Node>()
    for (const node of allNodes) {
      const key = getId(node)
      if (key !== undefined) nodesById.set(key, node)
    }

    const roots: Array<Node> = []
    const childLists = new Map<Node, Array<Node>>()
    for (const node of allNodes) {
      const parentKey = getParentId(node)
      const parent =
        parentKey === undefined ? undefined : nodesById.get(parentKey)
      if (parent === undefined || parent === node) {
        roots.push(node)
        continue
      }
      const siblings = childLists.get(parent)
      if (siblings) siblings.push(node)
      else childLists.set(parent, [node])
    }
    for (const [parent, siblings] of childLists) {
      children.set(parent, sortByStart(siblings, getStart))
    }

    return { roots: sortByStart(roots, getStart), children }
  }, `${name}.tree`)

  const layout = computed((): GanttLayout<Node> => {
    if (mode() === 'log') {
      return {
        rows: sortByStart(nodes(), getStart),
        depth: new Map(),
        rootIndexes: null,
      }
    }

    const { roots, children } = tree()
    const expandedNodes = expanded()
    const rows: Array<Node> = []
    const depth = new Map<Node, number>()
    const rootIndexes: Array<number> = []
    const stack: Array<[node: Node, level: number]> = []
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push([roots[index]!, 0])
    }
    while (stack.length > 0) {
      const [node, level] = stack.pop()!
      if (level === 0) rootIndexes.push(rows.length)
      depth.set(node, level)
      rows.push(node)
      const visibleChildren = expandedNodes.has(node)
        ? children.get(node)
        : undefined
      if (visibleChildren) {
        for (let index = visibleChildren.length - 1; index >= 0; index--) {
          stack.push([visibleChildren[index]!, level + 1])
        }
      }
    }
    return { rows, depth, rootIndexes }
  }, `${name}.layout`)

  const rows = computed(() => layout().rows, `${name}.rows`)

  const virtual = reatomVirtual(
    rows,
    options.virtual ?? { itemSize: 1 },
    `${name}.virtual`,
  )

  const updateExpanded = (node: Node, shouldExpand: boolean) => {
    const current = expanded()
    if (current.has(node) === shouldExpand) return
    const next = new Set(current)
    if (shouldExpand) next.add(node)
    else next.delete(node)
    expanded.set(next)
  }
  const expand = action((node: Node) => {
    updateExpanded(node, true)
  }, `${name}.expand`)
  const collapse = action((node: Node) => {
    updateExpanded(node, false)
  }, `${name}.collapse`)
  const toggle = action((node: Node) => {
    updateExpanded(node, !expanded().has(node))
  }, `${name}.toggle`)
  const expandAll = action(() => {
    expanded.set(new Set(tree().children.keys()))
  }, `${name}.expandAll`)
  const collapseAll = action(() => {
    expanded.set(new Set<Node>())
  }, `${name}.collapseAll`)
  const isExpanded = (node: Node) => expanded().has(node)
  const children = (node: Node) => tree().children.get(node) ?? NO_CHILDREN
  const depth = (node: Node) => layout().depth.get(node) ?? 0

  const range = computed((): null | GanttTime => {
    let earliest = Infinity
    let latest = -Infinity
    for (const node of nodes()) {
      const nodeStart = getStart(node)
      const nodeEnd = getEnd?.(node) ?? nodeStart
      if (nodeStart < earliest) earliest = nodeStart
      if (nodeEnd > latest) latest = nodeEnd
    }
    return earliest === Infinity ? null : { start: earliest, end: latest }
  }, `${name}.range`)
  const timeWindow = atom<null | GanttTime>(null, `${name}.timeWindow`)
  const visibleTime = computed(
    () => timeWindow() ?? range(),
    `${name}.visibleTime`,
  )
  const cursor = atom<null | number>(null, `${name}.cursor`)

  const zoom = action((factor: number, anchor?: number) => {
    if (!(factor > 0) || !Number.isFinite(factor)) {
      throw new Error(
        `The zoom factor of "${name}" should be a positive number, received "${factor}".`,
      )
    }
    const base = visibleTime()
    if (base === null) return
    const center = anchor ?? (base.start + base.end) / 2
    timeWindow.set({
      start: center - (center - base.start) / factor,
      end: center + (base.end - center) / factor,
    })
  }, `${name}.zoom`)
  const pan = action((delta: number) => {
    const base = visibleTime()
    if (base === null) return
    timeWindow.set({ start: base.start + delta, end: base.end + delta })
  }, `${name}.pan`)
  const fit = action(() => {
    timeWindow.set(null)
  }, `${name}.fit`)

  const bar = (node: Node): null | GanttBar => {
    const window = visibleTime()
    return window === null
      ? null
      : barGeometry(getStart(node), getEnd?.(node), window)
  }

  const rowIndexAt = (time: number): number => {
    const { rows: allRows, rootIndexes } = layout()
    const searchCount = rootIndexes ? rootIndexes.length : allRows.length
    const rowIndexOf = (searchIndex: number) =>
      rootIndexes ? rootIndexes[searchIndex]! : searchIndex
    let low = 0
    let high = searchCount
    while (low < high) {
      const middle = (low + high) >>> 1
      if (getStart(allRows[rowIndexOf(middle)]!) < time) low = middle + 1
      else high = middle
    }
    return low === searchCount ? allRows.length : rowIndexOf(low)
  }

  const scrollToTime = action((time: number) => {
    virtual.scrollToIndex(rowIndexAt(time), 'start')
  }, `${name}.scrollToTime`)

  const scrollToRow = action((node: Node) => {
    const index = rows().indexOf(node)
    if (index !== -1) virtual.scrollToIndex(index, 'nearest')
  }, `${name}.scrollToRow`)

  const selected = atom<null | Node>(null, `${name}.selected`)
  const select = action((node: null | Node) => {
    selected.set(node)
  }, `${name}.select`)
  const moveSelection = action((delta: number) => {
    const allRows = rows()
    if (allRows.length === 0) return
    const current = selected()
    const currentIndex = current === null ? -1 : allRows.indexOf(current)
    const lastIndex = allRows.length - 1
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : lastIndex
        : Math.max(0, Math.min(currentIndex + delta, lastIndex))
    const nextNode = allRows[nextIndex]!
    selected.set(nextNode)
    scrollToRow(nextNode)
  }, `${name}.moveSelection`)

  return {
    rows,
    virtual,
    mode,
    expanded,
    expand,
    collapse,
    toggle,
    expandAll,
    collapseAll,
    isExpanded,
    children,
    depth,
    range,
    timeWindow,
    visibleTime,
    cursor,
    zoom,
    pan,
    fit,
    bar,
    rowIndexAt,
    scrollToTime,
    scrollToRow,
    selected,
    select,
    moveSelection,
  }
}
