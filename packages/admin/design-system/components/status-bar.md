---
sourcesHash: ecf188c2c382c1e8a28a56113a634df81604692061b1dab8610089801abef005
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
- `StatusDot` `tone` is `success`, `warning`, `error`, or `info`, or a zero-arg read of one of those. `error` is for a failed fact, `warning` for a degraded one, `success` for a healthy one, and `info` for a neutral count.
- `StatusDot` `label` is the visible text, or a zero-arg read. The words carry the meaning. The dot does not.

Colors are the status tokens in [tokens.ts](../../src/view/design-system/tokens.ts).

## Behaviour and states

The bar is static aside from reactive children and a reactive tone or label. It does not dismiss. The dot color follows the tone.

## Accessibility

The bar is a footer. The dot is hidden from assistive tech. The caller writes `label` so the words alone state the fact, including the tone, such as "2 errors" rather than a bare number.
