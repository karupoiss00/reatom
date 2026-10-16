import type { OtlpAdmin } from '../../otlp'
import {
  EmptyState,
  RailGraph,
  SplitPane,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { OtlpInspector } from './Inspector'

export interface OtlpGraphScreenProps {
  admin: OtlpAdmin
}

export const OtlpGraphScreen = ({ admin }: OtlpGraphScreenProps) => {
  const workspace = (
    <section
      data-reatom-name="OtlpGraphScreen"
      css={`
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        background: ${tokens.canvas};
      `}
    >
      <div
        css={`
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        <h2
          css={`
            ${type.title}
            margin: 0;
          `}
        >
          Causal graph
        </h2>
      </div>
      <div
        css={`
          display: flex;
          gap: var(--admin-space-6);
          align-items: center;
          flex-wrap: wrap;
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        {(['ancestors', 'descendants', 'full'] as const).map((direction) => (
          <button
            type="button"
            aria-pressed={() => admin.graphDirection() === direction}
            css={`
              ${type.ui}
              appearance: none;
              min-height: 28px;
              padding-inline: var(--admin-space-8);
              border: 1px solid ${tokens.border1};
              background: transparent;
              color: ${tokens.text2};
              cursor: pointer;
              text-transform: capitalize;
              &[aria-pressed='true'] {
                background: ${tokens.surface3};
                color: ${tokens.text1};
              }
            `}
            on:click={() => admin.graphDirection.set(direction)}
          >
            {direction}
          </button>
        ))}
      </div>
      {() => {
        const root = admin.selectedRootFrameId()
        const nodes = admin.railNodes()
        if (!root) {
          return (
            <EmptyState
              title="Select a record to start graph analysis"
              description="Choose an activity item that has a frame id. Records without reatom.frame.id stay on Activity and Timeline only."
            />
          )
        }
        if (nodes.length === 0) {
          return (
            <EmptyState
              title="No graph nodes for this record"
              description="The selected record has no framed causes or dependents in the ingested batch."
            />
          )
        }
        return (
          <div
            css={`
              ${scrollable}
              padding: var(--admin-space-8);
            `}
          >
            <RailGraph
              nodes={nodes}
              selectedId={Number(root)}
              onSelect={(frameId) => admin.selectFrame(frameId)}
              onReroot={(frameId) => {
                admin.selectFrame(frameId)
                admin.graphDirection.set('full')
              }}
            />
          </div>
        )
      }}
    </section>
  )

  return (
    <div
      css={`
        height: 100%;
        min-height: 0;
        overflow: hidden;
      `}
    >
      <SplitPane
        ratio={admin.graphSplitRatio}
        left={workspace}
        right={
          <aside
            css={`
              height: 100%;
              min-height: 0;
              overflow: hidden;
            `}
          >
            <OtlpInspector admin={admin} />
          </aside>
        }
        minLeft={280}
        minRight={260}
        defaultRatio={0.58}
      />
    </div>
  )
}
