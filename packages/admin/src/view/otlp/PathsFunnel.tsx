import type { OtlpAdmin } from '../../otlp'
import {
  analyticsContinuationText,
  analyticsFunnelMeta,
  analyticsShareText,
  type AnalyticsPathNode,
} from '../../otlp/analytics'
import {
  Button,
  FunnelTrack,
  SelectField,
  Toolbar,
  ToolbarGroup,
  tokens,
  type,
} from '../design-system'
import { PathsEmptyState } from './emptyStates'

export const PathsPresentationBar = ({ admin }: { admin: OtlpAdmin }) => (
  <Toolbar>
    <ToolbarGroup>
      <Button
        variant="ghost"
        label="Path gantt"
        pressed={() => admin.analytics.pathsPresentation() === 'gantt'}
        onClick={() => admin.analytics.pathsPresentation.set('gantt')}
      >
        Path gantt
      </Button>
      <Button
        variant="ghost"
        label="Funnel"
        testId="paths-funnel-toggle"
        pressed={() => admin.analytics.pathsPresentation() === 'funnel'}
        onClick={() => admin.analytics.pathsPresentation.set('funnel')}
      >
        Funnel
      </Button>
    </ToolbarGroup>
  </Toolbar>
)

export const PathsFunnelView = ({ admin }: { admin: OtlpAdmin }) => (
  <section
    data-testid="paths-funnel"
    css={`
      display: grid;
      align-content: start;
      gap: var(--admin-space-12);
      height: 100%;
      min-height: 0;
      padding: var(--admin-space-12);
      background: ${tokens.canvas};
    `}
  >
    <Toolbar>
      <ToolbarGroup>
        <SelectField
          value={admin.analytics.alignChoice}
          label="Align at"
          options={() => {
            const current = admin.analytics.alignChoice()
            const options = [
              { value: '', label: 'Session start' },
              ...admin.analytics.breakdowns().page.map((row) => ({
                value: row.key,
                label: row.key,
              })),
            ]
            if (
              current !== '' &&
              !options.some((option) => option.value === current)
            ) {
              options.push({ value: current, label: current })
            }
            return options
          }}
        />
        <Button
          variant="secondary"
          label="Typical path"
          onClick={() => admin.analytics.expandTypicalPath()}
        >
          Typical path
        </Button>
        <Button
          variant="secondary"
          label="Open typical session"
          onClick={() => admin.openTypicalSession()}
        >
          Open typical session
        </Button>
      </ToolbarGroup>
    </Toolbar>
    {() => {
      const path = admin.analytics.typicalPath()
      if (path.length === 0) return <PathsEmptyState />
      return (
        <div
          css={`
            display: grid;
            gap: var(--admin-space-12);
            max-width: 36rem;
          `}
        >
          {path.map((node) => (
            <FunnelPathStep admin={admin} node={node} />
          ))}
        </div>
      )
    }}
  </section>
)

const FunnelPathStep = ({
  admin,
  node,
}: {
  admin: OtlpAdmin
  node: AnalyticsPathNode
}) => {
  const parentSessions =
    node.continuation > 0 ? node.sessions / node.continuation : node.sessions
  const rootSessions = node.share > 0 ? node.sessions / node.share : node.sessions
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-6);
      `}
    >
      <FunnelTrack
        label={node.label}
        meta={analyticsFunnelMeta(
          node.sessions,
          node.share,
          rootSessions,
          node.continuation,
          parentSessions,
        )}
        fill={node.share}
        onClick={() => admin.analytics.paths.select(node)}
      />
      <p
        css={`
          ${type.meta}
          margin: 0;
          color: ${tokens.text3};
        `}
      >
        {`${analyticsShareText(node)} share · ${analyticsContinuationText(node)} continue`}
      </p>
    </div>
  )
}
