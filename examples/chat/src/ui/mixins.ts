import type { AtomLike } from '@reatom/core'

export type Reactive<T> = T | AtomLike<T> | (() => T)

export const read = <T>(value: Reactive<T>): T =>
  typeof value === 'function' ? (value as () => T)() : value

let idCounter = 0
export const uniqueId = (prefix: string) => `${prefix}-${++idCounter}`

export const visuallyHidden = `
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0 0 0 0) !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
  border: 0 !important;
`

export const focusRing = `
  outline: var(--focus-width) solid var(--focus);
  outline-offset: var(--focus-offset);
`

export const resetButton = `
  appearance: none;
  margin: 0;
  border: 0;
  padding: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: inherit;
  -webkit-tap-highlight-color: transparent;
`

export const transition = (properties: string) => `
  transition-property: ${properties};
  transition-duration: var(--duration-fast);
  transition-timing-function: var(--ease-standard);
`

export const toneVars = `
  --tone-fg: var(--neutral-text);
  --tone-soft: var(--neutral-soft);
  --tone-line: var(--neutral-line);

  &[data-tone='accent'] {
    --tone-fg: var(--accent-text);
    --tone-soft: var(--accent-soft);
    --tone-line: var(--accent-soft-hover);
  }

  &[data-tone='success'] {
    --tone-fg: var(--success);
    --tone-soft: var(--success-soft);
    --tone-line: var(--success-line);
  }

  &[data-tone='warning'] {
    --tone-fg: var(--warning);
    --tone-soft: var(--warning-soft);
    --tone-line: var(--warning-line);
  }

  &[data-tone='danger'] {
    --tone-fg: var(--danger);
    --tone-soft: var(--danger-soft);
    --tone-line: var(--danger-line);
  }
`

/**
 * Keeps the element itself at the 44 px hit target while painting a smaller
 * visual body on `::before`, so compact controls stay touch-safe.
 */
export const compactTarget = (visualHeight: string) => `
  position: relative;
  isolation: isolate;
  min-height: var(--hit);
  min-width: var(--hit);
  background: transparent;
  border: 0;

  &::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset-inline: 0;
    top: 50%;
    height: ${visualHeight};
    transform: translateY(-50%);
    border-radius: var(--visual-radius, var(--radius-pill));
    background: var(--visual-bg, transparent);
    box-shadow: var(--visual-shadow, none);
    border: 1px solid var(--visual-line, transparent);
    ${transition('background-color, border-color, box-shadow')}
  }

  &:focus-visible {
    outline: none;
  }

  &:focus-visible::before {
    ${focusRing}
  }
`
