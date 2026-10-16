import type { Admin } from '../../index'
import { CauseGraphControls } from '../components/CauseGraphControls'
import { GraphNodes } from '../components/GraphNodes'
import { InspectorPanel } from '../components/InspectorPanel'
import { EmptyState, SplitPane, tokens, type } from '../design-system'

export interface CauseGraphScreenProps {
  admin: Admin
}

export const CauseGraphScreen = ({ admin }: CauseGraphScreenProps) => {
  const graph = () => admin.causeGraph.graph()
  const selectedFrameId = () => admin.store.selectedFrameId()

  const workspace = (
    <section
      data-reatom-name="CauseGraphWorkspace"
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
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        <CauseGraphControls admin={admin} />
      </div>
      {() => {
        const resolvedGraph = graph()
        const selectedId = selectedFrameId()
        if (!resolvedGraph && !selectedId) {
          return (
            <EmptyState
              title="Select a frame to start graph analysis"
              description="Choose any activity item to make it the root of the causal graph and then explore ancestors, descendants, or the combined path."
            />
          )
        }
        if (!resolvedGraph) {
          return (
            <EmptyState
              title="No graph nodes for this frame"
              description="The selected frame has no visible causal relationships in the current dataset or active filters."
            />
          )
        }
        return <GraphNodes admin={admin} graph={resolvedGraph} />
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
        ratio={admin.view.graphSplitRatio}
        left={workspace}
        right={
          <aside
            css={`
              height: 100%;
              min-height: 0;
              overflow: hidden;
            `}
          >
            <InspectorPanel admin={admin} />
          </aside>
        }
        minLeft={280}
        minRight={260}
        defaultRatio={0.58}
      />
    </div>
  )
}
