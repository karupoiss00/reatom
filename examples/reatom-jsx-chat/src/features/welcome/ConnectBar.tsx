import { Button, Dialog } from '../../ui'
import { ConnectForm } from './ConnectForm'
import { connectOpen, openConnect, openPasteKey } from './model'
import { PasteKey } from './PasteKey'

export const ConnectBar = () => (
  <div
    data-slot="ConnectBar"
    css={`
      padding: var(--space-4) var(--space-6) var(--space-5);
      padding-bottom: max(var(--space-5), env(safe-area-inset-bottom));
      background: var(--thread);
    `}
  >
    <div
      css={`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        max-width: 46rem;
        margin: 0 auto;
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--line-strong);
        border-radius: var(--radius-lg);
        background: var(--bg-elevated);
        box-shadow: var(--shadow);
      `}
    >
      <p
        css={`
          margin: 0;
          flex: 1 1 12rem;
          color: var(--text);
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
        `}
      >
        Connect to continue
      </p>
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
        `}
      >
        <Button variant="primary" size="sm" on:click={() => openConnect()}>
          Connect with OpenRouter
        </Button>
        <Button
          variant="secondary"
          size="sm"
          on:click={() => openPasteKey('paste')}
        >
          Paste a key
        </Button>
      </div>
    </div>
    <Dialog
      open={connectOpen}
      size="sm"
      title="Connect with OpenRouter"
      onClose={() => connectOpen.set(false)}
    >
      <ConnectForm />
    </Dialog>
    <PasteKey />
  </div>
)
