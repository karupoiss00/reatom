import type { OtlpAdmin } from '../../otlp'
import { exclusionDrafts, type ExclusionKind } from '../../otlp/exclusion'
import { tokens, type } from '../design-system'

const DOCS_HREF = 'https://v1001.reatom.dev/docs/handbook/opentelemetry/web-analytics'

export const ExclusionBanner = ({ admin }: { admin: OtlpAdmin }) => (
  <div>
    {() => {
      const drafts = exclusionDrafts({
        records: admin.records(),
        source: admin.source(),
        hiddenRows:
          admin.hiddenAbortSuspenseCount() + admin.hiddenMountLogCount(),
        filter: admin.filter(),
        view: admin.view(),
        timelineUnit: admin.timelineUnit(),
      })
      if (drafts.length === 0) return null
      return (
        <p
          data-testid="exclusion-banner"
          css={`
            ${type.meta}
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: var(--admin-space-8);
            margin: 0;
            padding: var(--admin-space-6) var(--admin-space-12);
            color: ${tokens.text2};
            background: ${tokens.surface1};
            border-bottom: 1px solid ${tokens.border1};
          `}
        >
          {drafts.map((draft, index) => (
            <span
              css={`
                display: inline-flex;
                align-items: baseline;
                gap: var(--admin-space-6);
              `}
            >
              {index === 0 ? null : (
                <span css={`color: ${tokens.text3};`}>·</span>
              )}
              <span>{draft.text}</span>
              <button
                type="button"
                data-testid={`exclusion-${draft.kind}`}
                on:click={(event: MouseEvent) => {
                  runExclusionAction(admin, draft.kind, event.currentTarget)
                }}
                css={`
                  ${type.meta}
                  padding: 0;
                  border: 0;
                  background: transparent;
                  color: ${tokens.accent};
                  cursor: pointer;
                `}
              >
                {draft.actionLabel}
              </button>
            </span>
          ))}
        </p>
      )
    }}
  </div>
)

function runExclusionAction(
  admin: OtlpAdmin,
  kind: ExclusionKind,
  target: EventTarget | null,
) {
  if (kind === 'hidden') {
    admin.showAbortAndSuspense.setTrue()
    admin.showMountLogs.setTrue()
    return
  }
  if (kind === 'segment') {
    admin.resetFilter()
    return
  }
  if (kind === 'remoteCap') {
    admin.remoteOpen.setTrue()
    const root = target instanceof Element ? target.getRootNode() : null
    const panel =
      root instanceof ShadowRoot || root instanceof Document
        ? root.querySelector('[data-testid="otlp-remote-panel"]')
        : null
    if (panel instanceof HTMLElement) panel.scrollIntoView({ block: 'nearest' })
    return
  }
  window.open(DOCS_HREF, '_blank', 'noopener,noreferrer')
}
