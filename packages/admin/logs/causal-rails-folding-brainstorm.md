# Causal rails: folding and progressive disclosure

Status: design proposal, not implemented. Audited against the working tree on 2026-10-23; the streaming-chat section also records separately attributed runtime observations. The completed implementation plan at `packages/admin/logs/linked_list_derivations_90808ff5.plan.md` remains unchanged. This proposal deliberately challenges its draw-all presentation rather than treating that implementation as the final UX.

## Recommendation and resolved author decisions

The author answered the two product questions:

- **Q1: “Keep every row; bundle dense rails”.** Every event remains an individual row under the user's existing filters. Dense relationships are summarized; automatic event-row folding is outside the chosen implementation.
- **Q2: “just highlight the relative”.** Interpret this as highlighting related records and connections in the **full unchanged row timeline**. Selection does not filter, hide, move or collapse unrelated rows, and does not implicitly enter an operation scope.

Use a stable **base bundled graph**, with a separate **selection highlight**:

1. **Base graph:** keep legible complete small structures; represent dense shared-endpoint relations with named buses and exact count portals. Nonselected relationships remain visibly represented as rails, bundles or explicit summaries. Do not turn the whole graph into the currently selected neighborhood.
2. **Selection:** emphasize the selected record and its related records/connections in that existing representation. Keep other rows and their relationship summaries visible. Selection changes appearance and inspector content, not membership or layout ownership.
3. **Explicit inspection:** count activation opens the relationship browser; Trace reveals a specifically requested relation. Detailed expansion may use reserved tracks, while background summaries remain. Never sample arbitrary first-N edges and imply completeness.

A narrow gutter can use portals instead of illegible lines, but these are truthful visible summaries, not discarded evidence. Presentation follows local routing density and readable track budgets, not an unexplained global capture-size threshold.

Operation/context focus and event-row folding remain **separate explicit follow-up proposals**. They are not defaults, not automatic consequences of selection, and not required for the chosen keep-every-row/bundle-dense-rails implementation. Their detailed alternatives below are retained as design history and future work.

## Author constraints and facts

Preserve the already approved behavior:

- Real measured timestamps and duration bars; no inferred batches or causal-step x axis.
- Causes above effects in the row sequence, with explicit cycle diagnostics.
- Dashed bridges through ordinary hidden intermediates, with hidden-step counts, stopping at source/scope boundaries.
- One event identity, one row sequence and one virtual window shared by Graph, Logs and Time.
- No duplicate event row for an additional cause. No silent lane-cap deletion of records.
- Restore action/computed icons and put the event mark at the **right edge of the graph gutter, directly beside the icon/name**. Those presentation fixes are being handled separately.

Telemetry records causal updates, not the complete static dependency graph. A computed with 1,000 registered dependencies might have one, several, or no recorded changed causes in a particular update. A theme atom with 1,000 subscribers may yield fewer recorded effects because of unchanged results, instrumentation, sampling, missing data or scope. Use **recorded causes**, **recorded effects**, **events**, and **unresolved references**. Never label these counts “all pubs” or “all subs.” A missing record is not evidence that a computation did not run.

### What the current implementation actually does

| Source | Observed behavior | UX/architecture implication |
| --- | --- | --- |
| `packages/admin/src/view/otlp/CausalTimeline.tsx` | Each mounted row calls `crossingRails`, includes all crossings in a serialized signature, and creates an SVG path for every returned edge. Its initial implementation scales all lanes horizontally to fit the graph column. | Row virtualization does not bound edge DOM or crossing-query output. A large star can still create tens of thousands of paths across one window. Wider columns and smaller strokes do not solve the explanation problem. |
| `packages/admin/src/causal/model.ts` | `lanes` projects all visible relations and lays them all out before rendering; `selectedRow` affects emphasis, not relationship membership. | Filtering only the SVG output would leave the expensive global layout in place. Presentation policy must precede lane allocation. |
| `packages/admin/src/causal/graph.ts` | Raw parents, scoped event keys, boundaries, SCCs and causal order exist. Visible projection computes nearest visible predecessors and hidden-event unions. | Strong foundation for truthful relations. Add indexed child adjacency and structured relation summaries; do not infer children by scanning all edges on every hover. |
| Same graph module | Boundaries are strings; a direct edge suppresses a hidden alternate path in the projected edge representation. | Strings cannot safely support exact categorized counters. The relationship browser must distinguish direct recorded evidence from projected routes and must not claim the current projected edge exhausts all causal paths. |
| `packages/admin/DESIGN.md` | It explicitly says to draw all crossings and compress lanes. Stable events, shared scroller, real time, scope boundaries and hidden selection are also documented. | The first two presentation promises should change in a later implementation. The other guarantees remain. Do not silently weaken completeness; make summarized relationships visible and discoverable. |
| `packages/admin/design-system/patterns/inspect-record.md` | One selected record is inspected beside the view or in the narrow-shell drawer. Cause Chain uses the contracted RailGraph. | Put high-cardinality relationship browsing in that existing inspector location. Do not introduce a third side pane or silently feed 1,000 nodes to the selected RailGraph and accept its hidden-node cap. |

These are source-reading findings. No runtime performance result is claimed by this brainstorm.

## Meaningfully different directions

### A. Quiet overview and focused neighborhood with count portals — initial alternative

**User sees:** a readable event list with endpoint marks. High-degree rows say `Causes 1,000` or `Effects 1,000`. Selection brings one causal neighborhood into the gutter. A count opens a searchable, virtualized list of relations.

**Best at:** mixed captures with unrelated hubs, preserving scroll position, finding a particular event, truthful counts, keyboard access.

