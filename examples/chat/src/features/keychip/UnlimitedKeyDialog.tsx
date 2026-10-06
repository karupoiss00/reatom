import { keyStorageFailed, sessionMode, unlimitedAckNeeded } from '../../auth'
import { Button, Dialog, Icon, toast } from '../../ui'
import { KeyBanner } from './KeyBanner'
import {
  bannerMode,
  keyPageUrl,
  understandUnlimited,
  unlimitedDialogOpen,
} from './model'

const limitLinkStyles = `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-height-compact);
  padding: 0 var(--space-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-1);
  color: var(--text);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-none);
  text-decoration: none;

  &:hover {
    background: var(--surface-hover);
  }
`

const watchKeychip = () => {
  const stopStorage = keyStorageFailed.subscribe((failed) => {
    if (!failed) {
      toast.dismiss('key-storage')
      return
    }
    toast.show({
      key: 'key-storage',
      text: "Couldn't save your key on this device. You'll need to reconnect next time.",
      tone: 'warning',
      durationMs: null,
    })
  })
  const stopDialog = unlimitedAckNeeded.subscribe((needed) => {
    if (unlimitedDialogOpen() !== needed) unlimitedDialogOpen.set(needed)
  })
  return () => {
    stopStorage()
    stopDialog()
  }
}

const WelcomeRevokedBanner = () => (
  <div
    css={`
      position: fixed;
      z-index: var(--z-sticky);
      top: var(--space-4);
      left: 50%;
      width: min(36rem, calc(100vw - var(--space-6)));
      transform: translateX(-50%);
    `}
  >
    <KeyBanner />
  </div>
)

export const UnlimitedKeyDialog = () => (
  <div data-slot="UnlimitedKeyDialog" css="display: contents;" ref={watchKeychip}>
    {() =>
      sessionMode() === 'welcome' && bannerMode() === 'revoked' ? (
        <WelcomeRevokedBanner />
      ) : null
    }
    <Dialog
      open={unlimitedDialogOpen}
      dismissible={false}
      size="sm"
      title="No spending limit"
      footer={
        <>
          <a
            href={() => keyPageUrl()}
            target="_blank"
            rel="noopener noreferrer"
            css={limitLinkStyles}
          >
            Set a limit on OpenRouter
          </a>
          <Button
            variant="primary"
            size="sm"
            on:click={() => understandUnlimited()}
          >
            I understand
          </Button>
        </>
      }
    >
      <div
        css={`
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: var(--space-3);
          align-items: start;
          padding: var(--space-4);
          border-radius: var(--radius-md);
          background: var(--warning-soft);
        `}
      >
        <span
          css={`
            display: grid;
            padding-top: 0.1rem;
            color: var(--warning);
          `}
        >
          <Icon name="warning" size="1.25rem" />
        </span>
        <p
          css={`
            margin: 0;
            color: var(--text);
            font-size: var(--text-base);
            line-height: var(--leading-snug);
            text-wrap: pretty;
          `}
        >
          This key has no spending limit. It can spend your whole OpenRouter
          balance, including auto top-ups.
        </p>
      </div>
    </Dialog>
  </div>
)
