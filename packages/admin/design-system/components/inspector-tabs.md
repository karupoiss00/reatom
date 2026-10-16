---
sourcesHash: 887879b6b81c28c93fd3e55dfbb75ae048200e8a46b4857f1da3c3689c387d5e
id: inspector-tabs
description: >-
  Switch the four sections of one selected record: Overview, Cause Chain,
  History, and JSON. A fixed Tabs preset.
status: discoverable
sources:
  - src/view/design-system/InspectorTabs.tsx
examples:
  - src/stories/design-system/workspace.stories.tsx
---

# Inspector tabs

## When to use

- The person moves between Overview, Cause Chain, History, and JSON for the one record already selected. The caller stores the selected id in an atom of those four ids and renders the matching panel.

## When not to use

- Switching Timeline, State, and Graph, or any other set of peer views. Use [Tabs](./tabs.md) with the caller's own ids and labels.
- Reading one structured value. Use [Inspector](./inspector.md). A selected panel may contain that tree.
- An on/off filter. Use [Button](./button.md) with `pressed`.

## Public API

Import `InspectorTabs` and `INSPECTOR_TABS` from `src/view/design-system`.

```tsx
<InspectorTabs value={frameSection} />
```

- `value` is an atom of `overview`, `causes`, `history`, or `json`. The caller creates it and renders the panel for the current id.
- The labels and order are fixed: Overview, Cause Chain, History, JSON. `INSPECTOR_TABS` is that list when the caller needs the ids.

The tab list is [Tabs](./tabs.md) named "Frame details". This component does not render the panels.

## Behaviour and states

Selection and keyboard follow [Tabs](./tabs.md). Clicking a tab or using the arrow keys writes the atom.

## Accessibility

The component supplies the tab names and the list name "Frame details". The caller supplies a panel for the selected id and does not add a second tab list for the same four sections.