**Costs:** overview shows less topology before selection; graph discovery needs clear labels rather than unexplained dots. Inspecting another record can change the graph unless an anchor is pinned.

**Failure to avoid:** draw an arbitrary first 8 edges and label the rest `+992` without saying what was chosen. That suggests the displayed causes are representative or more important. In this design, all individual relations are shown when the complete neighborhood fits; otherwise the whole direction is bundled. There is no sampled default subset.

### B. Shared source/target buses, like electrical nets

**User sees:** one labeled vertical bus from a selected hub, with short branches at the actual member rows in the viewport. All branches share a known source or a known target. Named continuation ports lead to offscreen members.

**Best at:** a theme update affecting 1,000 events, or 1,000 recorded causes converging on one update. A viewport with 40 effect rows needs approximately 40 short branches and a bus, not 40 × 1,000 passing edges.

**Costs:** bus syntax must say “shared endpoint,” not imply that one branch caused the next. Multiple simultaneous hubs rapidly become confusing if each gets a bus. Direct and filtered routes need distinct styling and counts.

**Failure to avoid:** bundle unrelated edges because they happen to cross the same vertical area. A bus needs exact membership and a common endpoint. A bus intersection is not a join; only a marked endpoint/branch belongs to it.

### C. Opt-in contiguous causal episode folding

**User sees:** `612 recorded effects of themeAtom · Expand`, occupying one shared summary row, with any interruptions left visible. Expanding reveals original events in causal order.

**Best at:** reducing vertical repetition once the person has identified a specific noisy hub or repeated region.

**Costs:** causal graphs are not trees. A descendant can belong to several causes; time order is not necessarily row order; topologically adjacent records need not be one execution batch. Safe folds often split into several runs. Summary selection and Time cells require new semantics.

**Failure to avoid:** call an arbitrary timestamp bucket a transaction; collapse all descendants beneath an atom as though it exclusively owned them; fold noncontiguous records across unrelated events; or render a summary's start-to-end hull as one continuous task duration.

### D. Adjacency browser or matrix as the primary view

**User sees:** the selected event's causes/effects as a searchable table, or a dense adjacency matrix for a limited selected set. Geometry is secondary.

**Best at:** exact lookup, high cardinality, comparison and sorting. It avoids path crossings entirely.

**Costs:** weak at showing a story across time and offscreen multi-step chains. A global matrix still has quadratic space; it is not a universal scaling solution.

**Disposition:** use a virtualized relationship table as the bundled graph's detail surface. Do not replace the timeline with a global matrix.

### Decision and tradeoff

The author resolved the default after this comparison: use **B plus exact count portals as a stable base representation**, with complete small structures where readable, and **highlight on selection**. Keep A's searchable relationship browser but reject its selection-only graph-membership behavior. C is a separate explicit follow-up proposal; it is not part of the chosen implementation. D supplies exact detail browsing.

A literal draw-all mode is not necessary for correctness: the raw graph and exact relation browser retain the evidence. If later requested, an advanced bounded “show all relationships in this context” view must declare its scope and cost. It should not become the default or silently exceed the rendering budget.

## Wireframes

These illustrate semantic states, not exact colors or finalized tokens. `●` is the actual event endpoint at the right edge of Graph. `[A]`, `[C]`, `[S]` represent the action/computed/state icons beside the name. `║` is a labeled bundle bus, not an event. `- -` is a filtered route. Every ordinary event row still appears once.

### 1,000 recorded causes converge on one computed update

Assume the capture actually contains 1,000 distinct resolved direct cause events. This example does not assume 1,000 static dependencies were all recorded.

Portal representation when the whole fan-in cannot be drawn legibly:

```text
GRAPH                  LOGS                                   REAL TIME
                  ●    [S] source0001       [Effects 1]       |
                  ●    [S] source0002       [Effects 1]       |
                  ●    [A] unrelatedAction                    |====|
                  ●    [S] source0003       [Effects 1]       |
                  …    … original event rows …               …
                  ●    [C] total            [Causes 1,000]    |
```

Shared-target bus representation of the same fan-in (selection highlights it; selection alone does not replace the base graph):

```text
GRAPH                  LOGS                                   REAL TIME
   ║──────────────●    [S] source0001                         |
   ║──────────────●    [S] source0002                         |
   ║              ●    [A] unrelatedAction                    |====|
   ║──────────────●    [S] source0003                         |
   ║    …               … all original event rows …           …
   ╚══════════════●    [C] total       [1,000 recorded causes]  |

Sticky graph annotation: Causes of total · 40 in this window · 960 offscreen
Inspector / Cause Chain: Recorded causes (1,000)
  Search recorded event…
  source0001   #event…   direct   [Trace] [Go to event]
  source0002   #event…   direct   [Trace] [Go to event]
  … virtualized list, not 1,000 mounted controls …
```

The unrelated row gets no branch. Scrolling to the middle of the capture keeps the named continuation `To total #event… below`; it does not duplicate total as a row. Selecting `Trace` on source0002 separates its exact relation from the bundle. `Go to event` performs explicit navigation.

### themeAtom update broadcasts to 1,000 recorded effects

```text
GRAPH                  LOGS                                   REAL TIME
   ╔══════════════●    [S] themeAtom → dark   [Effects 1,000]   |
   ║──────────────●    [C] Header.colors                        |
   ║──────────────●    [C] Sidebar.colors                       |
   ║              ●    [A] analytics.flush                    |==|
   ║──────────────●    [C] Menu.colors                          |
   ║              …    … more event rows …                     …
```

Twenty viewport heights later:

