import { paletteVarBlock, paletteVars, DEFAULT_ACCENT } from './palette'

export {
  ADMIN_SCHEME_IDS,
  DEFAULT_ACCENT,
  isAdminAccent,
  paletteVars,
} from './palette'
export type {
  AdminPaletteVars,
  AdminResolvedScheme,
  AdminScheme,
} from './palette'

export const adminThemeVars = `
  ${paletteVarBlock(paletteVars(DEFAULT_ACCENT, 'dark'))}
  color-scheme: dark;
  --admin-kind-log: var(--admin-text-2);
  --admin-kind-other: var(--admin-text-3);
  --admin-font-ui: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
  --admin-font-data: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas,
    'Liberation Mono', monospace;
  --admin-space-2: 2px;
  --admin-space-4: 4px;
  --admin-space-6: 6px;
  --admin-space-8: 8px;
  --admin-space-12: 12px;
  --admin-space-16: 16px;
  --admin-space-24: 24px;
  --admin-radius-2: 2px;
  --admin-radius-4: 4px;
  --admin-radius-6: 6px;
  --admin-toolbar-height: 36px;
  --admin-tabs-height: 40px;
  --admin-filter-height: 42px;
  --admin-status-height: 22px;
  --admin-control-height: 28px;
  --admin-grid-header-height: 32px;
  --admin-grid-row-height: 32px;
  --admin-grid-row-dense: 26px;
  --admin-icon-size: 14px;
  --admin-icon-size-lg: 16px;
  --admin-focus-width: 2px;
  --admin-splitter-hit: 8px;
  --admin-motion-hover: 80ms;
  --admin-motion-select: 120ms;
  --admin-motion-overlay: 160ms;
`

export const tokens = {
  canvas: 'var(--admin-canvas)',
  surface1: 'var(--admin-surface-1)',
  surface2: 'var(--admin-surface-2)',
  surface3: 'var(--admin-surface-3)',
  text1: 'var(--admin-text-1)',
  text2: 'var(--admin-text-2)',
  text3: 'var(--admin-text-3)',
  border1: 'var(--admin-border-1)',
  border2: 'var(--admin-border-2)',
  accent: 'var(--admin-accent)',
  accentStrong: 'var(--admin-accent-strong)',
  success: 'var(--admin-success)',
  warning: 'var(--admin-warning)',
  error: 'var(--admin-error)',
  info: 'var(--admin-info)',
  fontUi: 'var(--admin-font-ui)',
  fontData: 'var(--admin-font-data)',
} as const

export const kindTokens = {
  action: 'var(--admin-kind-action)',
  atom: 'var(--admin-kind-atom)',
  computed: 'var(--admin-kind-computed)',
  effect: 'var(--admin-kind-effect)',
  log: 'var(--admin-kind-log)',
  other: 'var(--admin-kind-other)',
} as const

export const railTokens = [
  'var(--admin-rail-0)',
  'var(--admin-rail-1)',
  'var(--admin-rail-2)',
  'var(--admin-rail-3)',
  'var(--admin-rail-4)',
  'var(--admin-rail-5)',
] as const

export const space = {
  2: 'var(--admin-space-2)',
  4: 'var(--admin-space-4)',
  6: 'var(--admin-space-6)',
  8: 'var(--admin-space-8)',
  12: 'var(--admin-space-12)',
  16: 'var(--admin-space-16)',
  24: 'var(--admin-space-24)',
} as const

export const radius = {
  2: 'var(--admin-radius-2)',
  4: 'var(--admin-radius-4)',
  6: 'var(--admin-radius-6)',
} as const

export const type = {
  meta: `
    font-family: ${tokens.fontUi};
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
  `,
  data: `
    font-family: ${tokens.fontData};
    font-size: 12px;
    line-height: 18px;
    font-weight: 400;
  `,
  ui: `
    font-family: ${tokens.fontUi};
    font-size: 12px;
    line-height: 16px;
    font-weight: 550;
  `,
  body: `
    font-family: ${tokens.fontUi};
    font-size: 13px;
    line-height: 20px;
    font-weight: 400;
  `,
  title: `
    font-family: ${tokens.fontUi};
    font-size: 15px;
    line-height: 20px;
    font-weight: 650;
  `,
} as const

export const size = {
  toolbar: 'var(--admin-toolbar-height)',
  tabs: 'var(--admin-tabs-height)',
  filter: 'var(--admin-filter-height)',
  status: 'var(--admin-status-height)',
  control: 'var(--admin-control-height)',
  gridHeader: 'var(--admin-grid-header-height)',
  gridRow: 'var(--admin-grid-row-height)',
  gridRowDense: 'var(--admin-grid-row-dense)',
  icon: 'var(--admin-icon-size)',
  iconLg: 'var(--admin-icon-size-lg)',
  splitterHit: 'var(--admin-splitter-hit)',
} as const

export function soft(token: string, amount = 14): string {
  return `color-mix(in oklch, ${token} ${amount}%, transparent)`
}

export const MAX_RAIL_LANES = 5
export const RAIL_LANE_GAP = 18
export const RAIL_LINE_WIDTH = 2
export const RAIL_NODE_OUTER = 10
export const RAIL_NODE_CORE = 4
export const RAIL_CURVE = 8
export const SHELL_FOCUS_MAX = 480
export const SHELL_DOCKED_MAX = 720
