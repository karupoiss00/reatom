import { copyPhase } from '../data/model'

export const ChatMenu = () => (
  <span css="display: contents;">
    {() =>
      copyPhase() === 'copied' ? (
        <div
          data-slot="ChatMenu"
          css={`
            display: flex;
            align-items: center;
            gap: var(--space-3);
            min-width: 0;
          `}
        >
          <span
            role="status"
            css={`
              flex: none;
              color: var(--accent-text);
              font-size: var(--text-sm);
              font-weight: var(--weight-medium);
              line-height: var(--leading-none);
            `}
          >
            Copied
          </span>
        </div>
      ) : null
    }
  </span>
)
