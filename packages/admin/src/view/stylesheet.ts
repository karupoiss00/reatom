import { context } from '@reatom/core'
import { stylesheet } from '@reatom/jsx'

import { ADMIN_FRAME, onAdminReset } from '../root'

interface AdminSheetBinding {
  sheet: CSSStyleSheet
  previous: CSSStyleSheet
  rebind: () => void
  restore: () => void
}

const bindings = new Map<object, AdminSheetBinding>()

onAdminReset(() => {
  bindings.get(ADMIN_FRAME)?.rebind()
})

function copyRules(from: CSSStyleSheet, to: CSSStyleSheet) {
  if (from === to) return
  let incoming: CSSRule[]
  try {
    incoming = [...from.cssRules]
  } catch {
    return
  }
  const existing = new Set([...to.cssRules].map((rule) => rule.cssText))
  for (const rule of incoming) {
    if (existing.has(rule.cssText)) continue
    try {
      to.insertRule(rule.cssText, to.cssRules.length)
    } catch {
      continue
    }
  }
}

/**
 * Points JSX `css` rules at a constructed sheet adopted by `shadow`.
 *
 * One binding per frame. The sheet stays on `ADMIN_FRAME`. `resetAdminFrame`
 * drops the atom state that `stylesheet.set` wrote, then rebinds this sheet.
 * `restore` returns the sheet that was active before the frame's first bind.
 */
export function bindAdminStylesheet(shadow: ShadowRoot): {
  rebind: () => void
  restore: () => void
} {
  const frame = context()
  const replaced = bindings.get(frame)
  const sheet = new CSSStyleSheet()
  const previous = ADMIN_FRAME.run(() => {
    const current = stylesheet()
    const restoreTarget = replaced ? replaced.previous : current
    copyRules(current, sheet)
    shadow.adoptedStyleSheets = [sheet]
    stylesheet.set(sheet)
    return restoreTarget
  })

  const rebind = () => {
    ADMIN_FRAME.run(() => {
      const current = stylesheet()
      if (current !== sheet) copyRules(current, sheet)
      stylesheet.set(sheet)
      if (shadow.adoptedStyleSheets[0] !== sheet) {
        shadow.adoptedStyleSheets = [sheet]
      }
    })
  }

  const binding: AdminSheetBinding = {
    sheet,
    previous,
    rebind,
    restore: () => {
      if (bindings.get(frame) !== binding) return
      bindings.delete(frame)
      ADMIN_FRAME.run(() => {
        if (stylesheet() === sheet) stylesheet.set(previous)
      })
    },
  }
  bindings.set(frame, binding)

  return { rebind, restore: binding.restore }
}
