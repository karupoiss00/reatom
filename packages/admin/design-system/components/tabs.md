---
sourcesHash: b72f35924da4eb5d24d1bd7df4ecab28a695550a26e0568db3d268ef4a59df0c
id: tabs
description: >-
  Switch one visible section among peer sections. Arrow keys move the
  selected tab and the selection wraps. The caller renders the selected panel.
status: discoverable
sources:
  - src/view/design-system/Tabs.tsx
examples:
  - src/stories/design-system/controls.stories.tsx
---

# Tabs

## When to use

- The person chooses one of several peer sections, and the other sections are not shown at the same time. Timeline, State, and Graph are this kind of choice. The caller owns the ids, the labels, and the panel for the selected id.

## When not to use

- The four fixed sections of one selected record. Use [InspectorTabs](./inspector-tabs.md).
- An on/off filter that does not replace the view. Use [Button](./button.md) with `pressed`.
- Extra fields that stay under one heading and start collapsed. Use [Disclosure](./disclosure.md).

## Public API

Import `Tabs` from `src/view/design-system`.

```tsx
<Tabs
  ariaLabel="Views"
  value={view}
  items={[
    { id: 'timeline', label: 'Timeline' },
    { id: 'state', label: 'State' },
    { id: 'graph', label: 'Graph' },
  ]}
/>
```

- `value` is an atom of the selected id. The caller creates it and shows the matching panel elsewhere.
- `items` is the tabs in order. Each item has a stable `id` and a visible `label`. At least one item.
- `ariaLabel` names the tab list, such as "Views". It is not one of the tab labels.

This component does not render panels and does not set `aria-controls`. The caller associates each panel with the selected id.

## Behaviour and states

Clicking a tab selects it. Arrow Right and Arrow Down select the next tab and wrap. Arrow Left and Arrow Up select the previous tab and wrap. Home selects the first. End selects the last. The selected tab is the only tab in the tab order.

The selected tab uses the accent token as an underline. Transitions stop under reduced motion.

Tabs wrap onto additional rows when needed so every section remains visible. Each tab keeps the minimum tab height and does not overlap its peers.

## Accessibility

The component sets `role="tablist"`, `role="tab"`, `aria-selected`, and the roving `tabindex`. The caller supplies `ariaLabel`, labels, and the visible panel for the selected id. The caller does not build a second set of buttons for the same sections.
