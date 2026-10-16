---
id: filter-records
description: >-
  Narrow the visible records with a name search, a value search, on/off
  chips, and an advanced section that starts collapsed.
status: discoverable
sources: []
examples:
  - src/stories/design-system/chips.stories.tsx
  - src/stories/design-system/disclosure.stories.tsx
---

# Filter records

## When to use

Use this pattern when all of these hold:

- A list of records is on screen.
- The person needs to narrow that list by name, by value text, or by a few known kinds.
- Any active filter can be cleared with one reset action.

## When not to use

- The list is already empty because nothing was recorded. Explain that with [EmptyState](../components/empty-state.md). Do not offer Reset as if a filter were active.
- The person is inspecting one selected record. That is [inspect a record](./inspect-record.md).

## Structure

Regions, in the filter bar, in order:

1. Name search, a [SearchField](../components/field.md).
2. Value search, a second `SearchField`.
3. Quick chips, each a [Button](../components/button.md) with `variant="ghost"` and `pressed`.
4. Advanced, a [Disclosure](../components/disclosure.md) labelled "Advanced filters", collapsed by default. The calculator inside it is product UI.
5. Reset, a Button without `pressed`, shown when any filter is active.

```tsx
<>
  <SearchField value={nameQuery} label="Name" placeholder="Name" shortcut="" />
  <SearchField
    value={valueQuery}
    label="Value"
    placeholder="Value"
    shortcut=""
  />
  <Button
    variant="ghost"
    label="Errors"
    pressed={errorsOn}
    onClick={toggleErrors}
  />
  <Disclosure label="Advanced filters">{calculator}</Disclosure>
  <Button label="Reset filters" onClick={reset} />
</>
```

## Composition

### Required

- Chips use `variant="ghost"` and `pressed`. Counts may sit beside the chip. They are not a second copy of the status-bar total.
- Advanced starts collapsed. Parse errors of the calculator show in that section before the person applies them. The calculator language stays with the product.
- Reset appears only when a filter is active, and it clears every active filter including advanced.
- The filter logic stays in the product model. These components only collect the choice.

### Recommendations

- Put the row in the filter region of [debugger workspace](../layouts/debugger-workspace.md).

### Exceptions

SearchField still draws its own shortcut glyph. That is [a recorded gap](../gaps.md#searchfield-draws-its-own-shortcut-instead-of-kbd). Pass `shortcut=""` when this row should not show a chord.

## Verification

A valid composition uses a ghost chip that reports `aria-pressed`, proved by "Ghost chip toggles with click and Enter", and an advanced section that starts closed, proved by "Disclosure opens and closes from the keyboard".

A violation is a chip that uses `variant="secondary"` with `pressed`, or an advanced section that starts open. The secondary chip also hits the [pressed-hover gap](../gaps.md#non-ghost-pressed-buttons-lose-their-pressed-fill-on-hover).

The product filter language and the live row list are out of this kit check.
