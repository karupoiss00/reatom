---
sourcesHash: 8d4d4522848640fa45793fd32fc19f3e59872a48f3cefa106f961803c282fa15
id: disclosure
description: >-
  Hide extra content under one heading until the person expands it.
  It starts collapsed unless the open atom is already true.
status: discoverable
sources:
  - src/view/design-system/Disclosure.tsx
examples:
  - src/stories/design-system/disclosure.stories.tsx
---

# Disclosure

## When to use

- Secondary content, such as advanced filters, should stay collapsed until the person asks for it. The heading remains visible either way.

## When not to use

- Peer views that replace each other. Use [Tabs](./tabs.md).
- A node in a value tree. [Inspector](./inspector.md) owns those nested sections.
- An on/off filter that changes which rows are shown. Use [Button](./button.md) with `pressed`.

## Public API

Import `Disclosure` from `src/view/design-system`.

```tsx
<Disclosure label="Advanced filters">{calculator}</Disclosure>
```

- `label` is the summary. The caller names the hidden content, such as "Advanced filters".
- `open` optional. When passed, it is the atom the summary writes. Omit it to use an internal atom that starts closed.
- `onToggle` optional. It receives the next open boolean after the person toggles.
- `children` is the content shown while open.

## Behaviour and states

Collapsed is the default. Enter or Space on the summary, or a click, toggles it. The marker shows expanded or collapsed and is hidden from assistive tech. The component does not animate open and closed.

## Accessibility

The component uses a native `details` and `summary`. The caller writes `label` as the name of the section. The caller does not put another button inside the summary.
