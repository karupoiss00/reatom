---
sourcesHash: 5a74582abb0ade174d5e33ffc5621f649806d9cbe8fed5a8bc87fe317b2d3eb0
id: data-grid
description: >-
  Present one single-select table of records that share the same columns.
  Arrow keys, J and K, Home, and End move the selection.
status: discoverable
sources:
  - src/view/design-system/DataGrid.tsx
examples:
  - src/stories/design-system/workspace.stories.tsx
---

# Data grid

## When to use

- The person scans rows that share one set of columns and selects exactly one row. The caller owns the row data, the selected id, and what selecting a row does.

## When not to use

- A cause chain of parent and child records. Use [RailGraph](./rail-graph.md).
- One nested value. Use [Inspector](./inspector.md).
- A waterfall of timed bars. That stays the product Gantt, which may still use this grid for a log of uniform columns.
- An empty explanation with no columns. Use [EmptyState](./empty-state.md) as this grid's `empty` slot when there are no rows.

## Public API

Import `DataGrid` from `src/view/design-system`.

```tsx
<DataGrid
  ariaLabel="Records"
  columns={columns}
  rows={rows}
  getRowId={rowId}
  selectedId={selectedId}
  onSelect={selectRow}
  empty={<EmptyState title="No records" description="Nothing matches." />}
/>
```

- `ariaLabel` names the grid. The caller describes the set of rows, such as "Records".
- `columns` is the shared header and cell layout. Each column has a stable `id`, a visible `header`, an optional CSS `width` track, and `render` for the cell. Width defaults to `minmax(0, 1fr)`.
- `rows` reads the current row array. The caller returns the filtered rows.
- `getRowId` returns a stable string for one row. Selection compares these ids.
- `selectedId` reads the selected id, or null when nothing is selected.
- `onSelect` receives the row the person chose.
- `empty` is the element shown when `rows` is empty. Use [EmptyState](./empty-state.md) when the reason can be explained.
- `rowTestAttr` adds extra attributes on a row for tests. It must not replace the row's name or selection.

## Behaviour and states

The grid shows a header row and then either `empty` or the body. A selected row uses `aria-selected`. Clicking a row, or pressing Enter or Space on it, calls `onSelect`.

When focus is inside the grid, Arrow Down and J move to the next row, Arrow Up and K to the previous row, Home to the first, and End to the last. From no selection, Arrow Down and J select the first row and Arrow Up and K select the last. The caller persists that selection.

Every row is in the tab order. This grid does not use a single tab stop.

## Accessibility

The component sets `role="grid"`, the column headers, `role="row"`, and `aria-selected`. The caller supplies `ariaLabel`, headers, and cell text that name the data. The component does not decide which row is selected.
