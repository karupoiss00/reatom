/**
 * Development-only causal timeline measurements. Run from the repository root:
 * node --expose-gc --import=tsx packages/admin/bench/causal-rails.ts
 * BENCH_CASE=append|filter|order|graph|tail|query|dense limits the run. The
 * array baseline models whole-capture materialization, not an old release.
 */
import { cpus } from 'node:os'

import {
  atom,
  computed,
  notify,
  reatomLinkedList,
  reatomVirtual,
} from '../../core/src/index.ts'
import {
  appendCausalGraph,
  buildCausalGraph,
  causalAppendIndex,
  crossingRails,
  layoutCausalLanes,
  projectCausalEdges,
  type CausalEvent,
} from '../src/causal/graph.ts'

const iterations = Math.max(20, Number(process.env['BENCH_ITERATIONS'] ?? 20))
const warmup = 5
const requested = process.env['BENCH_CASE'] ?? ''
const sizes = (process.env['BENCH_SIZES'] ?? '1000,10000,100000')
  .split(',')
  .map(Number)
const enabled = (name: string) => !requested || name.includes(requested)
const collect = () => globalThis.gc?.()
let checksum = 0

async function measure(
  name: string,
  run: () => number,
  metadata: Record<string, unknown>,
) {
  for (let i = 0; i < warmup; i++) {
    checksum += run()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  collect()
  const heapBefore = process.memoryUsage().heapUsed
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    checksum += run()
    times.push(performance.now() - start)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const transientHeapKiB = (process.memoryUsage().heapUsed - heapBefore) / 1024
  collect()
  const retainedHeapKiB = (process.memoryUsage().heapUsed - heapBefore) / 1024
  times.sort((a, b) => a - b)
  const median =
    (times[(times.length - 1) >> 1]! + times[times.length >> 1]!) / 2
  console.log(
    JSON.stringify({
      name,
      iterations,
      warmup,
      medianMs: +median.toFixed(4),
      p95Ms: +times[Math.ceil(times.length * 0.95) - 1]!.toFixed(4),
      transientHeapKiB: +transientHeapKiB.toFixed(1),
      retainedHeapKiB: globalThis.gc ? +retainedHeapKiB.toFixed(1) : null,
      ...metadata,
    }),
  )
}

console.log(
  JSON.stringify({
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu: cpus()[0]?.model,
      exposedGC: Boolean(globalThis.gc),
      date: new Date().toISOString(),
    },
  }),
)

if (enabled('append')) {
  for (const count of sizes) {
    for (const chunk of [1, 100, 1000]) {
      for (const follow of [false, true]) {
        let sequence = count
        let calls = 0
        const source = reatomLinkedList(
          (id: number) => ({ id }),
          'bench.source',
        )
        source.createMany(Array.from({ length: count }, (_, id) => [id]))
        const filtered = source.reatomFilter((row) => {
          calls++
          return row.id % 2 === 0
        }, 'bench.filtered')
        const virtual = reatomVirtual(
          filtered,
          {
            itemSize: 26,
            viewportSize: 1040,
            overscan: 0,
            stickToEnd: atom(follow),
          },
          'bench.window',
        )
        if (!follow) virtual.scrollTo(Math.floor(count / 4) * 26)
        let allocations = 0
        const windowModels = virtual.reatomMap((row) => {
          allocations++
          return { id: row.id }
        }, 'bench.window-models')
        const stop = windowModels.subscribe()
        let lastCalls = 0
        let lastAllocations = 0
        await measure(
          'append:list-filter-window',
          () => {
            calls = 0
            allocations = 0
            source.createMany(Array.from({ length: chunk }, () => [sequence++]))
            notify()
            lastCalls = calls
            lastAllocations = allocations
            return virtual().items.length
          },
          { initialRecords: count, chunk, windowRows: 40, follow },
        )
        console.log(
          JSON.stringify({
            counters: 'append:predicate',
            count,
            chunk,
            follow,
            calls: lastCalls,
            windowModelAllocations: lastAllocations,
          }),
        )
        stop()

        let records = Array.from({ length: count }, (_, id) => ({ id }))
        sequence = count
        await measure(
          'append:array-filter-window-baseline',
          () => {
            records = [
              ...records,
              ...Array.from({ length: chunk }, () => ({ id: sequence++ })),
            ]
            const filtered = records.filter((row) => row.id % 2 === 0)
            return filtered.slice(
              follow ? -40 : Math.floor(count / 4),
              follow ? undefined : Math.floor(count / 4) + 40,
            ).length
          },
          { initialRecords: count, chunk, windowRows: 40, follow },
        )
      }
    }
  }
}

