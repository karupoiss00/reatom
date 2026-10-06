import { Button, Checkbox } from '../../ui'
import {
  browserOnline,
  canConnect,
  connect,
  connectBusy,
  connectLabel,
  limitDraft,
  limitState,
  openPasteKey,
  rememberHint,
  rememberKey,
  unlimitedAccepted,
} from './model'

const limitError = 'Enter a limit above 0, or clear the field for no limit.'

const limitLead = () => {
  const limit = limitState()
  if (limit.state === 'invalid') return limitError
  if (limit.state === 'empty') {
    return 'No spending cap. This key can use your whole balance.'
  }
  return 'A new key, capped at this amount.'
}

const safetyNote =
  'Your key stays in this browser. Anyone with access to this browser profile or a malicious extension could use it.'

export const ConnectForm = () => (
  <form
    on:submit={(event) => {
      event.preventDefault()
      void connect()
    }}
    css={`
      display: grid;
      gap: var(--space-4);

      & [data-safety] {
        margin: 0;
        color: var(--text-muted);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);
      }

      & [data-paste-link] {
        justify-self: center;
        margin-top: calc(var(--space-2) * -1);
        padding: var(--space-1) var(--space-2);
        border: 0;
        background: none;
        color: var(--accent-text);
        font: inherit;
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        cursor: pointer;
      }

      & [data-paste-link]:hover {
        text-decoration: underline;
      }

      & [data-unlimited] {
        padding: var(--space-2) var(--space-3);
        border: 1px solid var(--warning-line);
        border-radius: var(--radius-md);
        background: var(--warning-soft);
      }

      & [data-limit] {
        display: grid;
        gap: var(--space-2);
      }

      & [data-limit-lead] {
        margin: 0;
        max-width: 36ch;
        color: var(--text);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);
        text-wrap: pretty;
      }

      & [data-limit-lead][data-tone='danger'] {
        color: var(--danger);
      }

      & [data-amount] {
        display: inline-flex;
        align-items: baseline;
        gap: 0.12em;
        width: fit-content;
        padding: 0 0.1rem 0.2rem;
        border-bottom: 1.5px solid var(--line-strong);
      }

      & [data-amount]:focus-within {
        border-bottom-color: var(--text);
      }

      & [data-amount][data-invalid='true'] {
        border-bottom-color: var(--danger);
      }

      & [data-dollar] {
        color: var(--text-muted);
        font-family: var(--font-display);
        font-size: var(--text-xl);
        font-weight: 500;
        line-height: 1;
      }

      & [data-amount] input {
        margin: 0;
        padding: 0;
        width: auto;
        min-width: 1.4ch;
        border: 0;
        background: transparent;
        color: var(--text);
        font-family: var(--font-display);
        font-size: var(--text-2xl);
        font-weight: 500;
        line-height: 1;
        letter-spacing: var(--tracking-display);
        field-sizing: content;
        outline: none;
      }

      & [data-amount][data-empty='true'] input {
        color: var(--text-muted);
        font-family: var(--font-sans);
        font-size: var(--text-lg);
        font-weight: var(--weight-medium);
        letter-spacing: 0;
      }

      & [data-amount][data-invalid='true'] input,
      & [data-amount][data-invalid='true'] [data-dollar] {
        color: var(--danger);
      }

      & [data-toggle-description] {
        text-wrap: pretty;
      }

      & details {
        color: var(--text-muted);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);
      }

      & summary {
        cursor: pointer;
        width: fit-content;
      }

      & details p {
        margin: var(--space-2) 0 0;
      }
    `}
  >
    {() =>
      browserOnline() ? null : (
        <p data-safety="" role="status">
          You're offline. Connect when you're back online.
        </p>
      )
    }
    <div data-limit="">
      <p
        data-limit-lead=""
        data-tone={() => (limitState().state === 'invalid' ? 'danger' : 'neutral')}
      >
        {() => limitLead()}
      </p>
      <div
        data-amount=""
        data-empty={() => (limitDraft().trim() === '' ? 'true' : 'false')}
        data-invalid={() => (limitState().state === 'invalid' ? 'true' : 'false')}
      >
        {() =>
          limitDraft().trim() === '' ? null : (
            <span data-dollar="" aria-hidden="true">
              $
            </span>
          )
        }
        <input
          aria-label="Spending limit"
          inputmode="decimal"
          autocomplete="off"
          spellcheck={false}
          placeholder="No limit"
          model:value={limitDraft}
          attr:size={() => {
            const text = limitDraft().trim()
            return text === '' ? '8' : String(Math.max(text.length, 1))
          }}
          attr:aria-invalid={() =>
            limitState().state === 'invalid' ? 'true' : 'false'
          }
        />
      </div>
    </div>
    <Checkbox
      checked={rememberKey}
      label="Remember on this device"
      description={rememberHint}
    />
    {() =>
      limitState().state === 'empty' ? (
        <div data-unlimited="">
          <Checkbox
            checked={unlimitedAccepted}
            label="I understand this key can spend my whole balance, including auto top-ups"
          />
        </div>
      ) : null
    }
    <Button
      type="submit"
      variant="primary"
      fullWidth
      loading={connectBusy}
      disabled={() => !canConnect()}
    >
      {() => connectLabel()}
    </Button>
    <button
      type="button"
      data-paste-link=""
      on:click={() => openPasteKey('paste')}
    >
      Paste an API key
    </button>
    <p data-safety="">{safetyNote}</p>
    <details>
      <summary>Details</summary>
      <p>Previous keys stay active on OpenRouter until you delete them there.</p>
    </details>
  </form>
)
