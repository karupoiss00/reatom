---
sourcesHash: 8b753abc3e8579d6ae146536c2311e7eaac3786405325e6944d88629ea1d4280
id: popover
description: >-
  Open a non-modal note anchored to its trigger. Escape or a press outside
  closes it. The panel stays in the trigger's tree, including a shadow root.
status: discoverable
sources:
  - src/view/design-system/Popover.tsx
examples:
  - src/stories/design-system/overlays.stories.tsx
---

# Popover

## When to use

- The person needs a short explanation or a short list, such as why records were dropped, without leaving the current view.
- The note is longer than one phrase, so [Button](./button.md) `title` is not enough.

## When not to use

- A panel that covers the bottom of the shell. Use [Drawer](./drawer.md).
- Two regions that stay side by side. Use [SplitPane](./split-pane.md).
- Only a keycap glyph. Use [Kbd](./kbd.md).
- One short phrase on a button. Use [Button](./button.md) `title`.

## Public API

Import `Popover` from `src/view/design-system`.

```tsx
<Popover triggerLabel="Drop reasons" label="Why records were dropped">
  <p>Queue overflow</p>
</Popover>
```

- `triggerLabel` is the button name. The caller names the fact the note explains.
- `label` is the panel name and its visible title.
- `children` is the note. Keep it to a short list or a few sentences.

The component owns the trigger because [Button](./button.md) does not expose an expanded state. The panel is not portaled to `document.body`.

## Behaviour and states

The panel starts closed. Activating the trigger toggles it. Escape closes it and returns focus to the trigger. A press outside the trigger and panel closes it and leaves focus on what was pressed. The panel transition is removed under reduced motion.

## Accessibility

The trigger is a button with `aria-expanded` and `aria-haspopup="dialog"`. The open panel is a non-modal dialog named by `label`. The caller writes both strings so they differ when the trigger and the note are not the same phrase.
