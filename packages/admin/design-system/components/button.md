---
sourcesHash: ec227a1e64a9c99c5dfa382f51f7ec8e4f21dadb36272a75e7d8c55f95d8759f
id: button
description: >-
  Invoke one immediate action, or show one on/off choice such as a filter
  chip, through a native button. The accessible name is the label.
status: discoverable
sources:
  - src/view/design-system/Button.tsx
examples:
  - src/stories/design-system/controls.stories.tsx
  - src/stories/design-system/chips.stories.tsx
---

# Button

## When to use

- The person invokes one action that happens immediately, such as reset, pause, copy, or close. Omit `pressed`.
- The person turns one independent choice on or off and that choice stays visible on the control, such as a filter chip or a mode. Pass `pressed`. Ghost is the usual chip variant; every variant keeps its pressed fill and accent border while hovered.

## When not to use

- Switching among peer views or sections that replace one another. Use [Tabs](./tabs.md). The fixed frame-detail sections use [InspectorTabs](./inspector-tabs.md).
- Typing a search string or picking from a known option list. Use [Field](./field.md).
- Showing only a keyboard chord. Use [Kbd](./kbd.md). A one-line native hint can be `title`; a short list or multi-line note uses [Popover](./popover.md).
- A temporary undo offer after a destructive action. Use [Toast](./toast.md). The danger button starts the action; it does not present the undo.

## Public API

Import `Button` and `ToolbarSeparator` from `src/view/design-system`.

```tsx
<Button
  variant="ghost"
  label="Errors"
  pressed={errorsOn}
  onClick={toggleErrors}
/>
```

- `label` is the accessible name and the default visible text. The caller writes the action or choice in the person's words.
- `children` replaces the visible content and does not change the accessible name. Use this for an icon inside the button. The icon stays decorative.
- `variant` chooses emphasis. `primary` is the single main action in a group. `secondary` is a supporting action. `ghost` is low emphasis and the required variant for an on/off chip. `danger` is a destructive action. `icon` is a square control whose visible content is an icon. The default is `secondary`.
- `pressed` omitted means a one-shot action and no `aria-pressed`. A boolean or a zero-arg read means a toggle; `true` is on. Read it from the filter or mode atom.
- `disabled` blocks the action. A boolean or a zero-arg read. Default is enabled.
- `title` is the native tooltip. A string or a zero-arg read. It defaults to `label`. Use it for one short phrase, including a count the chip does not show in its name.
- `type` is `button` or `submit`. Default `button`. Use `submit` only inside a real form.
- `onClick` runs the action or toggles the choice. Required.
- `testId` sets `data-testid` for stories. It does not change appearance.
- `ToolbarSeparator` is a non-text divider between groups inside [Toolbar](./toolbar.md). It is hidden from assistive tech.

Tokens come from [tokens.ts](../../src/view/design-system/tokens.ts). Do not pass a color.

## Behaviour and states

Enabled, hovered, pressed, and disabled are the visible states. Disabled buttons do not run `onClick`. Pressed and not-pressed are independent of hover.

A pressed control uses accent fill at 16% and an accent border at 55%. Hover on a pressed control keeps that fill and border. Hover on an unpressed control uses the shared accent wash. Danger pressed keeps the error fill on hover.

Hover and press transitions follow the shared motion tokens and stop under reduced motion.

## Accessibility

The component sets `aria-label` from `label`, `aria-pressed` only when `pressed` is passed, and `disabled` on the native button. The caller chooses `label`, `pressed`, and `disabled` so the name matches the visible action and the pressed state matches the real choice. Keyboard activation is the native button. The caller does not add another click handler on a child.
