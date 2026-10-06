import { themePref, type ThemePref } from '../../storage/prefs'
import { resetButton, transition } from '../../ui/mixins'
import { selectTheme } from './theme'

const themeChoices: ReadonlyArray<{ id: ThemePref; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

export const ThemeSwitch = () => (
  <div
    role="radiogroup"
    aria-label="Theme"
    data-slot="ThemeSwitch"
    css={`
      display: inline-flex;
      flex: none;
      align-items: center;
      height: var(--control-height-compact);
      padding: 2px;
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      background: var(--bg-elevated);
    `}
  >
    {themeChoices.map((choice) => (
      <label
        attr:data-selected={() => (themePref() === choice.id ? 'true' : 'false')}
        css={`
          ${resetButton}
          ${transition('background-color, color, box-shadow')}
          position: relative;
          display: inline-flex;
          align-items: center;
          height: 100%;
          padding: 0 var(--space-2);
          border-radius: var(--radius-pill);
          color: var(--text-muted);
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          line-height: var(--leading-none);
          white-space: nowrap;
          cursor: pointer;

          &[data-selected='true'] {
            background: var(--accent-soft);
            color: var(--accent-text);
          }

          &:hover:not([data-selected='true']) {
            color: var(--text);
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
        `}
      >
        <input
          type="radio"
          name="header-theme"
          value={choice.id}
          prop:checked={() => themePref() === choice.id}
          on:change={(event) => {
            if (event.currentTarget.checked) selectTheme(choice.id)
          }}
        />
        {choice.label}
      </label>
    ))}
  </div>
)
