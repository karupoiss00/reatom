import {
  hairline,
  radius,
  scrollable as dsScrollable,
  soft,
  tokens,
  type,
} from './design-system'

export const colors = {
  bg: tokens.canvas,
  bgElevated: tokens.surface1,
  surface: tokens.surface2,
  surfaceRaised: tokens.surface3,
  surfaceInteractive: tokens.surface3,
  text: tokens.text1,
  textMuted: tokens.text2,
  textSubtle: tokens.text3,
  accent: tokens.accent,
  accentSoft: soft(tokens.accent, 16),
  error: tokens.error,
  errorSoft: soft(tokens.error, 16),
  success: tokens.success,
  successSoft: soft(tokens.success, 16),
  warning: tokens.warning,
  warningSoft: soft(tokens.warning, 16),
  border: tokens.border1,
  borderStrong: tokens.border2,
  highlight: soft(tokens.accent, 14),
  shadow: 'transparent',
}

export const space = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const
export type Size = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export const p = (n: Size) => `padding: ${space[n]}rem;`
export const px = (n: Size) => `padding-inline: ${space[n]}rem;`
export const py = (n: Size) => `padding-block: ${space[n]}rem;`
export const m = (n: Size) => `margin: ${space[n]}rem;`
export const mx = (n: Size) => `margin-inline: ${space[n]}rem;`
export const my = (n: Size) => `margin-block: ${space[n]}rem;`

export const bg = (color: string) => `background: ${color};`
export const text = (color: string) => `color: ${color};`
export const rounded = `border-radius: ${radius[4]};`
export const roundedSm = `border-radius: ${radius[2]};`
export const roundedLg = `border-radius: ${radius[6]};`

export const flex = 'display: flex;'
export const flexCol = 'flex-direction: column;'
export const flexCenter = 'justify-content: center; align-items: center;'
export const flexWrap = 'flex-wrap: wrap;'
export const gap = (n: Size) => `gap: ${space[n]}rem;`

export const border = `border: ${hairline};`
export const borderStrong = `border: 1px solid ${colors.borderStrong};`
export const card = `${bg(colors.surface)} ${rounded} ${border};`
export const cardRaised = `${bg(colors.surfaceRaised)} ${rounded} ${borderStrong};`
export const scrollable = dsScrollable
export const truncate =
  'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'
export const mono = type.data
export const focusRing = `outline: 2px solid ${colors.accent}; outline-offset: 2px;`
export const focusVisible = `
  &:focus {
    outline: none;
  }
  &:focus-visible {
    ${focusRing}
  }
`
export const softShadow = 'box-shadow: none;'

export const toolbar = `
  ${bg(colors.bgElevated)}
  border-bottom: ${hairline};
  ${px(2)}
  ${py(1)}
`

export const statChip = `
  display: inline-flex;
  align-items: baseline;
  ${gap(1)}
  ${px(1)}
  ${py(1)}
  ${roundedSm}
  border: 1px solid ${colors.border};
  background: ${colors.bg};
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
`

export const inputLike = `
  ${rounded}
  ${border}
  background: ${colors.bgElevated};
  color: ${colors.text};
  box-sizing: border-box;
  min-height: 28px;
  ${focusVisible}
`

export const buttonBase = `
  ${rounded}
  ${border}
  ${px(2)}
  ${py(1)}
  background: ${colors.surfaceInteractive};
  color: ${colors.text};
  cursor: pointer;
  ${focusVisible}
`

export const buttonGhost = `
  ${rounded}
  ${border}
  ${px(2)}
  ${py(1)}
  background: transparent;
  color: ${colors.textMuted};
  cursor: pointer;
  ${focusVisible}
`

export const buttonDanger = `
  ${rounded}
  ${border}
  ${px(2)}
  ${py(1)}
  background: transparent;
  border-color: ${colors.error};
  color: ${colors.error};
  cursor: pointer;
  ${focusVisible}
`

export const badge = `
  display: inline-flex;
  align-items: center;
  ${gap(1)}
  ${px(1)}
  ${py(1)}
  ${roundedSm}
  font-size: 11px;
  line-height: 1;
  border: 1px solid ${colors.borderStrong};
  cursor: default;
  pointer-events: none;
`

export const sectionTitle = `
  margin: 0;
  ${type.ui}
  color: ${colors.text};
`

export const panelTitle = `
  margin: 0;
  ${type.title}
  color: ${colors.text};
`

export const adminShellContainer = `
  container-type: inline-size;
  container-name: admin-shell;
`

export const compactPanelPadding = `
  @container admin-shell (max-width: 480px) {
    padding: 0.5rem;
  }
`

export const hideInCompactShell = `
  @container admin-shell (max-width: 480px) {
    display: none;
  }
`

export const compactOnlyShell = `
  display: none;

  @container admin-shell (max-width: 480px) {
    display: inline-flex;
  }
`

export const screenRoot = `
  height: 100%;
  min-height: 0;
  ${scrollable}
`

export const shellCompactMax = '480px'
export const shellMediumMax = '680px'
export const shellWideMax = '880px'
