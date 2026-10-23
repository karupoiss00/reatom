# Causal rails measurements

This development harness measures collection, graph, lane and window costs without production instrumentation. Run from the repository root:

```sh
node --expose-gc --import=tsx packages/admin/bench/causal-rails.ts
```

`BENCH_CASE=append|filter|order|graph|tail|query|dense|stress` selects a workload. `BENCH_SIZES=1000,10000,100000` sets capture sizes. Each measurement has five warm-up operations and at least 20 measured operations, and emits JSON lines with median/p95 milliseconds and heap deltas. Append workloads start at the reported initial size and grow by 25 chunks, including warm-up. Heap deltas cover the entire measured group, not one operation; transient heap includes garbage awaiting collection, and retained heap is sampled after explicit GC. Negative small deltas reflect collection/noise, not negative allocations.

The array baseline performs whole-capture array copying, filtering and slicing. It represents the materialization cost being avoided; it is **not** a benchmark of the previous complete admin application. The interval baseline scans every edge for each of 40 rows. Core window models in this harness are plain objects, not mounted DOM. Browser journeys verify actual UI identity and lifecycle separately.

## Initial profile, 2026-10-23

Apple M4, arm64 macOS, Node v24.21.0, explicit GC. These are local desktop measurements, not portable latency guarantees. Agents and other desktop processes were active, so use structural counters first and rerun elapsed-time comparisons when profiling a regression.

| Workload                                            | Initial records / edges | Median ms |   p95 ms |
| --------------------------------------------------- | ----------------------: | --------: | -------: |
| Collection append 1, half-filter, 40-row window     |                 100,000 |    0.0139 |   0.0241 |
| Collection append 100, half-filter, 40-row window   |                 100,000 |    0.1317 |   0.1443 |
| Collection append 1,000, half-filter, 40-row window |                 100,000 |    1.1081 |   1.1693 |
| Array materialization baseline, append 1            |                 100,000 |    0.7190 |   0.8093 |
| Array materialization baseline, append 1,000        |                 100,000 |    0.9529 |   1.3834 |
| Graph certified tail append 1                       |        100,000 / 99,999 |   20.1063 |  22.3983 |
| Graph certified tail append 1,000                   |        100,000 / 99,999 |   27.6814 |  32.8240 |
| Full causal graph rebuild, chain                    |        100,000 / 99,999 |  243.0528 | 287.8245 |
| Hidden chain projection, 1,001 visible rows         |        100,000 / 99,999 |  146.8647 | 163.7798 |
| Full lane snapshot retaining assignments            |        100,000 / 99,999 |   95.2072 | 106.7206 |
| Indexed rail queries for 40 rows                    |        100,000 / 99,999 |    0.0035 |   0.0045 |
| Full edge scan for 40 rows                          |        100,000 / 99,999 |    4.8470 |   5.6141 |
| Predicate edit all → half → none → narrow           |                 100,000 |  164.7184 | 239.0454 |

Collection append timings above predate adding mapped window-model counters to the harness; the final follow-on/off results below include mapped-window counters. Predicate calls were exactly 1/100/1,000 per append for every tested capture size. The filter-edit cycle tested 100,000 candidates per edit and allocated zero additional mapped models after the initial 100,000: hidden/showing models retained identity.

The measurements identify two different costs: incremental source filtering is bounded by the append chunk, while immutable graph publication still copies maps/arrays and full lane/projection snapshots visit existing events/edges. Certified append avoids SCC traversal/topological sorting; it does not make publication O(delta). Scope/filter edits, late causes, ambiguity and cycles intentionally use broader reconciliation. Dense projected ancestry can itself have large output.

## Verification budgets after the initial profile

Structural requirements are authoritative:

- Common collection append tests only the new candidates, independent of capture size.
- A paused 40-row window allocates no new window models for tail arrivals; a following window allocates at most 40 per chunk.
- Hide/show does not allocate replacement mapped models for retained source nodes.
- A rail query uses the interval index and returns crossing geometry even with both endpoints offscreen.
- Common causal append does not convert the complete raw source to an array or rerun SCC/topological sorting.

Local regression targets for the same engine/hardware are p95 under 25ms for collection/filter/40-row-window append chunks up to 1,000, and under 5ms for 40 sparse indexed rail queries. These have ample room for desktop noise and do not imply a frame-rate promise. The measured 100k full-graph and filter-edit costs remain visible fallback costs; record any subsequent optimization results against this initial profile.

## Final verification, 2026-10-23

The final runs use separate event-loop tasks between operations, outside timed regions, matching separate ingestion callbacks and allowing deferred cleanup/GC. Each case still has five warm-ups and 20 samples. [results.jsonl](results.jsonl) preserves all 104 measurements, structural counters and run environment metadata. The first synchronous complete-model attempt retained graph WeakRef targets until the end of its long job and exhausted Node's heap; that invalid run is excluded. The implementation now certifies snapshot continuity with identity tokens, and the harness yields between operations.

Run the full headless model, or select an expensive fallback workload:

```sh
TSX_TSCONFIG_PATH=packages/admin/bench/tsconfig.json node --expose-gc --import=tsx packages/admin/bench/causal-model.ts
TSX_TSCONFIG_PATH=packages/admin/bench/tsconfig.json BENCH_CASE=scroll node --expose-gc --import=tsx packages/admin/bench/causal-model.ts
TSX_TSCONFIG_PATH=packages/admin/bench/tsconfig.json BENCH_CASE=content BENCH_FOLLOWS=false node --expose-gc --import=tsx packages/admin/bench/causal-model.ts
```

