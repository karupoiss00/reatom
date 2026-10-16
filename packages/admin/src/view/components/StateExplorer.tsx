import type { Admin } from '../../index'
import type { StateTreeNode } from '../../types'
import { EmptyState, scrollable, tokens, type } from '../design-system'
import { formatPreview } from '../format'

export interface StateExplorerProps {
  admin: Admin
}

function renderNode(node: StateTreeNode, admin: Admin): Element {
  if (node.kind === 'group') {
    return (
      <details open>
        <summary
          css={`
            ${type.ui}
            cursor: pointer;
            color: ${tokens.text1};
            padding-block: var(--admin-space-4);
          `}
        >
          {node.label}
        </summary>
        <div
          css={`
            display: grid;
            gap: var(--admin-space-4);
            margin-inline-start: var(--admin-space-12);
            padding-inline-start: var(--admin-space-8);
            border-left: 1px solid ${tokens.border1};
          `}
        >
          {node.children.map((child) => renderNode(child, admin))}
        </div>
      </details>
    )
  }

  return (
    <button
      type="button"
      css={`
        ${type.data}
        display: grid;
        gap: var(--admin-space-4);
        text-align: left;
        border: 1px solid ${tokens.border1};
        background: ${tokens.surface2};
        color: ${tokens.text1};
        padding: var(--admin-space-8);
        cursor: pointer;
      `}
      on:click={() => {
        if (node.frameId === undefined) return
        admin.store.selectFrame(node.frameId)
        admin.causeGraph.selectedRootId.set(node.frameId)
      }}
    >
      <div
        css={`
          display: flex;
          justify-content: space-between;
          gap: var(--admin-space-8);
        `}
      >
        <span css={`${type.ui}`}>{node.label}</span>
        {node.frameId !== undefined && (
          <span css={`color: ${tokens.text3};`}>#{node.frameId}</span>
        )}
      </div>
      <div css={`color: ${tokens.text2};`}>{formatPreview(node.value)}</div>
    </button>
  )
}

export const StateExplorer = ({ admin }: StateExplorerProps) => {
  const tree = () => {
    const visible = admin.view.visibleStateTree()
    if (visible.length > 0) return visible
    return admin.view.stateTree()
  }

  return (
    <section
      css={`
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        background: ${tokens.canvas};
      `}
    >
      <div
        css={`
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 28px;
          padding-inline: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        <h3
          css={`
            ${type.title}
            margin: 0;
          `}
        >
          State explorer
        </h3>
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
          `}
        >
          reactive atoms only
        </span>
      </div>

      {() =>
        tree().length === 0 ? (
          <EmptyState
            title="No reactive state yet"
            description="State values will appear here as soon as the app emits frames."
          />
        ) : (
          <div
            css={`
              ${scrollable}
              display: grid;
              gap: var(--admin-space-6);
              align-content: start;
              padding: var(--admin-space-8);
            `}
          >
            {tree().map((node) => renderNode(node, admin))}
          </div>
        )
      }
    </section>
  )
}
