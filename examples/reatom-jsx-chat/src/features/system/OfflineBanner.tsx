import { isOnline } from '../../platform/env'
import { Banner } from '../../ui'

export const OfflineBanner = () => (
  <div data-slot="OfflineBanner" css="display: contents;">
    {() =>
      isOnline() ? null : (
        <div
          css={`
            padding: var(--space-3) var(--space-6) 0;
          `}
        >
          <Banner
            tone="warning"
            icon="offline"
            title="You're offline. Your draft is safe."
          />
        </div>
      )
    }
  </div>
)