The model harness supports `append`, `scroll`, `content`, `late` and `reset`, plus `BENCH_SIZES`, `BENCH_CHUNKS` and `BENCH_FOLLOWS=false,true`. Its source aliases keep model and collection imports on the same core runtime. Content measurements exercise the admin-local content delta directly, without parser/network cost. Clear/restore includes a newer arrival and asserts that it is retained exactly once. The late-cause case introduces a cause at the tail for an effect with the earliest clock time and an edge spanning the capture.

### Collection and mounted-window budgets

At 100,000 initial records, with a 40-row model window and no overscan:

| Workload                 | Median ms | p95 ms |
| ------------------------ | --------: | -----: |
| Append 1, follow off     |    0.1520 | 0.7170 |
| Append 1, follow on      |    0.0913 | 0.1642 |
| Append 100, follow off   |    0.1455 | 0.3508 |
| Append 100, follow on    |    0.2659 | 0.4634 |
| Append 1,000, follow off |    1.2217 | 1.4034 |
| Append 1,000, follow on  |    1.3730 | 1.5539 |

All tested sizes (1k/10k/100k) tested exactly the appended 1/100/1,000 predicate candidates. Paused windows allocated zero replacement window models; following windows allocated at most 40. Predicate edits intentionally scan the source; hide/show cycles allocated zero additional mapped models. Local collection/query latency targets were met.

### Complete causal model

At 100,000 initial records, including ingest, graph publication, time bounds, lane indexes and a 40-row viewport with six-row overscan:

| Workload                 | Median ms |  p95 ms |
| ------------------------ | --------: | ------: |
| Append 1, follow off     |   47.3750 | 57.8113 |
| Append 100, follow off   |   45.9219 | 49.7518 |
| Append 1,000, follow off |   70.8235 | 80.1363 |
| Append 1, follow on      |   40.1143 | 46.3944 |
| Append 100, follow on    |   42.8416 | 50.2522 |
| Append 1,000, follow on  |   68.4895 | 85.8442 |

Each case used the certified path for all 25 operations, with one initial full rebuild. Paused windows allocated zero new models; following windows allocated at most 46, matching the final viewport plus trailing overscan. This is a headless model measurement, not a complete browser frame. Copying immutable graph maps/arrays and lane ranks/interval arrays remains O(V+E); the complete model does not have constant-time append.

| Workload                                       | Median ms | p95 ms |
| ---------------------------------------------- | --------: | -----: |
| Repeated index scrolling; follow initially off |    0.6129 | 0.7603 |
| Repeated index scrolling; follow initially on  |    0.5014 | 0.8853 |

### Stress cases and broad reconciliation

| Workload                                   | Median ms |  p95 ms |
| ------------------------------------------ | --------: | ------: |
| stress:one-huge-hidden-gap                 |   82.1486 | 93.9259 |
| stress:100k-edge-fan-in-out                |   38.5340 | 60.3690 |
| stress:many-visible-ancestor-pairs         |   12.2434 | 15.6112 |
| stress:bulk-move-and-order-refresh         |    0.1910 |  0.3353 |
| stress:missed-version-cache-reconciliation |   27.5199 | 34.8882 |
| dense:2000-overlapping-lanes-rebuild       |    8.7477 |  9.2557 |
| dense:offscreen-endpoints-40-rows          |    0.4830 |  1.2950 |

The huge-gap check asserts one edge with exactly 99,998 hidden IDs. The dense query returns all 80,000 crossing segments for 40 rows even though both endpoints are offscreen. Lazy reconciliation allocates exactly three new models for three skipped source commits; retained models are reused. The hot-gap workload also inserts 200 nodes at one gap, forcing exhausted-gap relabel fallbacks; its results are in the raw report.

| Workload                                   | Median ms |    p95 ms |
| ------------------------------------------ | --------: | --------: |
| Content-only change to 1 of 100,000 rows   | 1279.0266 | 1765.3451 |
| Content-only change to 100 of 100,000 rows | 1125.9653 | 2060.2897 |
| model:skewed-late-cause                    | 1057.7836 | 1403.9680 |
| model:clear-restore-with-new-arrival       |   17.7687 |   26.3291 |
| model:replay-replace                       |   16.8456 |   24.7730 |

At 100k records, rare content revisions and late causal reordering still require full graph/order/filter/index reconciliation and can take over a second on this desktop. These are known limits, not an incremental-content claim. Clear/replay timings above use 1k records. Fully mounted browser allocation/heap trends were not inferred from headless objects; browser stories cover retained row DOM, pointer/keyboard resizing, pending promotion, hidden selection, paused anchoring, narrow last-row access and passing rails.

The active-shell structural test also forbids the raw list's `.array` getter while appending and reading default header/filter counts, time and rails, including after a legacy-to-causal switch. Explicit scoped/calculator/inspector/compatibility consumers retain documented full-index fallbacks. Package typecheck/lint limitations are recorded in the implementation plan; standalone benchmark typecheck reaches an existing unused `@ts-expect-error` in the user's `core/src/extensions/withCache.ts`, with no benchmark-file diagnostics.
