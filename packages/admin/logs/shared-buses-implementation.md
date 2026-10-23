# Shared buses implementation

Status: complete · 2026-10-23

Author decisions: use shared buses, preserve every event row, and only highlight
related records/connections on selection. Preserve actual time, causal row order,
icons, right-side endpoints, and boundary-respecting dashed hidden bridges.

- [x] Build deterministic, bounded shared-source/target buses before lane layout.
- [x] Render fixed-width tracks and explicit relationship summaries in the shared
  row window; selection changes highlight only.
- [x] Add exact searchable relationship browsing without mounting thousands of
  entries or reusing the parent-only inspector's misleading effect counts.
- [x] Verify fan-in/out, overlapping hubs, hidden routes and offscreen continuations.
- [x] Exercise `integration-chat--streaming-reply-in-progress`, investigate the
  existing pending-row failure, and inspect the actual UI.
- [x] Update design guidance and record test/performance limits.

Owners: Sol (`xhigh`) owns pure bus/model changes and tests; root owns timeline,
relationship UI, integration journeys and final review. Astra investigates the
pending-row integration failure and reviews semantic risks.

Design basis: [folding brainstorm](causal-rails-folding-brainstorm.md).

Operation focus, automatic row folding and a mixed time axis are separate work.

## Separate Sol virtualization review

Author reported a blank screen while scrolling and requested an independent Sol
review/fix. A separate `gpt-6.1-sol` agent ran at `xhigh`.

- [x] Review timeline, core virtualizer, relationship list and waterfall wiring.
- [x] Reproduce the gap in the actual CausalTimeline before applying the fix.
- [x] Restore the rendered block's two sticky insets without increasing overscan.
- [x] Verify immediate viewport coverage and eventual rows in both directions,
  at 26px/36px, with bounded DOM.
- [x] Run timeline/integration regressions, build and focused core checks.

Confirmed cause: CausalTimeline rendered its virtual rows inside a plain div.
Unlike the other virtualized views, it omitted `position: sticky` and bindings
to `virtual.stickyInset()` on both top and bottom. Native scrolling therefore
moved every mounted row outside the viewport before the next virtual window
arrived. The regression failed before the patch (mounted rows' bottom -6906px,
viewport bottom 737px on the first large jump), and passed after the six-line
wrapper fix. No core production change was needed.

Verification: 14 causal/streaming browser journeys, seven core virtualizer
browser cases, 37 focused core virtual unit/type cases, admin build, formatting
and whitespace checks passed. Full admin typecheck still has unrelated baseline
errors and no diagnostics in CausalTimeline or the changed story. ESLint could
not load because its TypeScript parser rejected TS7 and Node raised a config-
loading assertion; this is a tooling failure before file linting.

Native streaming-chat review also confirmed the rendered wrapper is sticky,
with both insets bound. Upward compact-row scrolling kept 24 mounted rows
covering both viewport edges; downward 36px scrolling kept 21 mounted rows and
the same coverage. The preview was refreshed after restarting its stopped
Storybook server. Screenshot: `virtualization-scroll-fixed.png` in the task
visualization directory.

## Full chain and live-capture stability

Author requests: highlight the complete directed chain from/to selection, smooth
Graph continuation controls while scrolling, and stop filter counter growth from
shifting toolbar content.

- [x] Add independent iterative ancestor/descendant walks and exact edge proofs,
  including cycles, scoped boundaries and filtered selected records.
- [x] Highlight only participating bus intervals/member branches; preserve
  sibling, co-cause and ancestor-to-descendant bypass neutrality.
- [x] Keep the continuation strip and surviving linked-list controls mounted;
  fade new controls with reduced-motion support and current-rank navigation.
- [x] Give every filter counter a fixed 5ch slot, including zero; expose exact
  large counts in native titles while compact values keep the toolbar stable.
- [x] Verify wide/narrow counter growth, continuation identity/focus/horizontal
  scrolling, full directed chains, and the streaming integration.

Verification: 380 admin unit tests and 17 browser journeys across causal,
streaming chat, mount logs and settings passed. Build, formatting and whitespace
checks passed. Full admin typecheck retains existing unrelated diagnostics, with
none in the changed causal, continuation, filter or story files. Astra's focused
review found no remaining blocker. Native review of the streaming chat confirmed
`chat.streams.local` highlights grandparent `chat.engine.send`, parent
`chat.streams.setLocal`, its two immediate effects and downstream
`features.composer#new.stopping`, while the co-cause
`chat.streams.startingNew` stays neutral. Screenshot:
`full-chain-stable-controls.png` in the task visualization directory.

