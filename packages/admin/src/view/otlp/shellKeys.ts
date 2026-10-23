import type { Atom } from '@reatom/core'

import type { OtlpAdmin } from '../../otlp'
import { adminSettings } from '../settings'

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]'

export function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null
}

function browserOwnsKey(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    event.key === 'Process' ||
    event.key === 'Meta' ||
    event.key === 'Control' ||
    event.ctrlKey ||
    event.metaKey
  )
}

function selectedTextInside(root: HTMLElement): boolean {
  // Browsers expose shadow selections differently. Prefer the tree's own
  // selection when available and keep native methods bound to their receiver.
  const tree = root.getRootNode?.() as
    (Node & { host?: Element; getSelection?(): Selection | null }) | undefined
  const selection =
    tree?.getSelection?.() ?? root.ownerDocument?.defaultView?.getSelection?.()
  if (!selection || selection.isCollapsed) return false
  if (selection.toString().length === 0) return false
  const inside = (node: Node | null) => node !== null && root.contains(node)
  if (inside(selection.anchorNode) || inside(selection.focusNode)) return true
  // A document selection can retarget its endpoints to the shadow host. Ask
  // for the composed endpoints inside this tree before treating it as external.
  const composed = selection as Selection & {
    getComposedRanges?(options: {
      shadowRoots: ShadowRoot[]
    }): readonly Pick<StaticRange, 'startContainer' | 'endContainer'>[]
  }
  return !!(
    tree?.host &&
    composed
      .getComposedRanges?.({ shadowRoots: [tree as ShadowRoot] })
      .some(
        (range) => inside(range.startContainer) || inside(range.endContainer),
      )
  )
}

function claim(event: KeyboardEvent): void {
  event.preventDefault()
}

/**
 * Keyboard shortcuts for the admin shell.
 *
 * The handler returns before matching when the event belongs to text editing:
 * an IME composition, a Ctrl/Cmd chord, an editable field, or a character key
 * while text inside the shell is selected. Bindings only run for the remaining
 * events, so a letter shortcut cannot cancel copy.
 */
export function handleAdminShellKey(
  shell: HTMLElement,
  event: KeyboardEvent,
  admin: OtlpAdmin,
  helpOpen: Atom<boolean>,
): void {
  if (browserOwnsKey(event)) return
  if (isEditableTarget(event.target)) return
  if (event.key === 'Escape') return
  if (
    event.target instanceof Element &&
    event.target.closest('[role="tablist"]')
  ) {
    return
  }
  if (event.key.length === 1 && selectedTextInside(shell)) return

  if (event.altKey) {
    if (event.key === 'ArrowLeft') {
      claim(event)
      admin.selectionBack()
    } else if (event.key === 'ArrowRight') {
      claim(event)
      admin.selectionForward()
    }
    return
  }

  if (event.key === '?') {
    claim(event)
    helpOpen.set(true)
    return
  }
  if (event.key === '/') {
    claim(event)
    shell.querySelector<HTMLElement>('[data-testid="filter-name"]')?.focus()
    return
  }
  if (event.key === 'i' || event.key === 'I') {
    claim(event)
    adminSettings().icons.toggle()
    return
  }
  if (event.key === 'c' || event.key === 'C') {
    claim(event)
    adminSettings().colors.toggle()
    return
  }
  if (
    event.target instanceof Element &&
    event.target.closest('[role="separator"]')
  )
    return
  if (event.shiftKey && event.key.startsWith('Arrow')) return

  const pathsUnit =
    admin.view() === 'timeline' && admin.timelineUnit() === 'paths'
  const paths = admin.analytics.paths
  const causal =
    admin.view() === 'timeline' && !pathsUnit && admin.causalEnabled()
  if (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J') {
    claim(event)
    if (pathsUnit) paths.moveSelection(1)
    else if (causal) admin.causal.move(1)
    else admin.ganttSelection.move(1)
    return
  }
  if (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K') {
    claim(event)
    if (pathsUnit) paths.moveSelection(-1)
    else if (causal) admin.causal.move(-1)
    else admin.ganttSelection.move(-1)
    return
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    if (pathsUnit) {
      const selected = paths.selected()
      if (!selected) return
      claim(event)
      if (event.key === 'ArrowRight') paths.expand(selected)
      else paths.collapse(selected)
      return
    }
    if (causal) return
    const selected = admin.gantt.selected()
    if (!selected) return
    claim(event)
    if (event.key === 'ArrowRight') admin.gantt.expand(selected)
    else admin.gantt.collapse(selected)
    return
  }
  if (event.key !== 'Enter') return
  if (
    event.target instanceof Element &&
    event.target.closest('button, a, [role="tab"]')
  ) {
    return
  }
  claim(event)
  if (pathsUnit) {
    if (paths.selected() === null) paths.moveSelection(1)
    if (paths.selected() !== null) admin.cardOpen.setTrue()
    return
  }
  if (admin.selectedRecord() === null) {
    if (causal) admin.causal.move(1)
    else admin.ganttSelection.move(1)
  }
  if (admin.selectedRecord() !== null) admin.cardOpen.setTrue()
}
