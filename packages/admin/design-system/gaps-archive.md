# Admin design-system archived gaps

Closed entries move here in full from [gaps.md](./gaps.md).

### Non-ghost pressed buttons lose their pressed fill on hover

- **Source:** `src/view/design-system/Button.tsx`
- **Need:** A person can see that a toggle button is on while the pointer is over it.
- **Actual result:** The shared `:hover` background is painted after the pressed background for every variant except `ghost`. `ghost` has a later rule that keeps a pressed fill. `secondary` toggles, including pause and remote, lose the pressed fill on hover.
- **Expected result:** Every variant that sets `pressed` keeps a pressed appearance while hovered, including with `prefers-reduced-motion`.
- **Evidence:** Button contract, Behaviour and states. The chip rule therefore requires `variant="ghost"`.
- **Next step:** A design-only repair of the hover rule so it does not replace a pressed fill. Contracts-only migration does not change this component.
- **Decision needed:** none
- **Status:** Resolved
- **Closed date:** 2026-10-17
- **Resolution:** Pressed variants share a 16% accent fill and 55% accent border. Hover no longer replaces that fill. Danger pressed keeps the error treatment.
- **Verified by:** Button CSS in `src/view/design-system/Button.tsx`; contract Behaviour and states; unit-free visual proof on Design System/Controls and Design System/Chips stories.
