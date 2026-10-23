---
id: inspect-record
description: >-
  Open one selected record beside the view, or in a bottom drawer when the
  shell is narrow, and close it without losing the row.
status: discoverable
sources: []
examples:
  - src/stories/design-system/debugger-workspace.stories.tsx
---

# Inspect a record

## When to use

Use this pattern when all of these hold:

- A view lists records and one record is selected.
- The person needs that record's detail without leaving the list.
- The detail can close, and the list selection remains.

## When not to use

- Nothing is selected. Show the list only. Do not open an empty frame card.
- The person is switching Timeline, State, and Graph. That is [Tabs](../components/tabs.md), not this card.
- The person is reading a cause chain as the whole view. That view may still link a node back to this card.

## Structure

Regions, in order:

1. The main view, which owns selection. The product Gantt is this view. It is not a kit component.
2. The frame card, placed by [debugger workspace](../layouts/debugger-workspace.md). Wide shells use the side pane. Narrow shells use [Drawer](../components/drawer.md).
3. Inside the card, the caller shows name, kind, outcome, duration, and a Close record details [Button](../components/button.md), then [InspectorTabs](../components/inspector-tabs.md). Overview shows errors first, then current state for atoms/computeds, or payload and actual action arguments. Internal computed previous-state inputs do not appear as Param. A successful local action returning its single argument shows the value once when exact identity/value equality proves duplication; replay keeps both fields. Missing fields mount no tree; captured undefined, errors and unfinished results remain visible. [Inspector](../components/inspector.md) reads each value with the tree open, including nested collections. Event logs show the error if there is one, then grouped attributes under headings (Exception, Page, Metrics, Attribution, Identity, Other). Cause Chain uses [RailGraph](../components/rail-graph.md) for small neighborhoods with unique numeric telemetry frame IDs. The causal timeline also supplies exact scoped cause/effect counts and a searchable virtualized relationship list in that same card; larger or incompatible-identity neighborhoods use the list without fabricating frame IDs. Trace keeps the selected record, while Go to event explicitly selects another recorded event. History and JSON are the other sections. Attributes, causes, effects, and resource stay off the model Overview.

```tsx
<DebuggerWorkspace
  main={gantt}
  inspector={() => frameCard}
  inspectorLabel="Frame"
  inspectorOpen={open}
  onInspectorClose={closeAndFocusRow}
/>
```

## Composition

### Required

- The card uses the workspace placement. It does not use a viewport media query.
- The header close button uses the same close-and-focus-row path in either placement. Closing preserves the selected row, which can reopen the card.
- Escape closes the top admin layer. In the wide shell that is the card, unless focus is in a text field. In the drawer, [Drawer](../components/drawer.md) closes and restores focus. The caller returns focus to the selected row from `onInspectorClose` when the drawer did not.
- The error, when present, is the first block in the card after the identity line.
- Card state and selection live in atoms. The workspace reparents `main` and calls `inspector` again when the shell crosses 680px.

### Recommendations

- "Open in Graph" is a [Button](../components/button.md) on Cause Chain that selects the Graph tab. It is not a second graph component.

### Exceptions

None.

## Verification

A valid composition is the wide and narrow stories in `src/stories/design-system/debugger-workspace.stories.tsx`: the wide shell shows "Resize panes" and the record text, the narrow shell shows a dialog, and Escape in the narrow shell removes the card and keeps the timeline.

A violation is a frame card positioned with a viewport media query, or a second copy of the record shown in a page region outside the workspace card. Those fail this pattern even if the card's contents are correct.

Product journeys that walk a real record are out of this kit check.
