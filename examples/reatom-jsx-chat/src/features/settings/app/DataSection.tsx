import { dbHealth, requestPersistence, storageInfo } from '../../../storage'
import { persistDenied } from '../../../storage/prefs'
import { Button, Spinner, TextField, visuallyHidden } from '../../../ui'
import {
  deleteAllChats,
  deletePhrase,
  exportEveryChat,
  formatStorageUsage,
  importStatus,
  importStatusText,
  localChatsSentence,
  persistDeniedSentence,
  pickImport,
  privateModeSentence,
} from '../../data/model'

const noteStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-wrap: pretty;
`

const headingStyles = `
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-display);
`

let importInput: HTMLInputElement | null = null

export const DataSection = () => (
  <section
    data-slot="DataSection"
    aria-label="Data"
    css={`
      display: grid;
      align-content: start;
      gap: var(--space-5);
      min-width: 0;
      max-width: 36rem;
    `}
  >
    <div css="display: grid; gap: var(--space-3); justify-items: start;">
      <div css="display: grid; gap: var(--space-1);">
        <h3 css={headingStyles}>On this device</h3>
        <p
          data-storage-size=""
          css={`
            margin: 0;
            font-variant-numeric: tabular-nums;
            font-size: var(--text-md);
            font-weight: var(--weight-medium);
            line-height: var(--leading-snug);
          `}
        >
          {() => {
            const info = storageInfo.data()
            if (!storageInfo.ready() && info === undefined) return 'Checking storage…'
            if (storageInfo.error()) return 'Storage size unavailable'
            return formatStorageUsage(info?.usageBytes ?? null)
          }}
        </p>
        <p css={noteStyles}>
          {() =>
            dbHealth().status === 'memory' ? privateModeSentence : localChatsSentence
          }
        </p>
      </div>
      {() => {
        const persisted = storageInfo.data()?.persisted === true
        const denied = persistDenied() && !persisted
        return (
          <div css="display: grid; gap: var(--space-2); justify-items: start;">
            {persisted ? (
              <p
                css={`
                  margin: 0;
                  color: var(--success);
                  font-size: var(--text-sm);
                  font-weight: var(--weight-semibold);
                `}
              >
                Persistent
              </p>
            ) : null}
            {denied ? (
              <p role="alert" css={noteStyles}>
                {persistDeniedSentence}
              </p>
            ) : null}
            {persisted ? null : (
              <Button
                variant="secondary"
                size="sm"
                icon="lock"
                loading={() => !requestPersistence.ready()}
                on:click={() => requestPersistence()}
              >
                Make storage persistent
              </Button>
            )}
          </div>
        )
      }}
    </div>

    <div css="display: grid; gap: var(--space-3); justify-items: start;">
      <h3 css={headingStyles}>Backup</h3>
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        `}
      >
        <Button
          variant="secondary"
          size="sm"
          icon="download"
          loading={() => !exportEveryChat.ready()}
          on:click={() => exportEveryChat()}
        >
          Export all chats (JSON)
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon="upload"
          on:click={() => importInput?.click()}
        >
          Import JSON
        </Button>
      </div>
      <input
        ref={(element: HTMLInputElement) => {
          importInput = element
          return () => {
            importInput = null
          }
        }}
        type="file"
        accept="application/json,.json"
        tabindex="-1"
        css={visuallyHidden}
        on:change={(event) => {
          const input = event.currentTarget
          const file = input.files?.[0] ?? null
          input.value = ''
          if (!file) return
          void pickImport(file)
        }}
      />
      {() => {
        const status = importStatus()
        if (status.kind === 'idle') return null
        const message = importStatusText(status)
        return (
          <p
            role={status.kind === 'error' ? 'alert' : 'status'}
            data-import-state={status.kind}
            css={`
              display: flex;
              align-items: center;
              gap: var(--space-2);
              margin: 0;
              color: var(--text);
              font-size: var(--text-sm);
              font-weight: var(--weight-medium);
              line-height: var(--leading-snug);
              text-wrap: pretty;

              &[data-import-state='error'] {
                color: var(--danger);
              }

              &[data-import-state='success'] {
                color: var(--success);
              }
            `}
          >
            {status.kind === 'importing' ? <Spinner label="Importing" size="1rem" /> : null}
            <span>{message}</span>
          </p>
        )
      }}
    </div>

    <div
      data-danger-zone=""
      css={`
        display: grid;
        gap: var(--space-3);
        justify-items: start;
        padding: var(--space-4);
        border: 1px solid var(--danger-line, var(--line));
        border-radius: var(--radius-md);
        background: var(--danger-soft);
      `}
    >
      <div css="display: grid; gap: var(--space-1);">
        <h3 css={headingStyles}>Danger zone</h3>
        <p css={noteStyles}>
          Delete every chat and preset on this device. Your key stays. Forget
          key is in the key menu.
        </p>
      </div>
      <TextField
        label="Type DELETE to confirm"
        value={deletePhrase}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
      />
      <Button
        variant="danger"
        size="sm"
        icon="trash"
        disabled={() => deletePhrase() !== 'DELETE' || !deleteAllChats.ready()}
        on:click={() => deleteAllChats()}
      >
        Delete all chats
      </Button>
    </div>
  </section>
)
