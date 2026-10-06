import { Button, Switch } from '../../ui'
import { rememberKey } from '../../auth'
import { KeyFacts } from './KeyFacts'
import {
  addCreditsUrl,
  armForget,
  byokSettingsUrl,
  changeKeyFromMenu,
  confirmForget,
  forgetArmed,
  keepKey,
  keyPageUrl,
} from './model'

const linkStyles = `
  display: flex;
  align-items: center;
  min-height: 1.75rem;
  padding: 0 var(--space-1);
  color: var(--accent-text);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`

const actionStyles = `
  display: grid;
  gap: var(--space-2);
  position: sticky;
  top: 0;
  z-index: 1;
  margin: calc(var(--space-1-5) * -1) calc(var(--space-1-5) * -1) 0;
  padding: var(--space-2);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--line);
`

export const KeyMenu = () => (
  <div
    data-slot="KeyMenu"
    css={`
      display: grid;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-1) var(--space-1);
    `}
  >
    <div css={actionStyles}>
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        on:click={() => changeKeyFromMenu()}
      >
        Change key
      </Button>
      {() =>
        forgetArmed() ? (
          <div
            role="group"
            aria-label="Forget this key"
            css={`
              display: grid;
              gap: var(--space-3);
              padding: var(--space-3);
              border: 1px solid var(--line);
              border-radius: var(--radius-md);
              background: var(--bg-sunken);
            `}
          >
            <p
              css={`
                margin: 0;
                color: var(--text);
                font-size: var(--text-sm);
                line-height: var(--leading-snug);
                text-wrap: pretty;
              `}
            >
              The key still works on OpenRouter until you delete it there.
            </p>
            <div
              css={`
                display: flex;
                justify-content: flex-end;
                gap: var(--space-2);
              `}
            >
              <Button variant="ghost" size="sm" on:click={() => keepKey()}>
                Keep key
              </Button>
              <Button
                variant="danger"
                size="sm"
                on:click={() => confirmForget()}
              >
                Forget key
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            on:click={() => armForget()}
          >
            Forget key on this device
          </Button>
        )
      }
    </div>
    <KeyFacts />
    <Switch checked={rememberKey} label="Remember on this device" />
    <div
      css={`
        display: grid;
        gap: var(--space-0-5);
        padding: 0 var(--space-1) var(--space-1);
      `}
    >
      <a
        href={() => keyPageUrl()}
        target="_blank"
        rel="noopener noreferrer"
        css={linkStyles}
      >
        Manage key on OpenRouter
      </a>
      <a
        href={addCreditsUrl}
        target="_blank"
        rel="noopener noreferrer"
        css={linkStyles}
      >
        Add credits
      </a>
      <a
        href={byokSettingsUrl}
        target="_blank"
        rel="noopener noreferrer"
        css={linkStyles}
      >
        BYOK settings
      </a>
    </div>
  </div>
)
