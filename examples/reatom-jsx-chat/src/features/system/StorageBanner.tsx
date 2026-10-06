import { dbHealth } from '../../storage'
import { Banner } from '../../ui'
import { localChatsSentence, privateModeSentence } from '../data/model'

export const StorageBanner = () => (
  <div data-slot="StorageBanner" css="display: contents;">
    {() =>
      dbHealth().status === 'memory' ? (
        <div
          css={`
            padding: var(--space-3) var(--space-6) 0;
          `}
        >
          <Banner tone="warning" icon="lock" title={privateModeSentence}>
            {localChatsSentence}
          </Banner>
        </div>
      ) : null
    }
  </div>
)
