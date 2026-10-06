import { type ThemePref, themePref } from '../../../storage/prefs'
import { Icon, type IconName, uniqueId } from '../../../ui'
import { resolvedTheme, selectTheme } from '../../layout/theme'

type PreviewPalette = {
  bg: string
  sidebar: string
  surface: string
  line: string
  ink: string
  faint: string
  accent: string
}

const previewPalettes: Record<'light' | 'dark', PreviewPalette> = {
  light: {
    bg: '#f7f6f3',
    sidebar: '#efeee9',
    surface: '#fffdf9',
    line: '#e4e2da',
    ink: '#1c1b19',
    faint: '#d4d1c7',
    accent: '#b5532c',
  },
  dark: {
    bg: '#181816',
    sidebar: '#10100f',
    surface: '#1f1e1c',
    line: '#2e2d29',
    ink: '#f3f1ea',
    faint: '#3d3b36',
    accent: '#e39472',
  },
}

const themeOptions: ReadonlyArray<{ id: ThemePref; label: string; icon: IconName }> = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'monitor' },
]

const paletteVars = (palette: PreviewPalette) =>
  [
    `--preview-bg: ${palette.bg}`,
    `--preview-sidebar: ${palette.sidebar}`,
    `--preview-surface: ${palette.surface}`,
    `--preview-line: ${palette.line}`,
    `--preview-ink: ${palette.ink}`,
    `--preview-faint: ${palette.faint}`,
    `--preview-accent: ${palette.accent}`,
  ].join('; ')

const MiniWindow = ({ palette, half }: { palette: PreviewPalette; half?: 'start' | 'end' }) => (
  <span
    aria-hidden="true"
    data-half={half ?? 'none'}
    style={paletteVars(palette)}
    css={`
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: 28% 1fr;
      background: var(--preview-bg);

      &[data-half='end'] {
        clip-path: polygon(62% 0, 100% 0, 100% 100%, 38% 100%);
      }

      & [data-preview-sidebar] {
        display: grid;
        align-content: start;
        gap: 5px;
        padding: 10px 7px;
        background: var(--preview-sidebar);
        border-right: 1px solid var(--preview-line);
      }

      & [data-preview-line] {
        height: 4px;
        border-radius: 999px;
        background: var(--preview-faint);
      }

      & [data-preview-main] {
        display: grid;
        align-content: end;
        gap: 6px;
        padding: 10px;
      }

      & [data-preview-bubble] {
        justify-self: end;
        width: 55%;
        height: 9px;
        border-radius: 5px;
        background: var(--preview-faint);
      }

      & [data-preview-composer] {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        height: 16px;
        padding: 0 3px;
        border: 1px solid var(--preview-line);
        border-radius: 7px;
        background: var(--preview-surface);
      }

      & [data-preview-send] {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: var(--preview-accent);
      }
    `}
  >
    <span data-preview-sidebar="">
      <span data-preview-line="" style="width: 80%; background: var(--preview-ink); opacity: 0.7" />
      <span data-preview-line="" />
      <span data-preview-line="" style="width: 70%" />
    </span>
    <span data-preview-main="">
      <span data-preview-bubble="" />
      <span data-preview-line="" style="width: 85%" />
      <span data-preview-line="" style="width: 60%" />
      <span data-preview-composer="">
        <span data-preview-send="" />
      </span>
    </span>
  </span>
)

const Preview = ({ option }: { option: ThemePref }) => (
  <span
    css={`
      position: relative;
      display: block;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
    `}
  >
    {option === 'system' ? (
      <span css="display: contents;">
        <MiniWindow palette={previewPalettes.light} half="start" />
        <MiniWindow palette={previewPalettes.dark} half="end" />
      </span>
    ) : (
      <MiniWindow palette={previewPalettes[option]} />
    )}
  </span>
)

export const AppearanceSection = () => {
  const groupLabelId = uniqueId('appearance-theme')
  const hintId = uniqueId('appearance-theme-hint')

  return (
    <section
      data-slot="AppearanceSection"
      aria-labelledby={groupLabelId}
      css={`
        display: grid;
        gap: var(--space-4);
        min-width: 0;
      `}
    >
      <div css="display: grid; gap: var(--space-1);">
        <h3
          id={groupLabelId}
          css={`
            margin: 0;
            font-size: var(--text-md);
            font-weight: var(--weight-semibold);
            line-height: var(--leading-snug);
          `}
        >
          Theme
        </h3>
        <p
          id={hintId}
          css={`
            margin: 0;
            color: var(--text-muted);
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
          `}
        >
          System matches your device and switches with it.
        </p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={groupLabelId}
        aria-describedby={hintId}
        css={`
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--space-3);
        `}
      >
        {themeOptions.map((option) => (
          <label
            data-theme-option={option.id}
            css={`
              position: relative;
              display: grid;
              gap: var(--space-2);
              min-width: 0;
              padding: var(--space-2);
              border: 1px solid var(--line);
              border-radius: var(--radius-md);
              background: var(--bg-elevated);
              cursor: pointer;
              transition:
                border-color var(--duration-fast) var(--ease-standard),
                box-shadow var(--duration-fast) var(--ease-standard),
                background-color var(--duration-fast) var(--ease-standard);

              &:hover {
                border-color: var(--line-strong);
              }

              &:has(input:checked) {
                border-color: var(--accent);
                box-shadow: 0 0 0 1px var(--accent);
              }

              &:has(input:focus-visible) {
                box-shadow: var(--focus-ring);
              }

              & input {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                margin: 0;
                opacity: 0;
                cursor: pointer;
              }

              & [data-theme-option-row] {
                display: flex;
                align-items: center;
                gap: var(--space-1-5);
                min-height: 1.5rem;
                padding: 0 var(--space-1);
                color: var(--text);
                font-size: var(--text-sm);
                font-weight: var(--weight-medium);
              }

              & [data-theme-option-check] {
                margin-inline-start: auto;
                color: var(--accent-text);
                opacity: 0;
                transition: opacity var(--duration-fast) var(--ease-standard);
              }

              &:has(input:checked) [data-theme-option-check] {
                opacity: 1;
              }

              & [data-theme-option-note] {
                padding: 0 var(--space-1);
                color: var(--text-muted);
                font-size: var(--text-xs);
                line-height: var(--leading-snug);
                min-height: 1lh;
              }
            `}
          >
            <input
              type="radio"
              name="theme"
              value={option.id}
              prop:checked={() => themePref() === option.id}
              on:change={(event) => {
                if (event.currentTarget.checked) selectTheme(option.id)
              }}
            />
            <Preview option={option.id} />
            <span data-theme-option-row="">
              <Icon name={option.icon} size="1rem" />
              <span data-theme-option-label="">{option.label}</span>
              <span data-theme-option-check="">
                <Icon name="check" size="1rem" />
              </span>
            </span>
            {option.id === 'system' ? (
              <span data-theme-option-note="">
                {() => `Currently ${resolvedTheme()}`}
              </span>
            ) : (
              <span data-theme-option-note="" aria-hidden="true" />
            )}
          </label>
        ))}
      </div>
    </section>
  )
}