```text
Graph header: From themeAtom #event42 above [Go to cause]
   ║──────────────●    [C] Footer.colors                        |
   ║              ●    [A] unrelated request                  |=====|
   ║──────────────●    [C] Dialog.colors                        |
   ↓                    938 recorded effects outside window
```

This bus means these events share themeAtom as a recorded cause. It does not imply exclusive causation, adjacency in execution, or 1,000 subscribers. A child with another recorded parent keeps its additional-cause count; selecting that child highlights both recorded relations, including their summary portals where bundled.

Optional later row folding, with an interruption preserved:

```text
GRAPH                  LOGS                                   REAL TIME
   ╔══════════════●    [S] themeAtom → dark                     |
   ║             ▸     312 recorded effects [Expand]           [activity extent]
   ║              ●    [A] analytics.flush                    |==|
   ║             ▸     688 recorded effects [Expand]           [activity extent]
```

The two summaries are separate contiguous runs. They are not one fake record and do not receive a synthetic trace/span ID. The original 1,000 member events remain addressable.

### Two unrelated hubs and a diamond

```text
                  ●    [S] themeAtom          [Effects 1,000]
                  ●    [S] localeAtom         [Effects   800]
                  ●    [C] Header.title       [Causes      2]
```

Both hubs remain represented as buses or exact count portals under the same density policy. Selecting Header.title highlights both recorded parents and connections; it does not remove the other hubs' summaries or arbitrarily pick one cause as its owner. If its two parents each have a common earlier cause, that earlier cause appears only after an explicit upstream step/trace, and only once as an event row.

## Concrete proposed interaction contract

### Base graph, selection highlight, explicit trace

| State/action | Proposed behavior |
| --- | --- |
| No selected record | Stable base graph: complete readable small structures, shared-endpoint bundles for dense relations, and exact count portals for summarized/offscreen relations. Zero known causes says “No recorded cause,” not a proven root or “no dependencies.” |
| Select a row | Existing selection and inspector behavior remains. Highlight related records/connections in the existing base graph. Keep every row, nonselected relation summary, causal order and scroll anchor. No implicit filtering, row movement, operation scope or graph-membership replacement. |
| Small structure | Base rendering draws the complete local structure when readable under the routing budget, independently of selection. A known offscreen endpoint has a named continuation. Never draw an arbitrary sampled subset as though complete. |
| Dense structure | Base rendering bundles the whole overflowing shared-endpoint set and exposes exact counts, independent of selection. All nonselected sets retain a visible summary; do not choose first-N representative causes. |
| Activate Causes / Effects | Open that direction in the existing inspector's Cause Chain area. This does not jump the timeline or unfold/filter any row. |
| Trace a list relation | Keep the anchor and record selection. Draw that relation exactly, emphasize its visible endpoints, and describe direct/bridged/boundary status. Other relations remain visibly bundled. |
| Go to event | Select the referenced event and scroll the least distance to reveal it. Follow pauses as with manual inspection. The unpinned highlight/detail anchor follows this selection; the base graph retains its membership and summaries. |
| Pin detail (recommended, optional) | Keep an explicit trace/detail anchor while selection can move independently. Name the pinned anchor and provide Unpin / Return to anchor. This does not pin or replace the membership of the base graph. |
| Hover/focus a row | Highlight existing visible ports/branches for that row and show a short summary. Do not recompute topology, replace the anchor, open a card, shift lanes, or unfold rows. Touch uses the explicit controls. |
| Escape | Close the top local popup/relationship detail according to existing shell precedence. Do not silently clear selection, pin or filters. An explicit “Clear trace” control clears a traced relation; global Escape must continue to close the inspector as documented. |

Keep toolbar additions small: one detail anchor label with optional Pin. **Focus context** is a separate explicit follow-up, not a required control in this implementation. Do not add independent depth, pruning, sampling, bus, bundle, density and folding toggles to the main toolbar.

### Bundle grammar and geometry

A bundle is an exact set of known relationships sharing a source or target, whether or not that endpoint is selected. A neutral visual trunk can be distinguished from an individual causal rail by a double line/bracket and a label. Branches terminate only at real member endpoints. A passing bus has no relation to a row that lacks a branch.

Keep direct and bridged sets separate. An initial geometry budget is four readable base tracks plus two tracks reserved for explicitly requested traces. This is a presentation budget, not a graph-degree limit: any set not drawn as a bus retains an exact named count portal, including nonselected sets. The choice between a complete bus and a portal is deterministic and based on local density; selection only changes highlight styling. A bundle remains labeled when its branches are offscreen.

Never combine different source/scope boundary states into one unqualified bus. If the anchor has several source groups, the relation browser exposes separate named groups; only explicitly chosen in-scope groups are drawn. A direct cross-source relationship already supported by recorded identity remains inspectable; do not turn a prohibited hidden cross-source walk into a bridge.

Use fixed legible stroke/endpoint sizes and stable track roles beside the record name. If the column is too narrow for the active representation, show count portals and the traced relation that fits, with an explicit “Open relationships” affordance. Do not scale all x coordinates toward zero. Resizing can change the presentation level; it does not change evidence or row membership. Use hysteresis so a one-pixel resize does not oscillate between modes.

Cycle edges, unresolved references and source/scope exits get diagnostic/boundary marks; they are not members of an ordinary forward-causation bus. They remain available in the relation list even when no geometric interval can be drawn. An unknown endpoint never supplies an invented continuation target.

### Counts have units and scopes

The primary row portal uses unique resolved **recorded direct neighbor events within the active scope**. Incoming and outgoing are separate. Deduplicate multiple pieces of evidence for the same endpoint relation. This is an event count, not a count of models, names, registrations, total executions or causal paths.

