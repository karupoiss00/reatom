---
sourcesHash: 304d25956c031d8ece6403d99e91f2a77471368d018cf15369c4fe88a1386efd
id: icon
description: >-
  Draw one named admin glyph in the current text color. Decorative unless
  the caller passes a label because the icon is the only name.
status: discoverable
sources:
  - src/view/design-system/Icon.tsx
---

# Icon

## When to use

- A control or status already has a text name, and a familiar glyph should sit beside that text. Omit `label` so the icon is decorative.
- The glyph is the only visible content and must be the accessible name. Pass `label`. Prefer a [Button](./button.md) `label` for any control, and keep the icon decorative inside it.

## When not to use

- A control by itself. Use [Button](./button.md) and pass the icon as children.
- A status that needs words. Use [StatusBar](./status-bar.md) `StatusDot`, which includes text.
- A keyboard chord. Use [Kbd](./kbd.md).

## Public API

Import `Icon` from `src/view/design-system`. `name` is one of `activity`, `state`, `timeline`, `graph`, `filters`, `search`, `pause`, `play`, `export`, `import`, `close`, `error`, `more`, `minimize`, `copy`, `download`, `follow`, `action`, `atom`, `computed`, `effect`, `log`, `mount`, `route`, `framework`, `abort`, `suspense`, `pending`, `chevron-right`, `chevron-down`.

```tsx
<Icon name="search" />
```

- `name` selects the glyph. The caller picks the name that matches the adjacent text.
- `size` is the pixel box. Default 14, matching the icon size token. Pass 16 only when the control uses the large icon size.
- `label` when set is the accessible name. Omit it when text next to the icon already names the control.

Stroke and fill use `currentColor`, so the parent sets the token color. A glyph may mix a stroke and a filled part.

## Behaviour and states

The icon is static. It does not have a pressed or disabled state. The parent control owns those.

## Accessibility

With no `label`, the component sets `aria-hidden`. With `label`, it sets `aria-label` and does not hide the svg. The caller must not pass `label` when the parent button already has the same name.
