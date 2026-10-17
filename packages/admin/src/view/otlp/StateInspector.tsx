import { atom, computed, effect, wrap, sleep } from '@reatom/core'

import {
  atomWriteSeries,
  captureClockNow,
  formatCaptureAge,
  numericWriteValue,
  valueShapeLabel,
  type OtlpAdmin,
  type OtlpStateNode,
} from '../../otlp'
import {
  EmptyState,
  focusVisible,
  Icon,
  kindStripe,
  scrollable,
  tokens,
  type,
  visuallyHidden,
} from '../design-system'
import { Inspector, type InspectorHooks } from '../inspector'
import { KindSwatch } from './KindMark'
import { TickSparkline } from './WriteChart'
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

function findStateNode(
  nodes: readonly OtlpStateNode[],
  id: string,
): OtlpStateNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = findStateNode(node.children, id)
    if (nested) return nested
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

let serial = 0

const AtomRow = ({
  admin,
  node,
  now,
}: {
  admin: OtlpAdmin
  node: OtlpStateNode
  now: () => number
}) => {
  const visible = atom(false, `_Admin.state.visible.${++serial}`)
  const source = computed(() => {
    return findStateNode(admin.stateTree(), node.id)?.value
  }, `_Admin.state.value.${serial}`)
  const series = () => {
    if (!visible() || node.atomName === undefined || node.sourceId === undefined) {
      return []
    }
    return atomWriteSeries(admin.records(), node.atomName, node.sourceId)
  }
  const kind = node.reatomKind === 'computed' ? 'computed' : 'atom'
  return (
    <div
      data-inspector-key={node.label}
      data-highlighted={() => {
        const key =
          node.sourceId && node.atomName
            ? `${node.sourceId}:${node.atomName}`
            : undefined
        return key !== undefined && admin.writtenNames().has(key)
          ? ''
          : undefined
      }}
      css={`
        display: grid;
        gap: var(--admin-space-4);
        min-width: 0;
        padding: var(--admin-space-4) 0 var(--admin-space-4) var(--admin-space-8);
        box-shadow: ${kindStripe(
          kind === 'computed' ? 'var(--admin-kind-computed)' : 'var(--admin-kind-atom)',
        )};
        &[data-highlighted] {
          background: color-mix(in oklch, ${tokens.accent} 10%, transparent);
        }
      `}
      ref={(element) => {
        if (!(element instanceof HTMLElement)) return
        const observer = new IntersectionObserver(
          (entries) => {
            visible.set(entries.some((entry) => entry.isIntersecting))
          },
          { threshold: 0.01 },
        )
        observer.observe(element)
        return () => observer.disconnect()
      }}
    >
      <div
        css={`
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          gap: var(--admin-space-6);
          min-width: 0;
        `}
      >
        <KindSwatch kind={kind} />
        <span
          css={`
            ${type.data}
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          `}
        >
          {node.label}
        </span>
        {node.atomName ? (
          <button
            type="button"
            aria-label={`Show ${node.atomName} on the timeline`}
            title={`Show ${node.atomName} on the timeline`}
            data-testid="inspector-atom-link"
            css={`
              ${focusVisible}
              display: inline-flex;
              flex: none;
              align-items: center;
              justify-content: center;
              width: 16px;
              height: 16px;
              margin-inline: 0.25em;
              padding: 0;
              border: 0;
              border-radius: var(--admin-radius-2);
              background: transparent;
              color: ${tokens.accent};
              cursor: pointer;
            `}
            on:click={(event: MouseEvent) => {
              event.stopPropagation()
              focusAtomOnTimeline(admin, {
                atomName: node.atomName!,
                recordId: node.recordId,
                sourceId: node.sourceId,
              })
            }}
          >
            <Icon name="timeline" />
            <span css={visuallyHidden}>
              {`Show ${node.atomName} on the timeline`}
            </span>
          </button>
        ) : null}
        <span
          css={`
            ${type.meta}
            flex: none;
            padding-inline: var(--admin-space-4);
            border-radius: var(--admin-radius-2);
            background: ${tokens.surface3};
            color: ${tokens.text3};
            white-space: nowrap;
          `}
        >
          {valueShapeLabel(node.value)}
        </span>
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
          `}
        >
          {node.writeCount ?? 1}
        </span>
        <span
          css={`
            ${type.meta}
            color: ${tokens.text3};
            white-space: nowrap;
          `}
        >
          {() => {
            if (node.lastWriteAt === undefined) return ''
            return (
              formatCaptureAge(
                captureClockNow(admin.records(), now()),
                node.lastWriteAt,
              ) ?? ''
            )
          }}
        </span>
        {() => {
          const points = series()
          if (points.length === 0) return null
          const mode = points.every((point) => numericWriteValue(point.value) !== undefined)
            ? 'step'
            : 'ticks'
          return <TickSparkline points={points} mode={mode} />
        }}
      </div>
      <Inspector value={source} />
    </div>
  )
}

const GroupRow = ({
  admin,
  node,
  now,
}: {
  admin: OtlpAdmin
  node: OtlpStateNode
  now: () => number
}) => {
  const open = atom(true, `_Admin.state.group.${++serial}`)
  const toggleOpen = () => open.set(!open())
  return (
    <div
      data-inspector-key={node.label}
      css={`
        display: grid;
        gap: var(--admin-space-4);
        min-width: 0;
      `}
    >
      <button
        type="button"
        aria-expanded={() => open()}
        css={`
          ${type.ui}
          display: flex;
          align-items: center;
          gap: var(--admin-space-6);
          margin: 0;
          padding: 0;
          border: 0;
          background: transparent;
          color: ${tokens.text2};
          cursor: pointer;
        `}
        on:click={toggleOpen}
      >
        {node.label}
      </button>
      {() =>
        open()
          ? node.children.map((child) => (
              <StateNode admin={admin} node={child} now={now} />
            ))
          : null
      }
    </div>
  )
}

const StateNode = ({
  admin,
  node,
  now,
}: {
  admin: OtlpAdmin
  node: OtlpStateNode
  now: () => number
}) => {
  if (node.kind === 'group') {
    return <GroupRow admin={admin} node={node} now={now} />
  }
  return <AtomRow admin={admin} node={node} now={now} />
}

export const StateInspector = ({ admin }: { admin: OtlpAdmin }) => {
  const now = atom(Date.now(), `_Admin.state.now.${++serial}`)
  effect(async () => {
    while (true) {
      now.set(Date.now())
      await wrap(sleep(1000))
    }
  }, `_Admin.state.tick.${serial}`)
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
          title="No last-write state yet"
          description="Replay and live records are last-write-only. Atoms that have not emitted reatom.atom.update or reatom.computed.update since connect have no row."
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
        {() =>
          admin.stateTree().map((node) => (
            <StateNode admin={admin} node={node} now={now} />
          ))
        }
      </div>
    </section>
  )
}
