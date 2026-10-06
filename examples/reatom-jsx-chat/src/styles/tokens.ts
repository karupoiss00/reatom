export type ThemeName = 'light' | 'dark'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export const tones: readonly Tone[] = [
  'neutral',
  'accent',
  'success',
  'warning',
  'danger',
]

const lightPalette = `
  color-scheme: light;
  --bg: #f6f5f2;
  --bg-elevated: #fffdf9;
  --bg-sunken: #efeee9;
  --sidebar: #efeee9;
  --thread: #f7f6f3;
  --surface-hover: #ecebe5;
  --surface-active: #e5e3dc;
  --surface-selected: #f3e3d9;
  --text: #1c1b19;
  --text-muted: #5f5d56;
  --text-faint: #6b6961;
  --text-disabled: #7d7a72;
  --disabled-fill: #e9e7e1;
  --disabled-line: #dedbd2;
  --line: #e4e2da;
  --line-strong: #d4d1c7;
  --line-input: #cbc8bd;
  --control-off: #878479;
  --accent: #b5532c;
  --accent-hover: #a04724;
  --accent-pressed: #8e3e1f;
  --accent-text: #9a4520;
  --accent-soft: #f3e3d9;
  --accent-soft-hover: #eed7c9;
  --accent-ink: #fffaf6;
  --focus: #b5532c;
  --neutral-soft: #ecebe5;
  --neutral-text: #3f3d38;
  --neutral-line: #dcd9d0;
  --success: #2f6b45;
  --success-soft: #e4efe6;
  --success-line: #c4dccb;
  --warning: #7f5300;
  --warning-soft: #f7ebd0;
  --warning-line: #ead5a3;
  --danger: #b0213a;
  --danger-soft: #fbe1e4;
  --danger-line: #f0bcc3;
  --danger-fill: #b22238;
  --danger-fill-hover: #981d31;
  --danger-fill-pressed: #84192a;
  --danger-ink: #ffffff;
  --inverse-bg: #23221f;
  --inverse-text: #f6f5f2;
  --inverse-muted: #c9c6bd;
  --inverse-accent: #f2a27f;
  --inverse-line: #3a3935;
  --inverse-success: #8fcb9f;
  --inverse-warning: #e6bf6e;
  --inverse-danger: #f58f9f;
  --skeleton-base: #ebe9e3;
  --skeleton-shine: #f6f5f1;
  --backdrop: rgba(44, 31, 20, 0.36);
  --edge-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.7);
  --shadow-1: 0 1px 2px rgba(40, 36, 28, 0.06), 0 0 0 1px rgba(40, 36, 28, 0.02);
  --shadow-2: 0 2px 6px rgba(40, 36, 28, 0.06), 0 8px 24px rgba(40, 36, 28, 0.06);
  --shadow-3: 0 6px 16px rgba(40, 36, 28, 0.08), 0 20px 48px rgba(40, 36, 28, 0.1);
  --shadow-4: 0 12px 28px rgba(40, 36, 28, 0.1), 0 32px 80px rgba(40, 36, 28, 0.16);
  --shadow: 0 16px 40px rgba(40, 36, 28, 0.06);
`

const darkPalette = `
  color-scheme: dark;
  --bg: #141413;
  --bg-elevated: #1f1e1c;
  --bg-sunken: #10100f;
  --sidebar: #10100f;
  --thread: #181816;
  --surface-hover: #262522;
  --surface-active: #2e2d29;
  --surface-selected: #3a2519;
  --text: #f3f1ea;
  --text-muted: #b0ada4;
  --text-faint: #9a968c;
  --text-disabled: #8d8a82;
  --disabled-fill: #2a2926;
  --disabled-line: #34332f;
  --line: #2e2d29;
  --line-strong: #3d3b36;
  --line-input: #4a4843;
  --control-off: #76736b;
  --accent: #e39472;
  --accent-hover: #eaa283;
  --accent-pressed: #f0b396;
  --accent-text: #eba182;
  --accent-soft: #3a2519;
  --accent-soft-hover: #452c1e;
  --accent-ink: #2a160f;
  --focus: #e39472;
  --neutral-soft: #262522;
  --neutral-text: #d9d6ce;
  --neutral-line: #3d3b36;
  --success: #8fcb9f;
  --success-soft: #1a2a1f;
  --success-line: #2c4434;
  --warning: #e6bf6e;
  --warning-soft: #35260f;
  --warning-line: #574016;
  --danger: #f58f9f;
  --danger-soft: #351820;
  --danger-line: #5a2a35;
  --danger-fill: #ec7d8d;
  --danger-fill-hover: #f294a2;
  --danger-fill-pressed: #f7a9b4;
  --danger-ink: #2a0f0d;
  --inverse-bg: #2c2b28;
  --inverse-text: #f3f1ea;
  --inverse-muted: #c2beb5;
  --inverse-accent: #eba182;
  --inverse-line: #3f3d39;
  --inverse-success: #8fcb9f;
  --inverse-warning: #e6bf6e;
  --inverse-danger: #f58f9f;
  --skeleton-base: #22211f;
  --skeleton-shine: #2c2b28;
  --backdrop: rgba(0, 0, 0, 0.56);
  --edge-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.02);
  --shadow-2: 0 2px 8px rgba(0, 0, 0, 0.32), 0 8px 24px rgba(0, 0, 0, 0.24);
  --shadow-3: 0 8px 20px rgba(0, 0, 0, 0.36), 0 24px 56px rgba(0, 0, 0, 0.32);
  --shadow-4: 0 16px 36px rgba(0, 0, 0, 0.44), 0 40px 96px rgba(0, 0, 0, 0.4);
  --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
`

