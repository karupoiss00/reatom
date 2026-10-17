---
sourcesHash: 5be13da3090218e77c0ca6db7446a4f182e96a30fcbaaf968910b7456bd778ad
id: status-bar
description: >-
  Pin one line of session status to the bottom of the shell. StatusDot adds
  a tone-colored mark plus the words that carry the meaning.
status: discoverable
sources:
  - src/view/design-system/StatusBar.tsx
examples:
  - src/stories/design-system/debugger-workspace.stories.tsx
---

# Status bar

## When to use

- The shell's bottom line should keep a short session status visible, such as how many rows are showing or whether capture is healthy. `StatusDot` is the mark-plus-words form of one fact inside that line.

## When not to use

- A message that disappears after an action. Use [Toast](./toast.md).
- The title of the screen. Put that in the header of [debugger workspace](../layouts/debugger-workspace.md).
- A control row. Use [Toolbar](./toolbar.md).

## Public API

Import `StatusBar` and `StatusDot` from `src/view/design-system`.

```tsx
<StatusBar>
  <span>12 of 40</span>
  <StatusDot tone="error" label="2 errors" />
</StatusBar>
```

- `StatusBar` `children` are the facts in that line, in reading order. The caller writes the counts and summaries.
- `StatusDot` `tone` is `success`, `warning`, `error`, `info`, or `accent`, or a zero-arg read of one of those. `error` is for a failed fact, `warning` for a degraded one, `success` for a healthy one, `info` for a neutral count, and `accent` for live capture.
- `StatusDot` `label` is the visible text, or a zero-arg read. The words carry the meaning. The dot does not.
- `StatusDot` `pulse` is optional. When true, the dot opacity eases 0.55↔1 over 1.4s. Reduced motion and a false pulse leave the dot steady.

Colors are the status tokens in [tokens.ts](../../src/view/design-system/tokens.ts).

## Behaviour and states

The bar is static aside from reactive children and a reactive tone, label, or pulse. It does not dismiss. The dot color follows the tone. A pulsed capturing dot stops when capture is paused.

## Accessibility

The bar is a footer. The dot is hidden from assistive tech. The caller writes `label` so the words alone state the fact, including the tone, such as "2 errors" rather than a bare number.
