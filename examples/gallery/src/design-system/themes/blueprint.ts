import type { ControlThemeOverrides } from '../themeTypes'

export const blueprintControlOverrides = {
  overlay: {
    rest: {
      background: 'color-mix(in srgb, var(--card-bg) 72%, transparent)',
    },
    hover: {
      background: 'color-mix(in srgb, var(--card-bg) 90%, transparent)',
      border: 'var(--border-strong)',
    },
    press: {
      background: 'var(--card-bg)',
      border: 'var(--border-strong)',
    },
  },
} satisfies ControlThemeOverrides
