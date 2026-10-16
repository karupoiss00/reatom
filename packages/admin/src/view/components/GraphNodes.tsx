import type { Admin } from '../../index'
import type { CauseGraph } from '../../types'
import { isActionFrame } from '../frame-inspector'
import {
  RailGraph,
  type RailInputNode,
  scrollable,
  tokens,
  type,
} from '../design-system'

export interface GraphNodesProps {
  admin: Admin
  graph: CauseGraph
}

export const GraphNodes = ({ admin, graph }: GraphNodesProps) => {
  const direction = admin.causeGraph.direction
  const selectedFrameId = () => admin.store.selectedFrameId()

  const railNodes = (): Array<RailInputNode> => {
    const atoms = admin.store.getAtoms()
    const frameIndex = admin.store.frameIndex()
    return graph.nodes.map((node) => {
      const nodeFrame = frameIndex.get(node.frameId)
      return {
        id: node.frameId,
        label: atoms.get(node.atomId)?.name ?? node.atomId,
        kind: nodeFrame && isActionFrame(nodeFrame) ? 'action' : 'state',
        timestamp: nodeFrame?.timestamp ?? node.frameId,
        parentIds: graph.edges
          .filter((edge) => edge.toFrameId === node.frameId)
          .map((edge) => edge.fromFrameId),
        hasError: nodeFrame?.error != null,
      }
    })
  }

  return (
    <div
      data-reatom-name="GraphNodes"
      css={`
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 0;
        height: 100%;
      `}
    >
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
        <h3
          css={`
            ${type.title}
            margin: 0;
          `}
        >
          Graph nodes
        </h3>
        {(['ancestors', 'descendants', 'full'] as const).map((d) => (
          <button
            type="button"
            aria-pressed={() => direction() === d}
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
            on:click={() => direction.set(d)}
          >
            {d}
          </button>
        ))}
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
            margin-inline-start: auto;
          `}
        >
          {graph.edges.length} edge{graph.edges.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        css={`
          ${scrollable}
          padding: var(--admin-space-8);
        `}
      >
        {() => (
          <RailGraph
            nodes={railNodes()}
            selectedId={selectedFrameId() ?? graph.rootFrameId}
            pathIds={admin.causeGraph.path() ?? undefined}
            onSelect={(frameId) => {
              admin.store.selectFrame(frameId)
            }}
            onReroot={(frameId) => {
              admin.store.selectFrame(frameId)
              admin.causeGraph.selectedRootId.set(frameId)
            }}
          />
        )}
      </div>
    </div>
  )
}
