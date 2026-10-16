---
sourcesHash: ba1c77ed18867064416299af13d366653a99dfb3f21c2c32275ae43d37a21e7d
id: split-pane
description: >-
  Place two regions side by side and let the person drag or arrow-key a
  vertical separator. Double-click restores the default ratio.
status: discoverable
sources:
  - src/view/design-system/SplitPane.tsx
examples:
  - src/stories/design-system/workspace.stories.tsx
---

# Split pane

## When to use

- Two regions stay on screen together, and the person may give one of them more width. The caller owns the ratio atom, both regions, the minimum widths, and the ratio to restore.

## When not to use

- A panel that must cover the main region and dismiss with Escape on a narrow shell. Use [Drawer](./drawer.md). The [debugger workspace](../layouts/debugger-workspace.md) chooses between this pane and that drawer.
- Stacking a header, a filter, a view, and a status line. Use [debugger workspace](../layouts/debugger-workspace.md).

## Public API

Import `SplitPane` from `src/view/design-system`.

```tsx
<SplitPane
  ratio={ratio}
  left={main}
  right={inspector}
  minLeft={280}
  minRight={240}
  defaultRatio={0.62}
/>
```

- `ratio` is an atom from 0 to 1 for the left pane's share of the width. The caller may persist it.
- `left` and `right` are the two regions.
- `minLeft` and `minRight` are pixel minimums used while dragging.
- `defaultRatio` is the value restored on double-click.

The separator is a fixed hit size from the size tokens.

## Behaviour and states

Dragging writes `ratio`, clamped so each side keeps its pixel minimum. Arrow Left decreases the ratio by 0.04 and Arrow Right increases it, but those keys clamp to 0.2 and 0.8 regardless of `minLeft` and `minRight`. The separator reports `aria-valuemin` 20 and `aria-valuemax` 80. That disagreement is [a recorded gap](../gaps.md#splitpane-keyboard-range-ignores-the-pane-minimums).

Double-click sets `ratio` to `defaultRatio`. The keyboard value text is the ratio as a percent.

## Accessibility

The separator is a button with `role="separator"`, name "Resize panes", and `aria-orientation="vertical"`. The caller does not add another resize control for the same two regions. The regions bring their own names.
