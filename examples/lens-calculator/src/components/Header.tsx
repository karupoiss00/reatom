import { designation, estimate } from '../model'
import { label, mono } from '../styles'
import { changeLang, LANG_PREF, LANG_PREFS, t } from '../translations'

const Wordmark = () => (
  <div
    css={`
      display: flex;
      align-items: baseline;
      gap: 0.85rem;
    `}
  >
    <span
      css={`
        font-family: var(--font-ui);
        font-size: 1.5rem;
        font-weight: 600;
        letter-spacing: 0.32em;
        text-transform: uppercase;
        color: var(--ink);
      `}
    >
      {t.header.wordmark}
    </span>
    <span
      css={`
        ${label}
        font-size: 0.625rem;
        color: var(--ink-faint);
      `}
    >
      {t.header.tagline}
    </span>
  </div>
)

const Designation = () => (
  <div
    css={`
      display: flex;
      flex-wrap: nowrap;
      align-items: baseline;
      gap: 0.4rem 1.25rem;
      min-width: 0;
    `}
  >
    <span
      css={`
        ${mono}
        font-size: 1.25rem;
        font-weight: 300;
        color: var(--accent);
      `}
    >
      {designation}
    </span>
    <span
      css={`
        ${label}
        font-size: 0.625rem;
      `}
    >
      {() => `${t.format[estimate().spec.format]} · ${estimate().mount.label}`}
    </span>
    <span
      css={`
        ${label}
        font-size: 0.625rem;
        color: var(--ink-faint);
      `}
    >
      {t.header.estimateHint}
    </span>
  </div>
)

const LangSwitch = () => (
  <span
    css={`
      position: relative;
      display: grid;
      flex: none;
    `}
  >
      <select
        aria-label={t.lang.label}
        autocomplete="off"
        ref={(node) => {
          if (!(node instanceof HTMLSelectElement)) return
          const select = node
          const apply = () => {
            if (select.value !== LANG_PREF) select.value = LANG_PREF
          }
          apply()
          addEventListener('pageshow', apply)
          return () => removeEventListener('pageshow', apply)
        }}
        on:change={(event) => {
          if (!event.isTrusted) return
          changeLang(event.currentTarget.value)
        }}
        css={`
          appearance: none;
          width: 100%;
          margin: 0;
          padding: 0.15rem 1.35rem 0.15rem 0.55rem;
          line-height: 1.2;
          border: 1px solid var(--hairline);
          border-radius: 1px;
          background: var(--paper-deep);
          color: var(--ink);
          font-family: var(--font-ui);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          cursor: pointer;

          &:focus-visible {
            outline: 1px solid var(--accent);
            outline-offset: 1px;
          }
        `}
      >
        {LANG_PREFS.map((pref) => (
          <option value={pref} selected={pref === LANG_PREF}>
            {t.lang[pref]}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        css={`
          position: absolute;
          top: 50%;
          right: 0.55rem;
          width: 0.32rem;
          height: 0.32rem;
          border-right: 1px solid var(--ink-dim);
          border-bottom: 1px solid var(--ink-dim);
          transform: translateY(-70%) rotate(45deg);
          pointer-events: none;
        `}
      />
  </span>
)

export const Header = () => (
  <header
    css={`
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem 1.5rem;
      min-width: 0;
      animation: prime-rise 500ms ease-out backwards;
    `}
  >
    <Wordmark />
    <Designation />
    <LangSwitch />
  </header>
)
