import { Button, Checkbox, Dialog, TextField } from '../../ui'
import {
  bindPasteField,
  browserOnline,
  canSubmitPaste,
  closePasteKey,
  keyHint,
  pasteDraft,
  pasteErrorText,
  pasteIntent,
  pasteKeyOpen,
  pastePending,
  pasteProblem,
  pasteRevealed,
  rememberHint,
  rememberKey,
  submitPaste,
} from './model'

const keysUrl = 'https://openrouter.ai/keys'

export const PasteKey = () => (
  <div
    data-slot="PasteKey"
    css={`
      position: absolute;
      width: 0;
      height: 0;
      overflow: visible;
    `}
  >
    <Dialog
      open={pasteKeyOpen}
      size="sm"
      title={() => (pasteIntent() === 'change' ? 'Change key' : 'Paste an API key')}
      onClose={() => closePasteKey()}
    >
      <form
        on:submit={(event) => {
          event.preventDefault()
          void submitPaste()
        }}
        css={`
          display: grid;
          gap: var(--space-4);

          & [data-field-hint]:empty {
            display: none;
          }

          & [data-field-box]:focus-within {
            border-color: var(--text);
            outline: var(--focus-width) solid var(--text);
          }

          & [data-field-box][data-invalid='true'] {
            border-color: var(--danger);
          }

          & [data-field-box][data-invalid='true']:focus-within {
            border-color: var(--danger);
            outline: var(--focus-width) solid var(--danger);
          }

          & [data-toggle-description] {
            text-wrap: pretty;
          }

          & [data-key-link] {
            width: fit-content;
            color: var(--accent-text);
            font-size: var(--text-sm);
            font-weight: var(--weight-medium);
            text-decoration: none;
          }

          & [data-key-link]:hover {
            text-decoration: underline;
          }

          & [data-offline] {
            margin: 0;
            color: var(--text-muted);
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
          }
        `}
      >
        <TextField
              label="OpenRouter API key"
              value={pasteDraft}
              type={() => (pasteRevealed() ? 'text' : 'password')}
              autocomplete="off"
              spellcheck={false}
              autocapitalize="off"
              dir="ltr"
              autofocus
              ref={bindPasteField}
              error={pasteErrorText}
              hint={() => keyHint()}
              trailing={
                <button
                  type="button"
                  on:click={() => pasteRevealed.set((shown) => !shown)}
                  css={`
                    appearance: none;
                    flex: none;
                    margin: 0;
                    padding: 0 0 0 var(--space-2);
                    border: 0;
                    background: transparent;
                    box-shadow: none;
                    color: var(--accent-text);
                    font: inherit;
                    font-size: var(--text-sm);
                    font-weight: var(--weight-medium);
                    white-space: nowrap;
                    cursor: pointer;

                    &:hover {
                      color: var(--accent-hover);
                    }
                  `}
                >
                  {() => (pasteRevealed() ? 'Hide' : 'Show')}
                </button>
              }
            />
        <a
          data-key-link=""
          href={keysUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Create a key at openrouter.ai/keys
        </a>
        {() =>
          pasteProblem() === 'unauthorized' ? (
            <a
              data-key-link=""
              href={keysUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Manage keys
            </a>
          ) : null
        }
        {() =>
          browserOnline() ? null : (
            <p data-offline="" role="status">
              Couldn't reach OpenRouter. Check your connection and try again.
            </p>
          )
        }
        <CheckboxRow />
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={pastePending}
          disabled={() => !canSubmitPaste()}
        >
          {() => (pastePending() ? 'Checking\u2026' : 'Check and connect')}
        </Button>
      </form>
    </Dialog>
  </div>
)

const CheckboxRow = () => (
  <div
    css={`
      & label {
        align-items: flex-start;
      }
    `}
  >
    <Checkbox
      checked={rememberKey}
      label="Remember on this device"
      description={rememberHint}
    />
  </div>
)
