---
sourcesHash: c27d9b382f30d96af86654a7016739c79929f1507d1389d33cb6ef79c12831b2
id: toast
description: >-
  Show one short status with an optional undo action, then dismiss it when
  the time runs out or the person dismisses it. The node stays in the
  mounted tree, including a shadow root.
status: discoverable
sources:
  - src/view/design-system/Toast.tsx
examples:
  - src/stories/design-system/overlays.stories.tsx
---

# Toast

## When to use

- A destructive action just happened and the person can undo it for a limited time. Pass `actionLabel` and `onAction`.
- A short confirmation does not need a dialog and should leave by itself. Omit the action.

Place it in a positioned shell such as [debugger workspace](../layouts/debugger-workspace.md).

## When not to use

- An error the person must read inside the selected record. Keep that in the frame card.
- A panel of content. Use [Drawer](./drawer.md).
- A stable explanation of an empty region. Use [EmptyState](./empty-state.md).

## Public API

Import `Toast` from `src/view/design-system`.

```tsx
<Toast
  open={open}
  message="Records cleared"
  actionLabel="Undo"
  onAction={restore}
  onDismiss={dropSnapshot}
/>
```

- `open` is the caller's atom. The toast sets it false when it closes.
- `message` is the sentence the person reads.
- `actionLabel` and `onAction` together show the action button. `onAction` performs the undo. The toast then closes and does not call `onDismiss`.
- `onDismiss` runs when the time runs out or the person presses Dismiss. The caller drops the undo snapshot here.
- `durationMs` defaults to 8000. The caller may shorten it.

The toast does not know how to restore records. That stays in `onAction`.

## Behaviour and states

While `open` is false, nothing is shown. While open, the message, the optional action, and Dismiss are visible. The timer starts when the toast appears and is cleared if it closes first. Closing from the action does not run `onDismiss`. The fade transition is removed under reduced motion.

## Accessibility

The component uses `role="status"`. The action and Dismiss are [Button](./button.md)s named by the caller and by "Dismiss". The caller writes `message` as a full sentence.
