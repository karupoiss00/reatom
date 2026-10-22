import type { OtlpAdmin, OtlpStateNode } from '../../otlp'
import { EmptyState, scrollable, tokens, type } from '../design-system'
import { Inspector, type InspectorHooks } from '../inspector'
import { focusAtomOnTimeline } from './focusAtom'

const stateNodes = Symbol('otlp.stateNodes')

interface StateNodeList {
  readonly [stateNodes]: readonly OtlpStateNode[]
}

function stateNodeList(nodes: readonly OtlpStateNode[]): StateNodeList {
  return { [stateNodes]: nodes }
}

function isStateNodeList(value: unknown): value is StateNodeList {
  return !!value && typeof value === 'object' && stateNodes in value
}

function isOtlpStateNode(value: unknown): value is OtlpStateNode {
  if (!value || typeof value !== 'object') return false
  const node = value as OtlpStateNode
  return (
    (node.kind === 'group' || node.kind === 'atom') &&
    typeof node.id === 'string' &&
    (node.id.startsWith('atom:') || node.id.startsWith('group:')) &&
    typeof node.label === 'string' &&
    Array.isArray(node.children)
  )
}

function nodesFrom(value: unknown): readonly OtlpStateNode[] | undefined {
  if (isStateNodeList(value)) return value[stateNodes]
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isOtlpStateNode)
  ) {
    return value
  }
  return undefined
}

function timelineAction(
  admin: OtlpAdmin,
  node: { atomName: string; recordId?: string; sourceId?: string },
) {
  return {
    label: `Show ${node.atomName} on the timeline`,
    onClick: () =>
      focusAtomOnTimeline(admin, {
        atomName: node.atomName,
        recordId: node.recordId,
        sourceId: node.sourceId,
      }),
  }
}

export function stateInspectorHooks(admin: OtlpAdmin): InspectorHooks {
  return {
    entries: (value) => {
      const nodes = nodesFrom(value)
      if (!nodes) return undefined
      return nodes.map((node) => ({
        id: node.id,
        key: node.label,
        label: node.label,
        value:
          node.kind === 'group' ? stateNodeList(node.children) : node.value,
        actions: node.atomName
          ? [
              timelineAction(admin, {
                atomName: node.atomName,
                recordId: node.recordId,
                sourceId: node.sourceId,
              }),
            ]
          : [],
      }))
    },
    initiallyExpanded: (value) => nodesFrom(value) !== undefined,
  }
}

export const StateInspector = ({ admin }: { admin: OtlpAdmin }) => {
  const hooks = stateInspectorHooks(admin)
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
          last-write records
        </span>
      </div>
      <div
        prop:hidden={() => admin.stateTree().length > 0}
        css={`
          min-height: 0;
        `}
      >
        <EmptyState
          title="No matching last-write state"
          description="Only the latest write for each atom is shown. Reset filters to restore matching state. Atoms that have not emitted an update since connect have no row."
        />
      </div>
      <div
        data-testid="otlp-state-tree"
        prop:hidden={() => admin.stateTree().length === 0}
        css={`
          ${scrollable}
          padding: var(--admin-space-8);
        `}
      >
        <Inspector value={admin.stateTree} hooks={hooks} defaultExpanded />
      </div>
    </section>
  )
}
