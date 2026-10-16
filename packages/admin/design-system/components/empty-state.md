---
sourcesHash: ef840d2ff10d4ed5dfaae53d7713864b528aa740cb9c9b3e028529d2651dc50f
id: empty-state
description: >-
  Explain why a region has no rows and offer at most one next action.
status: discoverable
sources:
  - src/view/design-system/EmptyState.tsx
examples:
  - src/stories/design-system/workspace.stories.tsx
---

# Empty state

## When to use

- A region the person expected to contain data is empty, and a title plus one short explanation can say why. An optional action is the single next step, such as reset filters.

## When not to use

- A message that disappears on its own after an action. Use [Toast](./toast.md).
- The empty slot of a table that already has this explanation. Pass this component as [DataGrid](./data-grid.md) `empty` rather than stacking a second empty region.
- A field validation message. Keep that on [Field](./field.md).

## Public API

Import `EmptyState` from `src/view/design-system`.

```tsx
<EmptyState
  title="No records"
  description="Atoms nobody touched are absent."
  action={<Button label="Reset filters" onClick={reset} />}
/>
```

- `title` is the heading. The caller states the empty condition in a few words.
- `description` is one paragraph that says why it is empty or what is missing.
- `action` is one element, usually a [Button](./button.md), or null. The default is null. Omit it when there is no single next step.

## Behaviour and states

The region is static. It does not dismiss itself. The action, when present, is the caller's control and follows that control's states.

## Accessibility

The component renders the title as a heading and the description as a paragraph. The caller writes both so they stand alone in the region. The action brings its own name.
