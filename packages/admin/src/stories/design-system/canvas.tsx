import { mount } from '@reatom/jsx'

import { ADMIN_FRAME } from '../../root'
import {
  adminThemeVars,
  paletteVarBlock,
  paletteVars,
  DEFAULT_ACCENT,
  tokens,
  type AdminResolvedScheme,
} from '../../view/design-system'

export function renderDesignCanvas(
  child: Element,
  size: { width: number; height: number } = { width: 560, height: 760 },
  scheme: AdminResolvedScheme = 'dark',
): HTMLDivElement {
  const root = document.createElement('div')
  root.dataset.testid = 'design-system-canvas'
  root.style.width = `${size.width}px`
  root.style.height = `${size.height}px`
  root.style.maxWidth = '100%'
  root.style.boxSizing = 'border-box'

  const host = document.createElement('div')
  host.style.width = '100%'
  host.style.height = '100%'
  root.append(host)

  ADMIN_FRAME.run(() => {
    mount(
      host,
      <div
        css={`
          ${adminThemeVars}
          ${paletteVarBlock(paletteVars(DEFAULT_ACCENT, scheme))}
          color-scheme: ${scheme};
          width: 100%;
          height: 100%;
          overflow: auto;
          background: ${tokens.canvas};
          color: ${tokens.text1};
          font-family: ${tokens.fontUi};
        `}
      >
        {child}
      </div>,
    )
  })

  return root
}
