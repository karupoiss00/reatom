/** Development-only complete causal model benchmark; see README.md. */
import { cpus } from 'node:os'

import { action, atom, computed, notify } from '@reatom/core'

import { CAUSAL_ROW_HEIGHT, reatomCausalTimeline } from '../src/causal/model.ts'
import { reatomOtlpStore, type AdminRecord } from '../src/otlp/ingest.ts'

const samples = 20
const warmup = 5
const sizes = (process.env['BENCH_SIZES'] ?? '1000,10000,100000')
  .split(',')
  .map(Number)
const chunks = (process.env['BENCH_CHUNKS'] ?? '1,100,1000')
  .split(',')
  .map(Number)
const requested = process.env['BENCH_CASE'] ?? 'append'
const follows = (process.env['BENCH_FOLLOWS'] ?? 'false,true')
  .split(',')
  .map((value) => value === 'true')
let checksum = 0
console.log(
  JSON.stringify({
    environment: {
      node: process.version,
      cpu: cpus()[0]?.model,
      platform: process.platform,
      architecture: process.arch,
      date: new Date().toISOString(),
    },
  }),
)

async function measure(
  name: string,
  run: () => number,
  metadata: Record<string, unknown>,
) {
  for (let i = 0; i < warmup; i++) {
    checksum += run()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  globalThis.gc?.()
  const heapBefore = process.memoryUsage().heapUsed
  const values: number[] = []
  for (let i = 0; i < samples; i++) {
    const start = performance.now()
    checksum += run()
    values.push(performance.now() - start)
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const transientHeapKiB = (process.memoryUsage().heapUsed - heapBefore) / 1024
  globalThis.gc?.()
  const retainedHeapKiB = (process.memoryUsage().heapUsed - heapBefore) / 1024
  values.sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      name,
      ...metadata,
      samples,
      warmup,
      medianMs: +((values[9]! + values[10]!) / 2).toFixed(4),
      p95Ms: +values[18]!.toFixed(4),
      transientHeapKiB: +transientHeapKiB.toFixed(1),
      retainedHeapKiB: globalThis.gc ? +retainedHeapKiB.toFixed(1) : null,
    }),
  )
}

const ms = (time: number) => String(BigInt(time + 1_000_000) * 1_000_000n)
const spans = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => {
    const id = start + i
    return {
      name: `row ${id}`,
      spanId: String(id),
      traceId: 'trace',
      startTimeUnixNano: ms(id),
      endTimeUnixNano: ms(id + 1),
      attributes: {
        'reatom.name': `row ${id}`,
        'reatom.kind': 'computed',
        'reatom.frame.id': String(id),
        'reatom.cause.ids': id ? [String(id - 1)] : [],
      },
    }
  })

for (const count of sizes) {
  for (const follow of follows) {
    for (const chunk of requested === 'append'
      ? chunks
      : requested === 'content'
        ? [1, 100]
        : [1]) {
      const store = reatomOtlpStore({ sourceId: 'bench', resource: {} })
      store.ingest(spans(count))
      const selected = atom<AdminRecord | null>(null)
      const model = reatomCausalTimeline(
        {
          store,
          predicate: computed(() => () => true),
          scope: computed(() => null),
          now: atom(2_000_000),
          follow: atom(follow),
          selected,
          select: (record) => {
            selected.set(record)
          },
          replaceSelection: (before, next) => {
            if (selected()?.id === before.id) selected.set(next)
          },
        },
        'bench.causal',
      )
      const stopModel = model.start()
      model.virtual.viewportSize.set(40 * CAUSAL_ROW_HEIGHT)
      if (!follow)
        model.virtual.scrollTo(Math.floor(count / 2) * CAUSAL_ROW_HEIGHT)
      let allocations = 0
      const window = model.virtual.reatomMap((row) => {
        allocations++
        return { key: row.key }
      })
      const stopWindow = window.subscribe()
      const stopLanes = model.lanes.subscribe()
      const stopRange = model.visibleTime.subscribe()
      notify()
      let sequence = count
      const before = model.privateState().appendCount
      let lastAllocations = 0
      if (requested === 'content') {
        const targets: AdminRecord[] = []
        const state = store.recordList()
        for (
          let record = state.head;
          record && targets.length < chunk;
          record = record[state.LL_NEXT]
        )
          targets.push(record)
        let revision = 0
        const update = action(() => {
          for (const record of targets) {
            record.outcome = 'error'
            record.error = { message: `late exception ${revision}` }
          }
          revision++
          store.contentChanges.set((previous) => ({
            revision: previous.revision + 1,
            records: targets,
          }))
        }, 'bench.content-update')
        await measure(
          'model:content-revision-protocol',
          () => {
            update()
            notify()
            return model.visible().size
          },
          {
            records: count,
            changedRows: targets.length,
            follow,
            protocol: 'direct admin-local content delta',
          },
        )
      }
      if (requested === 'reset') {
        const captured = store.records()
        await measure(
          'model:clear-restore-with-new-arrival',
          () => {
            store.clear()
            store.ingest(spans(1, sequence++))
            store.restoreRecords(captured)
            notify()
            if (model.ordered().size !== count + 1)
              throw new Error('Restore lost or duplicated records')
            return model.visible().size
          },
          { records: count, newerArrivals: 1, follow },
        )
        await measure(
          'model:replay-replace',
          () => {
            store.replace(spans(count))
            notify()
            return model.visible().size
          },
          { records: count, follow },
        )
      }
      if (requested === 'late') {
        await measure(
          'model:skewed-late-cause',
          () => {
            const effectId = sequence++,
              causeId = sequence++
            const [effect] = spans(1, effectId),
              [cause] = spans(1, causeId)
            effect!.startTimeUnixNano = ms(0)
            effect!.attributes['reatom.cause.ids'] = [String(causeId)]
            cause!.attributes['reatom.cause.ids'] = ['0']
            store.ingest([effect, cause])
            notify()
            return model.virtual().items.length
          },
          {
            initialRecords: count,
            incomingRows: 2,
            skew: 'effect has earliest clock time',
            follow,
          },
        )
      }
      if (requested === 'append')
        await measure(
          'model:append-with-lanes-window',
          () => {
            allocations = 0
            store.ingest(spans(chunk, sequence))
            sequence += chunk
            notify()
            lastAllocations = allocations
            return model.virtual().items.length
          },
          { initialRecords: count, chunk, follow, viewportRows: 40 },
        )
      if (requested === 'scroll') {
        let i = 0
        await measure(
          'model:scroll-without-ingest',
          () => {
            model.virtual.scrollToIndex(
              (i++ * 997) % Math.max(1, count - 40),
              'start',
            )
            notify()
            return model.virtual().items.length
          },
          { records: count, followInitially: follow, viewportRows: 40 },
        )
      }
      console.log(
        JSON.stringify({
          counters: 'model:structure',
          initialRecords: count,
          chunk,
          follow,
          certifiedAppends: model.privateState().appendCount - before,
          rebuilds: model.privateState().rebuildCount,
          lastWindowAllocations: lastAllocations,
          mountedWindow: window().size,
        }),
      )
      stopRange()
      stopLanes()
      stopWindow()
      stopModel()
      notify()
    }
  }
}
console.log(JSON.stringify({ checksum }))
