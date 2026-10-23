# Linked-list derivations

Implemented core and JSX portions of
`packages/admin/logs/linked_list_derivations_90808ff5.plan.md` on 2026-10-23.
Admin owns causal ordering, payload invalidation, and stable-row viewport anchoring.

## Problem and audit

The causal timeline needs one ordered sequence, reusable filtered row models,
incremental indexes, and one virtual window. The old map was root-factory-local;
derived lists could not chain. A missed version recreated mapped models and
reported a clear. Root creation only appended. JSX move/swap assumed one element
per row; its DOM rebuild lost live fragment content and bindings.

The source audit covered linked list/view/virtual, JSX `walkLinkedList`, admin
Gantt, `deatomize`, JSX tree/dnd examples, chat Toaster, and inspector rows.

| Member/consumer | Finding | Decision |
| --- | --- | --- |
| `LLChanges` | Map and JSX replay discriminants | Preserve old events; add `insert`/`moveMany` |
| `reatomMap` | DOM rows in tree/dnd/toasts/inspector; virtual maps temporary slots | Keep callback/options; separate model and DOM lifetime |
| Map hook options | No external repository users found in source audit | Membership transitions; `onClear` only on real reset |
| Public symbols | 35 `LL_NEXT` and 20 `LL_PREV` textual member occurrences, including tests | Keep intrusive public links compatible |
| `.array` | Lazy compatibility callers; broad searches also match other collections | Retain without putting it in append replay |
| View/virtual | Cursor reuse is unchanged/append-only | Positional edits keep a correct traversal fallback |
| Readonly consumers | `deatomize` and Gantt assumed writable inputs while only reading | Widen to `LinkedListSource` |

## Constraints, ranked

1. “Do not revert, overwrite, or format unrelated changes.”
2. “Structural change logs preserve ordering and version continuity for connected
   consumers; lazy consumers may miss versions and must recover correctly.”
3. “No consumer mutates another consumer's change payload or uses already-mutated
   node links to reconstruct an old order.”
4. “Index derivations do not write per-row atoms during computed evaluation.”
5. “A new wrapper identity does not make mutable data immutable or context-safe.”
6. Keep domain-specific causal layout and payload-update protocols in admin.

## Current tool traced

Call site: `ordered.reatomFilter(prepared).reatomMap(createModel)`, followed by
`reatomVirtual(models, options).reatomMap(render)`.

Definition allocates computed units and independent symbols. First read rebuilds.
A source commit replays against the filter's own prior input order, then publishes
a membership diff. Map translates origins/anchors through a WeakMap. Virtual
slots own mounted DOM: leaving the window disposes DOM but retains the persistent
row model. Disconnected derivations stay lazy and reconcile missed versions.
Consumed source version/epoch and emitted output version are separate; hidden-only
commits need not emit a structural output change.

Invalid runs/anchors, duplicate mapped objects, and cross-context intrusive
ownership throw. Pure callback incidental reads are peeked. A forgotten explicit
content invalidation keeps static membership unchanged; that boundary is documented.
No new registry, subscription, disposal, provider, or framework protocol was added.

## Zen rubric and directions

The old root-only mapper failed composition: filters/indexes required array
translation. Missed-version remapping left persistent model identity to consumers,
failing “hardest solved.” Fragment moves silently lost content, failing “hard to
misuse.” Three candidate call sites were evaluated:

1. `computed(() => records().filter(...))`: native arrays plus admin indexes.
   Simple and useful as a correctness oracle, but every structural update scans
   O(n) and leaves retained DOM/model identity to consumers. Rejected for this
   shared sequence layer; retained as a benchmark baseline.
2. `registerChanges(records, callbacks)`: an admin callback registry. It desugars
   to manual observers, caches, and cleanup, duplicating Reatom context/lifetime.
   Rejected on primitives, composition, and ownership. Domain content revisions
   still belong in admin.
3. `records.reatomFilter(prepared).reatomMap(createModel)`: ordinary readonly
   computed sources over existing changes/view/virtual. Chosen: shared replay and
   reset handling without rebuilding lifecycle. Two operation kinds and a pure
   fold are sufficient; causal layout stays outside core.

Per-row visibility atoms were also rejected: every window would subscribe to all
rows, without a replayable sequence diff. Reusing inspector RailGraph was rejected
by the plan because selection and lane caps remove unrelated timeline rows.

**Leaning:** existing sequence/window primitives with readonly derivations.

## Step back to host mechanisms

The data flow is sequence → derived sequence/index → mounted window.

| Host/library mechanism | Fit |
| --- | --- |
| Native Array filter/reduce | Small immutable collections and correctness oracle |
| Existing computed/peek | Lazy context-owned state and untracked row evaluation |
| Existing linked-list changes | Structural identity and replay without registries |
| Existing view/virtual | One bounded mounted window and fresh DOM on reentry |
| DOM insertBefore/DocumentFragment | Retain elements and complete marker ranges |
| MutationObserver `isConnected` | Distinguish synchronous movement from removal |

Native DOM movement supplies retention; existing subscriptions supply lifetime.
The new operations only provide the structural information those paths lacked.

## Engineering decisions

