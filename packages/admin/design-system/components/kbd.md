---
sourcesHash: f0d0c0dbceceb4ba86a64581f27f85351d5ec41488fb5776fe0b6a8012b01720
id: kbd
description: >-
  Show one keyboard shortcut as keycaps so the person can recognize it
  beside a control, in a hint, or in help.
status: discoverable
sources:
  - src/view/design-system/Kbd.tsx
examples:
  - src/stories/design-system/disclosure.stories.tsx
---

# Kbd

## When to use

- A shortcut should be visible as keycaps next to the control it runs, or in a help list. The caller passes the keys in chord order.

## When not to use

- The control that performs the shortcut. Use [Button](./button.md) or [Field](./field.md), and place this chord beside it.
- The shortcut drawn inside `SearchField`. That field still renders its own shortcut string. The split is [a recorded gap](../gaps.md#searchfield-draws-its-own-shortcut-instead-of-kbd).
- A multi-line explanation of the shortcut. Use [Popover](./popover.md) and put this chord inside it.

## Public API

Import `Kbd` from `src/view/design-system`.

```tsx
<Kbd keys={['Alt', 'Left']} label="Alt Left" />
```

- `keys` is the visible keycaps in chord order, such as `['Alt', 'Left']` or `['?']`.
- `label` is the accessible name of the whole chord. It defaults to the keys joined by spaces. Pass it when the spoken chord should differ from the glyphs, such as a symbol key.

Colors and type come from [tokens.ts](../../src/view/design-system/tokens.ts).

## Behaviour and states

The chord is static. It is not a button and does not receive focus.

## Accessibility

The component renders a `kbd` whose accessible name is `label` or the joined keys. The caller orders `keys` to match the real shortcut. The caller does not repeat the same chord as the only name of the neighboring control.