In the relationship browser, report a clear partition for these known neighbors:

- Present as individual rows in the current display.
- Included in a user-created row fold.
- Hidden by ordinary filters/context presentation.
- Offscreen is a viewport property of the first two categories, not another disjoint graph total.

Outside-scope references and unresolved references are reported separately when known. Do not infer how many missing events an unresolved string or unavailable span represents. A portal can say `1,000 recorded causes · 3 unresolved references`; it must not say `1,003 causes`.

For projected bridges, use a different label: `M visible predecessors via H hidden steps`. M counts unique projected visible endpoints; H counts the union of hidden event identities, not the sum of overlapping path lengths. The same hidden event can belong to several displayed bridges, so row totals must union identities. A direct recorded relation and a hidden alternate route are different evidence; retain the current direct-first rail style, but do not claim a direct rail proves there are no alternate paths. Reveal alternate-path detail only if its evidence has actually been computed.

A folded summary says `N events`, with separate recorded relation/boundary counts if needed. Neither group size nor a displayed bus count means “N subscriptions.” Grouping a list by `atomName` is a display grouping, not proof of unique model identity; repeated same-name events remain separate entries.

### Relationship browser

Use the existing inspector location and its narrow-shell drawer. A 1,000-entry relationship browser is not a Popover's short-note use case. The current RailGraph remains useful for small chains; a scalable list is a product addition whose Cause Chain composition must be updated explicitly in a future implementation, not a silent contract bypass.

Show direction, exact scope and incomplete-data status above a search field. Default order follows the shared causal rank and stable key. Each relation row includes event label/icon, identity disambiguation, direct/bridged status, hidden-step count or boundary explanation, and distinct Trace / Go to event actions. Only the list window mounts. Search narrows this list without changing the global timeline filter. Do not rank “most influential causes” unless telemetry gains evidence for that claim.

Selecting a relation for tracing does not select the other record until Go to event is invoked. This prevents the browser from destroying its own hub context mid-investigation. Going to a filter-hidden event requires an explicit reveal choice; never reset the user's filters as a side effect of hover or count activation.

### Focus context is an explicit display mode

The approved selection behavior highlights related records while keeping every row. **Focus context** is an explicit follow-up proposal, a separate command when the user wants less vertical noise. Initial proposed scope is anchor + one recorded hop in the chosen direction (or both when selected), preserving relative causal order. The header states exactly what is included and offers Back to all events. Expand another causal step at an identified frontier, rather than switching an invisible global depth limit.

This is a presentation projection inside the current source/scope and global filters. It does not rewrite those filters. Preserve a mode history entry containing anchor, expanded frontier and viewport anchor. Leaving context restores the prior row anchor. Count omitted eligible events as “outside this context”; never call them missing telemetry.

If a focused context excludes ordinary intermediate nodes along a deliberately shown longer relation, the approved dashed bridge rule still applies and identifies the reason. Context changes cannot bridge excluded source/scope boundaries. Keep Filter, Fold, Offscreen and Outside context distinct in details even if all reduce visible geometry.

## Event-row folding: outside the chosen implementation; explicit follow-up only

A group row changes the display sequence, so it is a different architectural layer from a bus. Introduce a display-row union, conceptually `event | group`, downstream of scoped filtering/context membership and upstream of the **same** virtualizer. All three cells render that same item. The current `TimelineRow` and selection APIs assume every row is an AdminRecord; do not attach fake AdminRecords to groups to make those types happy.

### Eligibility and membership

Recommended first action: **Fold these effects** / **Fold these causes** on the currently focused hub. Construct disjoint maximal contiguous runs of eligible member events in the current causal order. The label must say that the hub is *among* their recorded causes when other parents exist. Do not claim exclusive ownership.

Exclude selected events, the pinned anchor, explicitly traced endpoints, errors, unresolved/cyclic diagnostics, and pending spans from automatic fold candidates. Split around unrelated rows, source/scope boundaries and those protected members. Singletons remain events. Do not group by timestamp equality or fabricated transaction IDs. Do not automatically fold every descendant, because a diamond has shared descendants.

Store an explicit fold's member identity set and creation context. A later arrival does not silently disappear into it. If reordering or visibility changes make the set noncontiguous, render separate summary segments or unfold affected segments. Never draw one summary across an intervening unrelated event. A new error/pending/diagnostic member becomes individually visible and splits the group. These rules preserve evidence at the cost of more than one summary per logical fold.

### Summary and expansion

A summary has a disclosure control, exact member count, truthful shared relation label, and boundary/error indicators. It has its own display identity, not a trace/span/frame ID. Selecting/focusing a summary affects group interaction; it does not pretend to select one hidden record in the existing inspector.

Enter/Right expands a focused collapsed summary; Left collapses the focused summary when safe. Expansion keeps the summary's screen position and reveals member rows at that position. Selecting a hidden member from history/search expands the containing group and selects that actual event. A selected member must not disappear because a folding heuristic changed.

For Time, prefer a subtle extent indicator labeled `activity extent`, spanning min(start) to max(end/start) of members, optionally with an activity count. It is never a solid duration bar. Actual durations remain on expanded events. Preserve the global real-time axis; folding is not time compression. Defer a density sparkline until a benchmark and a product need justify it.

A group's graph endpoint is a **summary port**, visually different from an event dot. Aggregate external edges by exact outside endpoint/direction/provenance and show counts, retaining internal relationship counts separately. An expanded group restores original endpoints and edges. A parent with multiple causes must not become “one update per group parent.” Contiguous grouping preserves causal order for the noncyclic graph; cyclic components remain separate diagnostic content initially.