- **E1, ownership:** keep public symbols and track context ownership per node/link
  symbol. Factory/`initSnapshot` nodes work independently. Shared `initState`
  objects across contexts throw before relinking. Membership also checks context,
  preventing foreign multi-node chains from appearing present. Sibling lists in
  one context still share objects safely through separate symbols. Inherited
  writable/shared-node state is unsupported. Checked by context ownership tests.
- **E2, failure boundary:** validate whole runs, then journal original descriptors
  and ownership for this context and sequence's symbols. Throw restores the root
  wrapper and links. Nested same-list batches join the outer batch, not savepoints.
  A failed joined operation aborts the outer batch even if its error was caught.
  Other list commits and side effects remain independent. General `withRollback`
  after a successful list commit does not snapshot links. Derived callback failure
  restores output/shadow links and recovers on source invalidation. The initial
  unscoped journal would have corrupted another list after an outer throw; the
  independent nested-list regression test verifies the scoped replacement.
- **E3, identity/lifetime:** WeakMap allocations survive membership loss and gaps.
  Hooks describe membership/order, never DOM mount. Epochs distinguish version
  restarts and end old caches on real clear/reset. JSX moves full marker ranges
  and reconciles retained nodes; focused inputs, selection and handlers survive.
  True removal disposes bindings once. Fully removed DOM remains inert on reuse,
  so keep models before the virtual window and allocate DOM within virtual slots.
- **E4, payloads:** admin owns stable handles and a content revision. A prepared
  computed reads configuration/revision and returns a new predicate. Row
  evaluation is peeked; row atom writes alone do not retest membership. No generic
  core payload-mutation event is introduced.

## Semantics and costs

- `insertMany` takes absent objects; `createMany` keeps factory tuples. New run
  payloads are copied. `moveMany` requires one contiguous ordered run and an
  outside anchor. No-op runs emit no event; existing empty root commits still
  advance a version. Run validation/writes cost O(k).
- Map uses its own old output structure. Filter additionally keeps an input
  shadow with separate links; final source neighbours cannot reconstruct a hidden
  anchor removed later in the same commit. Connected insert replay tests only
  inserted candidates. Visible predecessor lookup costs hidden-gap length, up to
  O(n). Moves/swaps do not retest row predicates.
- Predicate changes and missed/reset versions reconcile in O(n), retaining
  passing nodes. Clear/reset publishes an epoch change even if a version repeats.
- Reduction allocates `init()` per context then rebuilds initially. Consecutive
  commits fold payloads against the final source snapshot; gaps/epochs rebuild.
  Callbacks return new semantic state; wrappers do not make mutable Maps safe.
- `has` and cached `compare` cost O(1). Append/single positional runs allocate gap
  labels in O(k) while space remains. Exhausted gaps and mixed operations can
  relabel/scan O(n). Labels are neither stable IDs nor rank/time indexes.
- View's positional fallback remains O(min(offset, n-offset) + window). Stable-row
  scrolling is an admin integration responsibility, not an order-label promise.

## Verification and measurements

Verified 2026-10-23 on Node v24.21.0, Vitest 5.0.4, Playwright 1.64.1 Chromium.
Tests run real actions, DOM events and MutationObserver delivery.

- Derivation tests cover runs, rollback, weak cached identity, explicit predicates,
  reset epochs, contexts, reducer snapshots/recovery, hooks, and a seeded
  150-commit × 4-operation array oracle.
- `linkedListDerivations.test-d.ts` checks readonly sources/events and inferred
  types through map/filter/reduce/view/virtual/deatomize. Rejected calls have
  checked `@ts-expect-error` assertions.
- Core primitive/deatomize/field-array/type suites: 184 passes and one preexisting expected
  failure for immediate view recovery after a first read inside a failed batch;
  the view recovers on invalidation.
- All JSX Chromium suites: 128 passes and two skipped; the 10 linked-list cases
  cover retained ranges, gaps, live handlers, focus/selection, sibling payloads
  and exact removal cleanup.
- Core/JSX builds and core `tsc --noEmit -p tsconfig.build.json` pass.
- ESLint could not start: the current TypeScript 7/toolchain configuration causes
  a typescript-eslint unsupported-version error and Node internal assertion.
  Toolchain files were left unchanged.

Full benchmark protocol/results live in `packages/admin/bench/README.md` and
`causal-rails.ts`. Parent measurements on M4/Node24, 20 samples + 5 warmups, at
100k records: source/filter/40-row-window append medians were 0.0139 ms (1 row),
0.1317 ms (100 rows), and 1.1081 ms (1000 rows). Predicate calls equalled chunk
size. Simpler array materialization measured 0.719/0.7608/0.9529 ms; workloads differ
and do not imply a blanket speedup. The harness also measures filter diffs and
model allocations.

## Status

- Shipped in this working tree: runs, scoped rollback, readonly chainable
  map/filter/reduce, epochs, ownership, gap labels, retained JSX ranges and docs.
- Removed: root-only mapping implementation and fragment-losing DOM rebuild.
- Migrated: readonly `deatomize`; admin source typing belongs to admin work.
- Limits: outer atom rollback does not snapshot links; removed DOM does not
  resurrect; arbitrary predicates need explicit payload invalidation; rank and
  positional cursor fallback costs remain.
- Follow-ups: bounded-neighbourhood relabeling/predecessor indexes only if measured
  workloads justify their additional structure.
