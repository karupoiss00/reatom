import { modEnterChord } from '../../../shortcuts/bindings'
import { sendKey } from '../../../storage/prefs'
import { uniqueId } from '../../../ui'

const enterHint = uniqueId('keyboard-enter-hint')
const modEnterHint = uniqueId('keyboard-mod-enter-hint')

const choiceStyles = `
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  cursor: pointer;

  &:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  &:focus-within {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 2px;
  }

  & input {
    margin: 0;
    accent-color: var(--accent);
  }
`

export const KeyboardSection = () => (
  <section
    data-slot="KeyboardSection"
    aria-label="Keyboard"
    css={`
      display: grid;
      align-content: start;
      gap: var(--space-4);
      min-width: 0;
      max-width: 28rem;
    `}
  >
    <div css="display: grid; gap: var(--space-1); min-width: 0;">
      <h3
        css={`
          margin: 0;
          font-family: var(--font-display);
          font-size: var(--text-lg);
          font-weight: var(--weight-medium);
          line-height: var(--leading-tight);
          letter-spacing: var(--tracking-display);
        `}
      >
        Send key
      </h3>
      <p
        css={`
          margin: 0;
          color: var(--text-muted);
          font-size: var(--text-sm);
          line-height: var(--leading-snug);
          text-wrap: pretty;
        `}
      >
        Choose which key sends a message from the composer.
      </p>
    </div>
    <div
      role="radiogroup"
      aria-label="Send key"
      css={`
        display: grid;
        gap: var(--space-2);
      `}
    >
      <div css="display: grid; gap: var(--space-1);">
        <label css={choiceStyles}>
          <input
            type="radio"
            name="atelier-send-key"
            value="enter"
            aria-describedby={enterHint}
            prop:checked={() => sendKey() === 'enter'}
            on:change={() => sendKey.set('enter')}
          />
          <span
            css={`
              font-size: var(--text-base);
              font-weight: var(--weight-medium);
            `}
          >
            Enter sends
          </span>
        </label>
        <p
          id={enterHint}
          css={`
            margin: 0;
            padding-inline-start: calc(1rem + var(--space-3));
            color: var(--text-muted);
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
          `}
        >
          Shift+Enter inserts a newline
        </p>
      </div>
      <div css="display: grid; gap: var(--space-1);">
        <label css={choiceStyles}>
          <input
            type="radio"
            name="atelier-send-key"
            value="mod-enter"
            aria-describedby={modEnterHint}
            prop:checked={() => sendKey() === 'mod-enter'}
            on:change={() => sendKey.set('mod-enter')}
          />
          <span
            css={`
              font-size: var(--text-base);
              font-weight: var(--weight-medium);
            `}
          >
            {modEnterChord()} sends
          </span>
        </label>
        <p
          id={modEnterHint}
          css={`
            margin: 0;
            padding-inline-start: calc(1rem + var(--space-3));
            color: var(--text-muted);
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
          `}
        >
          Enter inserts a newline
        </p>
      </div>
    </div>
  </section>
)