No automatic fold persistence across replacement/replay epochs. In-session filters can suspend a fold and restore surviving same-epoch member identities. Clear removes fold/anchor state; undo restores it only as part of the owner snapshot and without conflating newer arrivals.

## State and navigation details

| Situation | Required presentation |
| --- | --- |
| 1,000-input computed | One event, one incoming bundle direction, exact recorded-neighbor count, searchable relations. No 1,000-lane layout is required before bundling. |
| theme broadcast | One common-source bus; only visible members get branches. Named source continuation stays reachable when its row is offscreen. |
| Several unrelated hubs | Every hub retains a bus or exact count portal in the base graph. Selection highlights relatives without removing unrelated summaries. |
| Diamond / shared child | One child event; each cause stays distinct. Selection highlights both causes in the existing representation. A dense summary still exposes exact membership. |
| Both ends offscreen | Named continuation/bundle summaries preserve the relation; a detailed passing route can be shown after explicit tracing. Nonselected offscreen relations remain visibly summarized, not silently discarded. |
| Hidden by filter | Keep approved dashed projected bridges and exact hidden unions. Relation list distinguishes hidden from offscreen; reveal is explicit. |
| Outside source/scope | Boundary explanation, no hidden traversal across it. No misleading complete-neighborhood label. |
| Pending span / late cause | Stable event identity. New resolved counts update; traced endpoints remain stable. Causal reordering reanchors viewport. Bundle membership updates with a modest “N added” indication while pinned. |
| Live stream while reading relations | Keep search text, focus, anchor and list row identity. Do not reshuffle a searched result under the pointer; preserve the keyed row and show an update indicator if order changes. |
| Focused event filtered out | Keep selection/details and a named anchor-hidden state. Do not clear filters or select a different anchor automatically. Its in-scope visible relations can remain explained with boundary labels. |
| Selected event changes while pinned | Inspector follows record selection; graph explicitly continues to name its pinned anchor. Return to anchor and Unpin are visible. |
| Group member becomes error | Split/unfold to surface it; preserve selected/pinned event and scroll anchor. |
| Graph hidden | No rail presentation queries/layout/painting. Counts needed by a visible relationship inspector can remain active; hidden graph DOM is absent. |
| Narrow graph or shell | Count portals and exact trace remain usable; inspect in existing drawer. No shrinking event marks into illegibility. |
| Cycle / self-link / ambiguity | Separate diagnostic entry, never a normal bus implying valid forward causation. |

Use existing Up/Down or J/K navigation for display rows; Home/End should follow the same accessible grid contract once implemented. Enter inspects an event. Count controls and summary disclosures are keyboard reachable without making every SVG edge a tab stop. Give a selected row a concise accessible description, then expose detailed relationship navigation in the list. Do not read a thousand cause names in one `aria-description`.

A one-hop relation browser should be a labelled list/grid with virtualized item positions and counts. Preserve focus by identity when its item leaves the mounted window; scroll it into view for keyboard navigation. Named offscreen continuation actions use ordinary buttons. Touch needs the same actions without hover. Scope-local shortcuts must not override text editing or the existing Back/Forward/Escape behavior.

## Architecture: summarize before laying out

Keep the raw causal graph, stable handles, topological order and measured-time model. Add a product-owned presentation projection; do not turn the core linked-list API into a graph-UI protocol.

```text
captured evidence → raw graph/order → scope/filter/context membership
                                  ↘ adjacency + typed boundary summaries
membership + local density → base presentation (edges / bundles / ports)
base presentation → bounded track geometry → mounted window slices
selection → highlight styling on existing records/relations/summaries
explicit trace/pin → reserved detail tracks + inspector
membership + explicit fold sets → shared display rows → ONE virtualizer
```

Necessary changes for a future implementation:

1. Maintain outgoing adjacency as well as parents, with per-event scoped counts and structured boundary reasons. Index by stable event identity, not display name. Resolve counts from that index; do not parse diagnostic strings.
2. Choose direct edges versus bundle membership **before** `layoutCausalLanes`. Default overview must not compute the full lane layout it will never display. Keep a reference full-graph oracle for semantic tests, not in the common paint path.
3. A bus stores its common endpoint, exact member set/index and direction/provenance. Query only members within the visible rank interval for branches. Do not first materialize all member intervals and then collapse them into a bus.
4. Compute window geometry once and share slices. Do not serialize every crossing edge separately on every row. Fixed semantic track roles give more useful stability than preserving thousands of old lane numbers.
5. Filtered nearest-predecessor projection can itself be dense. Do not eagerly build every projected pair simply to report a total. Use indexed, lazy target/direction traversal and cached summaries; compute exact expensive projected totals on demand with a pending state. Raw known direct-neighbor counts can remain immediate. A work budget must produce “calculating” or an explicit incomplete summary, never a silently capped exact number.
6. Keep large relation browsing and folds under normal Reatom connection lifetimes. Hover changes paint state only; it cannot allocate a graph, subscribe to all rows, or trigger full hidden-path closure.
7. The existing O(V+E) snapshot-copy and late-reorder costs are separate from rendering density. Summarization reduces presentation work but does not claim to fix all ingestion costs. Preserve the measured limitations in the completed plan until separate profiling supports changing them.

### Proposed performance and DOM budgets

These are acceptance targets to validate, not measured promises:

- For W mounted rows and a fixed base-track budget, the bundled overview uses O(W) marks/port controls plus bounded track geometry, independent of raw crossing-edge count. Do not globally allocate every raw interval before summarizing it.
- For the visible graph, start with at most four legible base tracks plus two explicitly requested trace tracks; additional bundles retain named count portals. Draw O(W + visible bundle members + selected trace output) geometry. Counts do not create one DOM node per relation.
- With 60 mounted rows and 1,000 or 10,000 hub relations, target at most 500 graph SVG elements, including branches/markers. If more detail would exceed the budget, use a named portal representation; never remove event rows implicitly.
- Relationship browser mounts approximately one viewport plus overscan (initial target ≤60 items). Typing a relation search must not rerun global lane allocation or remount the main scroller.
- Hover and a section resize should not traverse raw V/E. Target ≤16ms p95 for hover/selection presentation changes on the agreed benchmark machine after required indexes exist; publish actual timing before claiming success.
- Initial dense graph load, hidden-path counts and late causal reorder get independent measurements. Use a pending explanation for work over an interaction frame; never freeze the view while pretending counts are already exact.
- No bitmap/canvas swap is proposed as the first fix. Canvas may reduce DOM overhead but still paints an incomprehensible global graph unless the presentation model changes.

## Implementation phases after product decisions

1. **Presentation contract and fixtures.** Apply the resolved keep-every-row and highlight-only selection behavior. Add fixtures for 1,000 recorded causes, 1,000 effects across many viewports, unrelated hubs, a diamond, mixed direct/filtered paths, pending endpoints and source boundaries. Update the intended causal presentation rules in DESIGN.md during implementation; do not alter the completed historical plan.
2. **Stable bundled overview and scalable relationship browser.** Remove draw-all dependence from overview. Add truthful directional counts, typed boundary summaries, incoming/outgoing indexes, count activation and keyed virtualized relation browsing. Keep raw data, row order and current selection intact. This phase should already make huge captures readable.
3. **Highlighting and exact traces.** Add selection styling over the stable base graph, an optional detail pin, window member queries, named continuation ports and explicit relation tracing. Verify complete small structures and truthful dense summaries without arbitrary representatives. Selection must preserve every row and nonselected summary. Include filter bridges and late data.
4. **Optional explicit Focus context — separate follow-up.** If separately chosen, add a reversible in-scope context projection with a visible breadcrumb, one-hop definition, frontier expansion and Back to all events. Preserve one shared window/order and viewport history.
5. **Optional row folding — separate follow-up.** If separately chosen, add the display-row union, safe eligibility, summary Time/Graph semantics, selection/reveal/split rules and group keyboard behavior. This phase depends on explicit approval of row-summary behavior. Do not bake it into count activation or selection.
6. **Profile and document.** Measure 1k/10k fan-in/out, dense visible bridges, 100k-event capture, live updates and narrow shells. Verify all nonempty section combinations and inspector remount behavior. Update help, accessible descriptions, relevant product contracts and test expectations. Shared RailGraph remains unchanged unless separately redesigned.

Tests should assert what users can determine: exact units/counts, one event per identity, no false bus membership, reachable offscreen endpoints, retained selection/pin/focus, visible boundary reasons, predictable expansion, and bounded mounted output. Add algorithmic oracles for aggregate membership/hidden unions; do not assert only that a helper matches its own chosen first-N list. Existing stories that assert every raw crossing has a mounted path must be rewritten around the newly approved presentation contract, while raw graph correctness tests remain.

## Grounding case: Streaming reply in progress

The user identified `integration-chat--streaming-reply-in-progress` as the concrete problem to inspect. This section supplements the synthetic 1,000-neighbor cases: the actual story is a small interaction producing a broad mixed capture. It changes the priority from “handle enormous hubs” alone to **help the person locate one operation and understand its causal route through several layers**.

### Source-derived evidence

| Source | Checked fact | Design consequence |
| --- | --- | --- |
| `packages/admin/src/stories/chat/chat.stories.ts`, `StreamingReplyInProgress` | `slowReply` has `Hello` after 200ms, ` there` after another 2,500ms delay, then a finish chunk. The story sends “Say hello”, selects the synthetic In progress row, and waits for selection to become a completed named record. It does not clear immediately before Send. | This is two content chunks, not a thousand-token load test. Preserve the request's selected identity across completion; do not blame all density on stream length. |
| `packages/admin/src/stories/chat/boot.tsx` and `packages/admin/src/stories/harness/live.ts` | Browser state and mocks are prepared; `connectLiveAdmin()` clears the sink and connects the admin **before** chat `boot()` and app mounting. | The captured session includes app startup and mounting as well as the interaction. Startup records are real context, but unrelated startup rails should not dominate inspection of this send. |
| `packages/admin/src/stories/harness/otel.ts` | One telemetry instance is installed before example modules, with service name `admin-stories` and queue limit 5,000. | Model-name families such as `auth.*`, `chat.*`, `features.*` and `render.*` are not automatically separate OTLP sources. Preserve actual source identity and bounds; do not turn name prefixes into source exclusions. |
| `examples/chat/src/app/boot.ts` | Boot initializes platform/storage/sync, loads library/presets, recovers interrupted work, initializes auth and catalog. | A broad initial capture is expected from the harness. Namespace grouping can help browse it, but a prefix is not evidence of exclusive operation membership. |
| `examples/chat/src/chat/engine.ts`, `send` / `runReply` | The async send acquires a stream lock; a new chat creates model/message records, clears draft, updates route and storage, publishes sync events, streams the reply, releases the stream, and finishes the turn. | One request has meaningful setup, content, persistence and completion branches. It is not merely a chain of token writes. |
| Same engine, `streamReply` / `applyEvent` / `flushNow` | A stream item can produce several parsed events. Content appends update a message through a replaced messages Map. The flush timer also increments `message.rev`, commits a new message snapshot and persists/syncs it. `examples/chat/src/app/timings.ts` defaults the timer to 500ms. | Recorded updates are not one-to-one with text chunks. Some repeated message/path activity can be bookkeeping without new displayed content. Never call every update a token. |
| `examples/chat/src/chat/chatModel.ts` | `chat.model#<chat>.path` depends on messages and selection; `.streaming` uses local/remote stream state. The initial `#new` model and the created chat model are separate instances. | Similar names are not duplicate events or interchangeable identities. A new-chat transition can legitimately create another family of related rows. |
| `examples/chat/src/features/thread/Thread.tsx`, `AssistantMessage.tsx`, and `examples/chat/src/render/MessageBody.tsx` | Path data feeds per-message nodes and assistant message/content/streaming computeds. `render.messageBody#<instance>.view` reads content **and streaming**, then schedules rendering. Memoization and unchanged-result suppression can avoid some telemetry events. | A useful explanation crosses several model layers. Completion may change rendering even when the text does not change. One-hop focus can stop at a wrapper node and fail to answer the user's question. |