The counter tests cross 0→1→9→10→99→100→999→1000 and a 14,001-log compact total
using real ingestion, with unchanged filter-button bounds, wrapping and timeline
geometry. Full-chain traversal is O(V+E) in the selected reachable subgraph per
graph/selection revision; presentation grouping retains its previously recorded
costs. No frame-rate or constant-time selection-update promise is added.

## Screenshot follow-up: distinct joins and section sizing

Author clarified: Records should fill freed width and rows should become taller
when Time is hidden.

- [x] Reproduce the misleading incoming/outgoing bus junction at a selected row.
- [x] Keep touching route intervals on separate tracks; clip accent at event
  centers, paint accent branches last, and mask explicit trace crossings.
- [x] Fill spare width with the last visible section, retaining saved minimum
  widths and explicit column placement through all seven section combinations.
- [x] Use 36px rows when Records is visible and Time is hidden, otherwise 26px;
  keep virtualization, rail geometry, scroll anchors and Follow consistent.
- [x] Add native geometry/paint-order journeys and paused/following model cases.
- [x] Retain uniform arithmetic with reactive numeric `itemSize` and verify its
  core regression checks, final admin checks, and the actual streaming chat.

Astra traced the screenshot's false junction to lane reuse on equal interval
endpoints: a parent's bus ended on the same row where the selected record's
effect bus began. Strictly disjoint intervals now reuse lanes. Seven-combination
geometry checks also exposed hidden-section auto-placement into zero-width grid
tracks; explicit column numbers fix it for both headers and cells.

The initial supported `itemSize: () => rowHeight()` worked geometrically, but
switched every append onto the virtualizer's O(V) variable-size prefix table.
The final form passes the numeric computed directly as an explicit reactive
uniform size; ordinary callbacks remain per-item estimators. This preserves the
uniform hot path rather than paying a new full-list scan on each append.

Follow-up verification: 374 admin unit cases, 10 browser journeys (including
all seven section geometries, paused density anchoring, pinned Follow density,
and selected incoming/outgoing paint order), admin build, 66 core unit/type
cases and six core browser cases passed. One existing expected core failure
remains. Core typecheck passed; full admin typecheck still reports unrelated
existing diagnostics, with no errors in the changed causal/UI/story files.
Astra reviewed lifecycle, geometry and performance; the uniform-size finding
was corrected before completion.

Native review used `integration-chat--streaming-reply-in-progress`. In the final
paused sample, all 413 rows / 507 records remained available. Graph+Records filled
an 800px viewport (116px Graph + 684px Records) at 36px per row. Selecting
`chat.streams.local` highlighted its one recorded cause and two effects, with
incoming and outgoing accent trunks on separate tracks and clipped at the event
center. Screenshot: `shared-buses-record-sizing.png` in the task visualization
directory.


## Result and verification

Implemented exact disjoint shared-source/target groups before track allocation,
with up to four fixed-spaced tracks and complete endpoint/overflow summaries.
Selection changes emphasis only. Real rows, times and source/scope boundaries
remain authoritative. Hidden bridges retain dashed provenance and hidden-ID
unions. Continuations name offscreen anchors on either side of the viewport;
their fixed-height strip avoids scroll navigation feedback. Crossovers use
cutouts and explicit own-trunk taps instead of accidental junctions.

The Cause Chain card now has scoped recorded-neighbor counts and a searchable
virtualized list. Trace preserves selection; Go to event is explicit navigation.
Small diagrams use actual unique numeric frame identities, never local display
indices. Hiding Graph disables tracing and releases bus routing consumers.
Compact diagram ports are the documented product-local control fallback for the
26px timeline rows; other controls reuse the kit.

Astra reproduced a separate virtualizer race: a delayed scroll acknowledgment at
the old offset disabled Follow after content grew. Sol repaired the unchanged-
offset handling and proved a browser regression fails before and passes after.
The requested streaming journey now passes; no pending row was moved or duplicated
to make it visible. A test still selects the generic In progress row, so do not
claim it deterministically identifies a particular request among concurrent
pending operations without further UI identity support.

Checks completed:

- 369 admin unit tests, including 30 causal graph/model/bus checks.
- 13 targeted browser journeys across causal, streaming chat, mounts and settings.
  Eight causal journeys cover diamonds, filter bridges, pending promotion,
  section/resize identity, narrow scrolling, both-end-offscreen overflow, 1,000
  effects with keyboard/search/trace/navigation, 1,000 causes with a below-window
  continuation, and independent bus crossings (some journeys cover several).
- 61 core virtualizer unit/type cases plus five Chromium virtualizer tests; one
  existing expected failure remains. Core typecheck passed.
- Admin build passed. Full admin typecheck retains existing package diagnostics;
  no diagnostics were reported in the new causal production/tests/stories or
  relationship view.
