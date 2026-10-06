import { ConnectForm } from './ConnectForm'
import { PasteKey } from './PasteKey'

export const Welcome = () => (
  <section
    data-slot="Welcome"
    aria-labelledby="welcome-title"
    css={`
      flex: 1;
      display: grid;
      place-items: center;
      min-height: 0;
      overflow: auto;
      padding: var(--space-6) var(--space-5);
    `}
  >
    <div
      css={`
        display: grid;
        gap: var(--space-5);
        width: min(28rem, 100%);
        padding: var(--space-6);
        border: 1px solid var(--line);
        border-radius: var(--radius-xl);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-2), var(--edge-highlight);
      `}
    >
      <div
        css={`
          display: grid;
          justify-items: start;
          gap: var(--space-3);
        `}
      >
        <span
          aria-hidden="true"
          css={`
            width: 0.7rem;
            height: 0.7rem;
            border-radius: var(--radius-pill);
            background: var(--accent);
            box-shadow: 0 0 0 4px var(--accent-soft);
          `}
        />
        <h1
          id="welcome-title"
          css={`
            margin: 0;
            font-family: var(--font-display);
            font-size: var(--text-2xl);
            font-weight: 500;
            line-height: var(--leading-tight);
            letter-spacing: var(--tracking-display);
          `}
        >
          Atelier
        </h1>
      </div>
      <ConnectForm />
    </div>
    <PasteKey />
  </section>
)