The following is a **source dependency skeleton**, not a claim that every step emitted a telemetry record in the observed run:

```text
chat.engine.send / stream continuation
    ├─ new-chat setup, route, locks, storage and sync
    └─ chat.model#<chat>.messages
         → chat.model#<chat>.path
         → features.thread#<chat>.nodesById
         → features.thread#<chat>.row#<message>.node
         → features.thread.assistant#<message>.message
              ├─ .content ──────┐
              └─ .streaming ────┴→ render.messageBody#<instance>.view
```

Only recorded edges may be used for the displayed causal explanation. Do not reconstruct this entire skeleton from names when telemetry omits an unchanged computation. The `chat.engine.streamLifecycle` action supplies started/first-token/completed/stopped/failed application events in source; the UI may name those milestones only when the corresponding event/value is actually available in the capture.

### Runtime observation, reported by the parent agent

The parent inspected the requested running Storybook story after its play completed, around 01:22–01:24 local app time on 2026-10-23. Astra did not open a concurrent browser. These are sampled observations of that run, **not fixture constants or reproducible benchmark medians**:

- Header: **501 raw records**. Status: **407 rows / 501 records / 94 hidden**.
- Graph header: **79 lanes** in the default **116px** graph column.
- DOM inspection: **30 mounted rows**, **429 SVG edge segments**, **52 distinct edge keys**.
- Selected `chat.engine.send` row: **26 crossing segments**. This is not its incident-edge count: the row renders unrelated passing edges too.
- Startup examples such as `routes.home#16.loader.onFulfill` and `auth.apiKeyHash` had six crossings each in the sampled window.
- Timeline grid: approximately **433 × 449px** with the inspector open; sampled `scrollTop` **2645**.
- Screenshot observation: long colored stripes squeezed beneath right-side dots; startup/auth/storage rows appeared near the send; Time and the right side of the toolbar were offscreen.

A second runtime inspection exposed a **misleading relationship count**, separate from graph density. The selected completed `chat.engine.send` had frame ID `166` and no cause IDs. Its existing Cause Chain showed “0 causes / 0 effects” and “Root event”. An adjacent `chat.streams.setLocal` record in the same trace had frame ID `167`, `causeIds: ["166"]`, and `parentSpanId` equal to the send span ID. Therefore at least one direct effect was present in both causal and containment evidence. These sampled frame IDs identify this observation only; they are not fixture contracts.

Source verification in `packages/admin/src/view/otlp/FrameCard.tsx`, `causeNodes`, explains the mismatch: it passes the selected record and records matching **the selected record's cause IDs** to RailGraph. This parent-only subset contains no queried children, while RailGraph still labels a count as effects. “0 effects” therefore describes the supplied subset, not the captured event's true outgoing adjacency. Do not interpret it as missing telemetry, and do not reuse that badge as the new browser's count source. The future relationship browser must derive both directions from the scoped raw graph and state any displayed subset explicitly. Fixing this existing inspector mismatch belongs to a subsequent runtime change, not this brainstorm edit.

This disproves any assumption that “fewer than 500 SVG elements” alone means the presentation is understandable: the proposed initial 500-element budget is met by this sampled window, yet it is visually overwhelming. The stronger acceptance condition is **a bounded set of legible, named semantic routes with no unrelated background crossings**. Keep the DOM budget as an engineering guard, not the product success criterion. Horizontal fit is a separate usability problem; graph compression cannot be used to pretend all three sections are comfortably visible beside an inspector.

### Unresolved integration acceptance issue

The parent subsequently ran the requested `StreamingReplyInProgress` story in a focused Vitest browser invocation. It **failed at `packages/admin/src/stories/chat/chat.stories.ts:178`**, waiting for a mounted row named “In progress”. The reported log is `/tmp/reatom-causal-chat-streaming-tests.log`. Its failure screenshot ended with 501 records / 407 rows, startup/library/auth rows mounted, the chat reply completed, and no selected pending row.

Manual Storybook play in the in-app browser did select the placeholder and successfully promote it to `chat.engine.send`. The cause of the automated failure is **not established**: virtualization/follow behavior, timing or another pending-row defect remain possibilities, not findings. Do not claim this integration story passed or that folding fixes it. It is a separate acceptance issue to resolve before relying on the pending-selection journey.

The parent also reported **five causal stories plus one mount regression passing (six tests)**. Those checks do not replace the failing requested integration story. These test outcomes are parent-reported; Astra did not rerun tests during this document-only update.

### What changes in the recommendation

