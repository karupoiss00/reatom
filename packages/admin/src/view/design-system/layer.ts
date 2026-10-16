/** Element that currently has focus, including inside a shadow root. */
export function activeElementOf(node: Node): Element | null {
  const root = node.getRootNode()
  if (root instanceof ShadowRoot) return root.activeElement
  return node.ownerDocument?.activeElement ?? null
}

/** True when the event target is a text field the shell must not steal from. */
export function isEditableField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

/** Tab stops inside a layer. Excludes `tabindex="-1"`. */
export function focusableIn(container: ParentNode): Array<HTMLElement> {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.tabIndex >= 0)
}
