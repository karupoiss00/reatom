---
id: undoable-destructive-action
description: >-
  Run a destructive action with a danger button, then offer one undo for a
  limited time. The toast does not restore the data itself.
status: discoverable
sources: []
examples:
  - src/stories/design-system/overlays.stories.tsx
---

# Undoable destructive action

## When to use

Use this pattern when all of these hold:

- The person starts an action that destroys or clears data they may want back.
- The previous data can be restored for a few seconds.
- One undo is enough. A second clear replaces the first undo.

## When not to use

- The action cannot be restored. Do not offer Undo. Ask with a confirmation only if the product already has one. This pattern does not add a confirm dialog.
- The person is closing a panel. That is Escape on [Drawer](../components/drawer.md), not an undo toast.
- A filter change. That is Reset in [filter records](./filter-records.md).

## Structure

1. A [Button](../components/button.md) with `variant="danger"` and a label that names the destruction, such as "Clear".
2. A [Toast](../components/toast.md) that opens when the clear happens. The message states what happened. The action label is "Undo".
3. The product keeps the snapshot. `onAction` restores it. `onDismiss` drops it when the toast expires or the person dismisses it. `onAction` does not also drop the snapshot through `onDismiss`. The toast calls only one of them.

```tsx
<Button variant="danger" label="Clear" onClick={clearWithSnapshot} />
<Toast
  open={undoOpen}
  message="Records cleared"
  actionLabel="Undo"
  onAction={restoreSnapshot}
  onDismiss={dropSnapshot}
/>
```

## Composition

### Required

- The danger button and the toast are both visible in the same shell. The toast is a descendant of that shell, including a shadow root.
- Undo stays available until the toast closes. The default time is 8000 ms. The caller may pass a shorter `durationMs`.
- A second clear replaces the snapshot. The first undo must not restore the older one.
- The toast does not call the connection or the record store. The caller does.

### Recommendations

- Put the toast in [debugger workspace](../layouts/debugger-workspace.md), which is positioned.

### Exceptions

None.

## Verification

A valid composition is "Undo toast restores before it expires": the message and Undo appear, Undo shows the restored outcome, and the message leaves without the dropped outcome. "Toast dismisses when the time runs out" shows the dropped outcome and removes the message.

A violation is a danger button that clears with no toast, or a toast whose Undo and Dismiss both run `onDismiss` and never `onAction`. Either one loses the undo.

The snapshot merge with records that arrived after the clear is product behavior and is out of this kit check.