if (enabled('filter')) {
  for (const count of sizes) {
    const source = reatomLinkedList((id: number) => ({ id }), 'bench.edits')
    source.createMany(Array.from({ length: count }, (_, id) => [id]))
    const phase = atom(0, 'bench.phase')
    let calls = 0
    const predicate = computed(() => {
      const current = phase() % 4
      return (row: { id: number }) => {
        calls++
        return (
          current === 0 ||
          (current === 1 && row.id % 2 === 0) ||
          (current === 3 && row.id === count - 1)
        )
      }
    }, 'bench.predicate')
    const filtered = source.reatomFilter(predicate, 'bench.edit-filter')
    let allocated = 0
    const mapped = filtered.reatomMap((row) => {
      allocated++
      return { id: row.id }
    }, 'bench.models')
    const stop = mapped.subscribe()
    let lastCalls = 0
    const initialAllocations = allocated
    await measure(
      'filter:all-half-none-narrow',
      () => {
        calls = 0
        phase.set((n) => n + 1)
        notify()
        lastCalls = calls
        return mapped().size
      },
      { records: count },
    )
    console.log(
      JSON.stringify({
        counters: 'filter:models',
        count,
        initialAllocations,
        additionalAllocations: allocated - initialAllocations,
        lastPredicateCalls: lastCalls,
      }),
    )
    stop()
  }
}

if (enabled('order')) {
  const count = Math.max(...sizes)
  const source = reatomLinkedList((id: number) => ({ id }), 'bench.order')
  const nodes = source.createMany(
    Array.from({ length: count }, (_, id) => [id]),
  )
  const anchor = nodes[count >> 1]!
  let sequence = count
  await measure(
    'order:hot-gap-insert-and-compare',
    () => {
      let result = 0
      for (let i = 0; i < 8; i++) {
        const [node] = source.insertMany([{ id: sequence++ }], anchor)
        result += source.compare(anchor, node!)
      }
      return result
    },
    {
      records: count,
      insertions: (iterations + warmup) * 8,
      batch: 8,
      gap: 'same anchor',
    },
  )
}

function events(count: number, start = 0): CausalEvent[] {
  return Array.from({ length: count }, (_, local) => {
    const i = local + start
    return {
      key: String(i),
      ordinal: i,
      record: {
        id: String(i),
        sourceId: 'bench',
        kind: 'span',
        traceId: 'trace',
        spanId: String(i),
        name: `row ${i}`,
        start: i,
        end: i + 1,
        attributes: {},
        resource: {},
        links: [],
        frameId: String(i),
        causeIds: i ? [String(i - 1)] : [],
        reatomKind: 'computed',
      },
    }
  })
}

if (enabled('graph') || enabled('tail') || enabled('query')) {
  for (const count of sizes) {
    const input = events(count)
    let graph = buildCausalGraph(input)
    if (enabled('graph')) {
      await measure(
        'graph:full-chain-rebuild',
        () => {
          graph = buildCausalGraph(input)
          return graph.edges.length
        },
        { records: count, edges: count - 1 },
      )
      const visible = new Set(
        input
          .filter((_, i) => i % 100 === 0 || i === count - 1)
          .map((row) => row.key),
      )
      await measure(
        'graph:hidden-chain-projection',
        () =>
          projectCausalEdges(graph, visible, new Set(graph.order)).edges.length,
        {
          records: count,
          visible: visible.size,
          hiddenGap: 99,
        },
      )
    }
    if (enabled('tail')) {
      for (const chunk of [1, 100, 1000]) {
        let current = graph
        const index = causalAppendIndex(current)
        let sequence = count
        await measure(
          'tail:certified-chain-append',
          () => {
            const incoming = events(chunk, sequence)
            sequence += chunk
            const next = appendCausalGraph(current, incoming, index)
            if (!next) throw new Error('The benchmark tail should certify')
            current = next
            return current.order.length
          },
          { initialRecords: count, chunk },
        )
      }
    }
    let lanes = layoutCausalLanes(graph.order, graph.edges)
    if (enabled('graph')) {
      await measure(
        'graph:lane-rebuild-retaining-assignments',
        () => {
          lanes = layoutCausalLanes(graph.order, graph.edges, lanes)
          return lanes.laneCount
        },
        { records: count, edges: count - 1 },
      )
    }
    if (enabled('query')) {
      const middle = count >> 1
      await measure(
        'query:indexed-40-rows',
        () => {
          let result = 0
          for (let i = middle; i < middle + 40; i++)
            result += crossingRails(lanes, i).length
          return result
        },
        { records: count, edges: count - 1, windowRows: 40 },
      )
      await measure(
        'query:scan-40-rows-baseline',
        () => {
          let result = 0
          for (let i = middle; i < middle + 40; i++)
            for (const edge of lanes.intervals)
              if (edge.start <= i && edge.end >= i) result++
          return result
        },
        { records: count, edges: count - 1, windowRows: 40 },
      )
    }
  }
}

