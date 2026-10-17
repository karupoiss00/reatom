import { radius, size, soft, tokens } from './tokens'

export const visuallyHidden = `
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`

export const truncate = `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const scrollable = `
  overflow: auto;
  min-height: 0;
  min-width: 0;
  overscroll-behavior: contain;
  scrollbar-width: thin;
`

export const focusRing = `
  outline: var(--admin-focus-width) solid ${tokens.focus};
  outline-offset: var(--admin-focus-width);
`

export const focusVisible = `
  &:focus {
    outline: none;
  }
  &:focus-visible {
    ${focusRing}
  }
`

export const interactive = `
  cursor: pointer;
  transition:
    background var(--admin-motion-hover) ease,
    border-color var(--admin-motion-hover) ease,
    color var(--admin-motion-hover) ease;
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
  ${focusVisible}
`

export const hairline = `1px solid ${tokens.border1}`

export const selectedRow = `
  background: ${tokens.selection};
  color: ${tokens.text1};
  box-shadow: inset 2px 0 0 ${tokens.accent};
`

export const capturingPulse = `
  animation: admin-capture-pulse var(--admin-motion-pulse) ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

export const pressedFill = `
  background: ${soft(tokens.accent, 16)};
  border-color: ${soft(tokens.accent, 55)};
  color: ${tokens.text1};
`

export const controlType = `
  font-family: ${tokens.fontUi};
  font-size: 12px;
  line-height: 16px;
  font-weight: 550;
`

export const controlBase = `
  box-sizing: border-box;
  appearance: none;
  background: transparent;
  min-height: ${size.control};
  border-radius: ${radius[4]};
  border: ${hairline};
  color: ${tokens.text1};
  ${controlType}
`

export const reducedMotion = `
  @media (prefers-reduced-motion: reduce) {
    transition: none;
    animation: none;
  }
`