1. **Keep base bundles and highlight related records; consider explicit operation navigation as a follow-up.** Inspecting `chat.engine.send` should offer a named “Focus this operation” action, while selecting an assistant-content update should offer an upstream trace. A shared bus helps the request's genuinely shared endpoint relations; it does not explain every serial wrapper or every repeated occurrence by itself.
2. **Define operation context using explicit containment, separately from causation.** A request context can include logs with the same scoped owning span and recorded descendant spans through `parentSpanId`. Call them “Records in this operation,” not “Effects.” Causal links that enter or leave it remain boundary connections with explicit navigation. Do not include every record between the request's start and end, every `chat.*` name, or every record in the same broad trace by default.
3. **Support the pending state before a causal frame exists.** The selected synthetic In progress row may have only a known scoped span identity. It can already show known contained logs and a live duration. Say “Causal links not yet available” when appropriate; do not label an empty parent list as proof of no causes. Promotion to the completed send retains this operation anchor, selection, scroll position and relation-browser state.
4. **Trace corridors as well as stars.** Offer a deterministic “Continue upstream/downstream” at a frontier. Consecutive recorded one-in/one-out steps can be presented as a route with an explicit “via N recorded steps” disclosure; stop at a branch, join, error, unresolved endpoint, cycle or source/scope boundary. This is a path presentation, not fabricated telemetry or automatic global row folding. Distinguish deliberately collapsed route steps from filter-hidden steps in details; the approved dashed bridge/count rule remains for hidden intermediates.
5. **Keep successive occurrences separate.** The two content changes, a revision-only flush, a streaming-state transition and render work can have related names but different meanings. The list may group their names for navigation, but it must retain event IDs, timing and value previews. Do not fold everything named `.messages` into a single “token stream” or discard the final streaming-state transition because content is unchanged.
6. **Evaluate at interaction width.** The actual inspector leaves roughly 433px for the sampled grid. Default selected-event explanation must work at that width without requiring the user to widen a 79-lane graph. Keep an accessible path to Time/section controls even when horizontal scrolling is needed. Treat any default section-width change as a separate product choice, not a hidden effect of folding.

Operation context remains a separate explicit follow-up. The default-selection question is resolved: highlight related records/connections in the full unchanged timeline. Selecting the send must not automatically scope the timeline to that operation. The proposed pipeline therefore gains two named context kinds, `causal neighborhood` and `span operation`, with truthful membership labels; it does not conflate them into an unlabeled “connected” set.

### Concrete acceptance journey

Use this exact integration story before adding artificial high-degree stress data. Operation-context navigation in steps 3 and 7 applies only if that separate follow-up is implemented; it is not a prerequisite for the approved bundled-base/highlight-only change:

1. Run its existing boot/send/play path without clearing away startup. Record capture totals, active filters, selected identity, lane/geometry counts and available grid width; do not assert 501/407/79 as constants. Independently resolve outgoing raw causal adjacency for the selected send and assert that the known setLocal child appears in Effects. Never use the existing parent-only Cause Chain legend as the oracle.
2. While the reply is pending, select In progress. The request bar and known contained activity remain useful even if its causal frame is unavailable. No startup rail forest appears solely because those intervals cross the selected row.
3. Open “Records in this operation.” The membership has a scoped span/containment explanation. Unrelated startup activity remains reachable outside context and is counted accurately; it is not relabeled as missing data.
4. At the first text update, trace from the recorded assistant-content or MessageBody view event upstream. Show actual captured edges; where intermediate unchanged computations were not recorded, do not invent the source skeleton. Let the person expand recorded corridor steps and choose branches.
5. Across the 2,500ms mock delay and possible 500ms persistence flush, preserve the real time axis. Show occurrence/state differences rather than pretending each revision is another token. The exact runtime timing and emitted event count may vary.
6. At completion, preserve selected request/operation identity through placeholder promotion. A final render caused by streaming-state change remains explainable even if the content is still “Hello there”.
7. Return to the full capture at the previous stable row anchor. Select a startup event and then the send again; related highlights change, while base relationship summaries, shared row ordering, filter state and viewport anchor remain stable.
8. Repeat with Mount logs and Aborted/suspense toggles. Hidden-route explanations stay dashed/count-marked, context membership and source boundaries remain truthful, and no graph-owned filter silently overwrites the user's settings.
9. At the sampled narrow grid width and with Graph/Logs/Time toggles, keep record names, relation controls and access to measured time usable. Verify semantic-track limits as well as SVG/DOM limits.
10. Only then extend the stream to hundreds of chunks and add independent high-degree fixtures. This distinguishes ordinary-operation explanation failures from true hub-cardinality or long-stream scaling failures.


## Resolved product questions and implementation assumptions

**Q1 — Initial row density: RESOLVED.** Author response: **“Keep every row; bundle dense rails”.** Preserve individual event rows under existing explicit filters. Bundle dense relations. Event-row folding is a separate optional follow-up, not an implementation gate or implied authorization.

**Q2 — What selection changes: RESOLVED.** Author response: **“just highlight the relative”.** Highlight related records and connections within the full unchanged row timeline. Selection must not filter, hide, collapse or move unrelated rows, silently change operation scope, or discard the visible summaries of nonselected relations. Explicit Trace/Expand may show requested detail while preserving the base summaries.

**Q3 — Detail anchor ownership: recommended implementation assumption, not another author gate.** Let the highlight/detail anchor follow selection until an optional explicit Pin. Pin preserves a named detail context; it does not override the base graph's membership or the highlight-only selection rule. If pinning adds unnecessary complexity to the MVP, defer it rather than ask another preference question.

Real-time bars, causes-before-effects rows and boundary-respecting dashed hidden bridges remain settled. Track budgets and exact visual tokens are prototype defaults. Operation/context focus and row-fold semantics above remain explicitly separate follow-up proposals.
