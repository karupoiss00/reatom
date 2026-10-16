---
sourcesHash: c7a586aa2f53bc6e58abe90c826ebb215b037ddc59e06bdad3bea04ea69ca5e7
id: toolbar
description: >-
  Lay out one row of controls at the toolbar height, with groups and a
  flexible spacer. The row does not wrap.
status: discoverable
sources:
  - src/view/design-system/Toolbar.tsx
examples:
  - src/stories/design-system/controls.stories.tsx
---

# Toolbar

## When to use

- A header or filter row needs controls in one horizontal line: a group, a gap, and controls pushed to the far side. The caller chooses the controls.

## When not to use

- The bottom status line. Use [StatusBar](./status-bar.md).
- A labelled search or number by itself. Use [Field](./field.md). Place a search in a toolbar only when it sits in that control row.
- A second wrapping line of the same actions. Keep one toolbar and let the shell scroll horizontally if it must.

## Public API

Import `Toolbar`, `ToolbarGroup`, and `ToolbarSpacer` from `src/view/design-system`. The vertical divider is `ToolbarSeparator` from [Button](./button.md).

```tsx
<Toolbar>
  <ToolbarGroup>
    <Button label="Pause" onClick={pause} />
  </ToolbarGroup>
  <ToolbarSeparator />
  <ToolbarSpacer />
  <Button label="Help" onClick={help} />
</Toolbar>
```

- `Toolbar` `height` is a CSS length. It defaults to the toolbar size token. Pass another size token only when the row is the filter row, whose token is the filter height.
- `Toolbar` `children` are the groups, separators, spacer, and controls, in reading order.
- `ToolbarGroup` keeps a cluster of related controls together.
- `ToolbarSpacer` takes the free width so later controls sit at the end.

Background, border, and padding come from [tokens.ts](../../src/view/design-system/tokens.ts).

## Behaviour and states

The toolbar does not wrap and does not scroll itself. Controls keep their own hover, pressed, and disabled states. The spacer is not interactive.

## Accessibility

The toolbar does not add a landmark or a name. Separators are hidden. Each control brings its own name. The caller orders the controls in the reading order and does not use the spacer as a label.