const scale = `
  --sidebar-width: 17.5rem;
  --content-width: 46rem;
  --hit: 2.75rem;
  --control-height: 2.75rem;
  --control-height-compact: 2rem;

  --space-0-5: 0.125rem;
  --space-1: 0.25rem;
  --space-1-5: 0.375rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;

  --radius-xs: 6px;
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 22px;
  --radius-xl: 28px;
  --radius-pill: 999px;

  --text-2xs: 0.6875rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 0.9375rem;
  --text-md: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.75rem;
  --text-2xl: 2.25rem;
  --text-3xl: 3rem;
  --leading-none: 1;
  --leading-tight: 1.2;
  --leading-snug: 1.35;
  --leading-body: 1.55;
  --leading-relaxed: 1.7;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --tracking-display: -0.025em;
  --tracking-tight: -0.01em;
  --tracking-caps: 0.12em;
  --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --font-ui: "Avenir Next", "Segoe UI", system-ui, sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;

  --duration-instant: 80ms;
  --duration-fast: 140ms;
  --duration-base: 220ms;
  --duration-slow: 360ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0, 0, 0, 1);
  --ease-exit: cubic-bezier(0.3, 0, 1, 1);
  --ease-emphasized: cubic-bezier(0.3, 1.25, 0.5, 1);

  --focus-width: 2px;
  --focus-offset: 2px;
  --focus-ring: 0 0 0 var(--focus-offset) var(--bg), 0 0 0 calc(var(--focus-offset) + var(--focus-width)) var(--focus);

  --z-sticky: 10;
  --z-drawer: 40;
  --z-toast: 70;
`

export const globalStyles = `
  :root {
    ${scale}
    ${lightPalette}
  }

  :root[data-theme='dark'] {
    ${darkPalette}
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme]) {
      ${darkPalette}
    }
  }

  @keyframes ui-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes ui-shimmer {
    from {
      background-position: 150% 0;
    }
    to {
      background-position: -50% 0;
    }
  }

  @keyframes ui-rise {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
  }

  @keyframes ui-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes ui-pop {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  html {
    scroll-behavior: auto;
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }

  html,
  body {
    margin: 0;
    height: 100%;
    background: var(--bg);
    color: var(--text);
  }

  body {
    font-family: var(--font-ui);
    font-size: var(--text-md);
    line-height: var(--leading-body);
    font-kerning: normal;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
  }

  ::placeholder {
    color: var(--text-faint);
    opacity: 1;
  }

  ::selection {
    background: var(--accent-soft-hover);
    color: var(--text);
  }

  :focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }

  @media (prefers-reduced-motion: reduce) {
    :root {
      --duration-instant: 0ms;
      --duration-fast: 0ms;
      --duration-base: 0ms;
      --duration-slow: 0ms;
    }

    html,
    *,
    *::before,
    *::after {
      animation-name: none !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`

export const colorTokenGroups: ReadonlyArray<{
  title: string
  tokens: readonly string[]
}> = [
  {
    title: 'Surfaces',
    tokens: ['bg', 'bg-elevated', 'bg-sunken', 'surface-hover', 'surface-active', 'surface-selected'],
  },
  {
    title: 'Ink',
    tokens: ['text', 'text-muted', 'text-faint', 'text-disabled', 'line', 'line-strong'],
  },
  {
    title: 'Accent',
    tokens: ['accent', 'accent-hover', 'accent-text', 'accent-soft', 'accent-ink', 'focus'],
  },
  {
    title: 'Tones',
    tokens: ['success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft'],
  },
]
