import { Banner, Button } from '../../ui'
import { bannerMode, reconnect } from './model'

const frameStyles = `
  padding: var(--space-3) var(--space-6) 0;
`

const ReconnectButton = () => (
  <Button variant="primary" size="sm" on:click={() => reconnect()}>
    Reconnect
  </Button>
)

const releaseNewChatRing = () => {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return
  if (!active.closest('[aria-label="Chats"]')) return
  if (active.textContent?.trim() !== 'New chat') return
  active.blur()
}

export const KeyBanner = () => (
  <div data-slot="KeyBanner" css="display: contents;">
    {() => {
      const mode = bannerMode()
      if (mode === 'none') return null
      if (mode === 'stream') {
        return (
          <div css={frameStyles} ref={releaseNewChatRing}>
            <Banner
              tone="warning"
              role="status"
              title="This key was revoked. This reply may not finish."
              actions={<ReconnectButton />}
            />
          </div>
        )
      }
      return (
        <div css={frameStyles} ref={releaseNewChatRing}>
          <Banner
            tone="danger"
            role="alert"
            title="Your key was revoked or disabled."
            actions={<ReconnectButton />}
          />
        </div>
      )
    }}
  </div>
)