- Inspect-record contract validation, generated-index check, formatting and
  whitespace checks passed. Astra's four actionable review findings were fixed
  and the focused correction pass found no further blocker.
- Native browser review used the requested streaming integration and the
  thousand-cause fixture. In one fresh chat sample: 502 raw records, 408 rows,
  four tracks; 28 mounted rows had 82 trunk and 37 branch segments. The selected
  chat.engine.send correctly exposed 24 recorded effects. These are observations,
  not fixed fixture totals or a controlled before/after performance benchmark.

## Performance limits

Pure source grouping/layout benchmark on this host using Node/tsx, five warmups
and twenty measured samples:

| Fan-out relations | Group median / p95 | Layout median / p95 | 40 indexed row queries median / p95 |
| --- | --- | --- | --- |
| 1,000 | 1.0642 / 1.5530 ms | 0.1093 / 0.3647 ms | 0.0017 / 0.0059 ms |
| 10,000 | 20.2406 / 33.7005 ms | 3.1138 / 8.2117 ms | 0.0037 / 0.0060 ms |

Both cases use one route and one track with zero omitted relations. Branch
indexes have one entry per actual member endpoint; DOM mounts only the window.

Grouping currently rebuilds/sorts on a changed projected graph: O(E log E),
including certified capture appends. Fixed-budget layout/indexing is O(R × budget
+ E). The old per-edge lane allocation is not in the shared-bus rendering path;
raw capture ordering/handles retain their certified append path. Repeated widths
within a threshold and selection do not regroup; first use of another track
budget rebuilds its presentation indexes, and revisits use the cached layout.
Dense hidden-path projection and rare graph reorder/snapshot costs remain known
limits. No constant-time append, 100k-capture latency or frame-rate promise was
established by this change.

## Interaction refinements — 2026-10-23

- [x] Add the persisted Graph continuations Display switch, default on; hiding
  it releases the strip's layout space and presentation subscriptions.
- [x] Add Close record details to the FrameCard identity header in both layouts,
  preserving selection and restoring row focus.
- [x] Preserve selected text through Command/copy during live capture; review
  Shadow DOM selection boundaries and prevent unrelated record arrivals from
  rebuilding the selected value tree.
- [x] Resume Follow when native downward scrolling returns to the bottom;
  retain delayed-acknowledgement and model-navigation protections.
- [x] Center Causal column handles on boundaries, start resizing from displayed
  widths, and add bounded content fitting on double-click/Home.
- [x] Render Import as the shared native button with an associated hidden file
  picker, retaining repeated-file import support.
- [x] Have Sol review Overview semantics and implement current-state-only
  computed/atom inspection plus safe local identity-action deduplication.
- [x] Complete independent review, live streaming UI verification, and final
  focused checks after the selected-text repair.

Sol confirmed that computed middleware params contain previous state rather
than user action arguments. Overview now uses captured-field presence, preserves
captured undefined, and keeps missing values absent. Only successful local
single-argument actions can collapse matching results using Object.is. Replay,
distinct equal-shaped objects, errors and unfinished results retain separate
captured values; JSON and History preserve their original fields.

The copy failure came from a fresh mountLogIds Set invalidating the whole
FrameCard on unrelated capture, including host keyboard telemetry. Kind is now
an isolated primitive computed consumed only by decoration. The live-copy
journey preserves exact Inspector/text nodes, the selected string, and a
trusted non-prevented native copy event. Shell handling also covers tree-local
selection, composed shadow endpoints, and bare Meta/Control keys.

Independent review corrected modified Home handling and a hidden saved-width
change when resizing a stretched trailing column leftward at its minimum.
ARIA limits follow the actual fill requirement, including ultrawide screens.
Follow auto-resume requires an explicitly supplied stickToEnd atom; default
virtual lists retain paused behavior after reaching the bottom and appending.

Final verification: 389 admin unit cases, 26 causal/settings/FrameCard Chromium
journeys plus the streaming-chat integration passed. Core Follow verification
passed 70 unit/type cases and 11 Chromium cases, with one existing expected
failure; core typecheck passed. The native scroll tests cover both 26px and 36px
row density. Admin build, scoped formatting, contract/index and whitespace checks
passed. Full admin typecheck retains its existing diagnostics; none are in the
modified runtime files or new/updated browser journeys.

Native review on integration-chat--streaming-reply-in-progress confirmed that
Command and Command-C preserve a selected 'hello' in the captured action's
Inspector. Closing returned focus to the still-selected chat.engine.send row.
The selected storage.info.ready computed showed only its current true value,
with no Param. Hiding Graph continuations removed its 36px without hiding Graph;
restoring it with Time off retained 36px rows and Records filling the remaining
width. Screenshot: timeline-interactions-fixed.png in the task visualization
directory.
