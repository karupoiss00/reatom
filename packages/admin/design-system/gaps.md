# Admin design-system open gaps

Keep unresolved system gaps here. Move closed entries in full to `design-system/gaps-archive.md` with their disposition, closure date, and basis. Resolution requires demonstrating the original Expected result.

## Open gaps

### SearchField draws its own shortcut instead of Kbd

- **Source:** `src/view/design-system/Field.tsx`
- **Need:** Shortcut chords look and read the same in the search field, tooltips, and help.
- **Actual result:** SearchField renders its own `<kbd>` from the `shortcut` string. Kbd is the shared chord component everywhere else.
- **Expected result:** SearchField shows its shortcut by composing Kbd, so there is one chord treatment.
- **Evidence:** Field and Kbd contracts. The default shortcut string is `⌘K`.
- **Next step:** A design-only change in SearchField to render Kbd. Contracts-only migration does not change Field.
- **Decision needed:** none

### SplitPane keyboard range ignores the pane minimums

- **Source:** `src/view/design-system/SplitPane.tsx`
- **Need:** Dragging and arrow keys change the same split, within the minimum pane sizes the caller passed.
- **Actual result:** Pointer movement clamps to `minLeft` and `minRight`. Arrow keys and `aria-valuemin` / `aria-valuemax` are fixed at 20 and 80 percent and ignore those props.
- **Expected result:** Keyboard adjustment and the separator's value range follow `minLeft` and `minRight` for the current shell width.
- **Evidence:** SplitPane contract, Behaviour and states. Debugger workspace passes 280px and 240px minimums; arrow keys can still move the ratio to 0.2 or 0.8.
- **Next step:** A design-only repair so the keyboard step and the ARIA range use the same clamp as the pointer.
- **Decision needed:** none

### Chat overlays close on Escape inside the admin

- **Source:** `examples/chat/src/ui/Popover.tsx`, `examples/chat/src/features/picker/model.ts`, `examples/chat/src/chat/compare.ts`
- **Need:** Escape inside the admin closes only the top admin layer. Chat's own overlays stay as they were.
- **Actual result:** Those three listeners are registered on `window` in the capture phase and do not look at `defaultPrevented`. The admin guard calls `preventDefault` first, which stops chat's keymap from aborting a stream, but an open chat popover still closes, the model picker still closes, and an armed compare still treats Enter in the composer as its own shortcut.
- **Expected result:** Host listeners that are not the stream keymap ignore Escape and Enter once the admin has already claimed the event.
- **Evidence:** The listeners do not read `event.defaultPrevented`. The admin does not patch `examples/chat`.
- **Next step:** Teach those chat listeners to return when `defaultPrevented` is set, in a change to the example rather than the admin.
- **Decision needed:** none