if (enabled('dense')) {
  const count = 10000
  const order = Array.from({ length: count }, (_, i) => String(i))
  const edges = Array.from({ length: 2000 }, (_, i) => ({
    key: `crossing-${i}`,
    from: String(i),
    to: String(count - 1 - i),
    hidden: [],
    cyclic: false,
  }))
  let lanes = layoutCausalLanes(order, edges)
  await measure(
    'dense:2000-overlapping-lanes-rebuild',
    () => {
      lanes = layoutCausalLanes(order, edges)
      return lanes.laneCount
    },
    { records: count, edges: edges.length, concurrentLanes: 2000 },
  )
  await measure(
    'dense:offscreen-endpoints-40-rows',
    () => {
      let result = 0
      for (let i = 4000; i < 4040; i++) result += crossingRails(lanes, i).length
      if (result !== edges.length * 40) throw new Error('Missing passing rails')
      return result
    },
    {
      records: count,
      edges: edges.length,
      windowRows: 40,
      concurrentLanes: 2000,
    },
  )
}

if (enabled('stress')) {
  const count = Math.max(...sizes)
  const chain = buildCausalGraph(events(count))
  const endpoints = new Set(['0', String(count - 1)])
  const scope = new Set(chain.order)
  await measure(
    'stress:one-huge-hidden-gap',
    () => {
      const projected = projectCausalEdges(chain, endpoints, scope)
      if (
        projected.edges.length !== 1 ||
        projected.edges[0]!.hidden.length !== count - 2
      )
        throw new Error('Hidden gap provenance was lost')
      return projected.edges[0]!.hidden.length
    },
    { records: count, visible: 2, hiddenGap: count - 2 },
  )

  const fan = events(1100)
  for (let i = 1000; i < 1100; i++)
    fan[i]!.record.causeIds = Array.from({ length: 1000 }, (_, j) => String(j))
  await measure(
    'stress:100k-edge-fan-in-out',
    () => buildCausalGraph(fan).edges.length,
    { records: 1100, edges: 100999, fanIn: 1000, fanOut: 100 },
  )

  const paths = events(210)
  for (let i = 0; i < 100; i++) paths[i]!.record.causeIds = []
  for (let i = 100; i < 110; i++)
    paths[i]!.record.causeIds = Array.from({ length: 100 }, (_, j) => String(j))
  for (let i = 110; i < 210; i++)
    paths[i]!.record.causeIds = Array.from({ length: 10 }, (_, j) =>
      String(j + 100),
    )
  const branching = buildCausalGraph(paths)
  const visible = new Set(
    paths.filter((_, i) => i < 100 || i >= 110).map((event) => event.key),
  )
  await measure(
    'stress:many-visible-ancestor-pairs',
    () =>
      projectCausalEdges(branching, visible, new Set(branching.order)).edges
        .length,
    { records: 210, rawEdges: 2000, projectedEdges: 10000 },
  )

  const source = reatomLinkedList((id: number) => ({ id }), 'bench.moves')
  const nodes = source.createMany(
    Array.from({ length: count }, (_, id) => [id]),
  )
  const run = nodes.slice(100, 200)
  source.compare(nodes[0]!, nodes.at(-1)!)
  let head = true
  await measure(
    'stress:bulk-move-and-order-refresh',
    () => {
      source.moveMany(run, head ? null : source().tail)
      head = !head
      return source.compare(run[0]!, nodes[0]!)
    },
    { records: count, movedRows: 100 },
  )

  let allocations = 0
  const lazy = source.reatomMap((row) => {
    allocations++
    return { id: row.id }
  }, 'bench.lazy')
  lazy()
  let sequence = count,
    lastAllocations = 0
  await measure(
    'stress:missed-version-cache-reconciliation',
    () => {
      allocations = 0
      source.create(sequence++)
      source.create(sequence++)
      source.create(sequence++)
      const result = lazy().size
      lastAllocations = allocations
      return result
    },
    { initialRecords: count, mutationsBetweenReads: 3 },
  )
  console.log(
    JSON.stringify({
      counters: 'stress:lazy-model-allocations',
      lastAllocations,
    }),
  )
}

console.log(JSON.stringify({ checksum }))
