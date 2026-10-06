import { apiKey, oauthOutcome } from '../../auth'
import { Button, Spinner } from '../../ui'
import {
  browserOnline,
  followReturnTo,
  leaveOAuthError,
  oauthErrorCopy,
  pasteInstead,
} from './model'

const recoveryLabel = (reason: string) =>
  reason === 'expired' || reason === 'state-mismatch' ? 'Connect again' : 'Try again'

export const OAuthCallback = () => (
  <section
    data-slot="OAuthCallback"
    aria-live="polite"
    css={`
      flex: 1;
      display: grid;
      place-items: center;
      min-height: 0;
      overflow: auto;
      padding: var(--space-6) var(--space-5);
    `}
    ref={() =>
      oauthOutcome.subscribe((outcome) => {
        if (outcome.status !== 'connected') return
        followReturnTo(outcome.returnTo)
      })
    }
  >
    {() => {
      const outcome = oauthOutcome()
      if (outcome.status === 'error') {
        const copy = oauthErrorCopy(outcome.reason)
        const offline = outcome.reason === 'offline'
        return (
          <div
            css={`
              display: grid;
              gap: var(--space-4);
              width: min(26rem, 100%);
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
                gap: var(--space-2);
              `}
            >
              <h1
                css={`
                  margin: 0;
                  font-family: var(--font-display);
                  font-size: var(--text-xl);
                  font-weight: 500;
                  line-height: var(--leading-tight);
                  letter-spacing: var(--tracking-display);
                  text-wrap: balance;
                `}
              >
                {copy.title}
              </h1>
              <p
                css={`
                  margin: 0;
                  color: var(--text-muted);
                  font-size: var(--text-sm);
                  line-height: var(--leading-snug);
                  text-wrap: pretty;
                `}
              >
                {copy.detail}
              </p>
            </div>
            <div
              css={`
                display: grid;
                gap: var(--space-2);
              `}
            >
              <Button
                variant="primary"
                fullWidth
                disabled={() => offline && !browserOnline()}
                on:click={() => leaveOAuthError()}
              >
                {recoveryLabel(outcome.reason)}
              </Button>
              {outcome.reason === 'exchange-failed' ? (
                <Button variant="secondary" fullWidth on:click={() => pasteInstead()}>
                  Paste a key instead
                </Button>
              ) : null}
              {outcome.reason === 'unauthorized' ? (
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  css={`
                    align-self: center;
                    color: var(--accent-text);
                    font-size: var(--text-sm);
                    font-weight: var(--weight-medium);
                    text-decoration: none;

                    &:hover {
                      text-decoration: underline;
                    }
                  `}
                >
                  Manage keys
                </a>
              ) : null}
            </div>
          </div>
        )
      }

      const reconnecting = apiKey() !== null
      return (
        <div
          css={`
            display: grid;
            justify-items: center;
            gap: var(--space-4);
            width: min(24rem, 100%);
            text-align: center;
          `}
        >
          <Spinner size="1.75rem" />
          <h1
            css={`
              margin: 0;
              font-family: var(--font-display);
              font-size: var(--text-xl);
              font-weight: 500;
              line-height: var(--leading-tight);
              letter-spacing: var(--tracking-display);
            `}
          >
            {reconnecting
              ? 'Reconnecting to OpenRouter\u2026'
              : 'Connecting to OpenRouter\u2026'}
          </h1>
          {reconnecting ? (
            <p
              css={`
                margin: 0;
                color: var(--text-muted);
                font-size: var(--text-sm);
                line-height: var(--leading-snug);
              `}
            >
              Your current key stays until the new one is ready.
            </p>
          ) : null}
        </div>
      )
    }    }
  </section>
)
