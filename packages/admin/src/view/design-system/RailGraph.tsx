import { focusVisible, scrollable, truncate } from './mixins'
import { Icon } from './Icon'
import {
  type RailInputNode,
  type RailLayout,
  type RailLayoutEdge,
  type RailLayoutNode,
  type RailRelation,
  layoutRailGraph,
} from './rail-layout'
import {
  RAIL_LANE_GAP,
  RAIL_LINE_WIDTH,
  RAIL_NODE_OUTER,
  railTokens,
  soft,
  tokens,
  type,
} from './tokens'

export interface RailGraphProps {
  nodes: Array<RailInputNode>
  selectedId: number
  pathIds?: Array<number>
  onSelect: (nodeId: number) => void
  onReroot: (nodeId: number) => void
}

const ROW_HEIGHT = 28
const GUTTER_PAD = 12
const PATH_HEAD = 1
const PATH_TAIL = 3
const NODE_RADIUS = RAIL_NODE_OUTER / 2 - 0.5
const SELECTED_RADIUS = RAIL_NODE_OUTER / 2
const SELECTED_HALO_RADIUS = RAIL_NODE_OUTER - 1

const relationColor: Record<RailRelation, string> = {
  cause: railTokens[0],
  selected: tokens.info,
  effect: railTokens[2],
  related: tokens.text3,
}

const relationEdgeColor: Record<RailRelation, string> = {
  ...relationColor,
  related: tokens.border2,
}

const laneX = (lane: number) => GUTTER_PAD + lane * RAIL_LANE_GAP
const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2

function edgePath(edge: RailLayoutEdge): string {
  const fromX = laneX(edge.fromLane)
  const toX = laneX(edge.toLane)
  const fromY = rowY(edge.fromRow)
  const toY = rowY(edge.toRow)
  const bend = ROW_HEIGHT / 2

  if (edge.shape === 'straight' || fromX === toX) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`
  }
  if (edge.shape === 'branch') {
    const bendEndY = fromY + ROW_HEIGHT
    return `M ${fromX} ${fromY} C ${fromX} ${fromY + bend}, ${toX} ${fromY + bend}, ${toX} ${bendEndY} L ${toX} ${toY}`
  }
  const bendStartY = toY - ROW_HEIGHT
  return `M ${fromX} ${fromY} L ${fromX} ${bendStartY} C ${fromX} ${bendStartY + bend}, ${toX} ${bendStartY + bend}, ${toX} ${toY}`
}

function edgeLayer(edge: RailLayoutEdge): number {
  if (edge.isOnPath) return 2
  return edge.relation === 'related' ? 0 : 1
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function nodeTitle(node: RailLayoutNode): string {
  const status = node.hasError ? ' · error' : ''
  return `${node.label} #${node.id} · ${node.kind}${status}. Click to inspect, double-click or Shift+Enter to re-root.`
}

const LegendItem = ({
  relation,
  label,
}: {
  relation: RailRelation
  label: string
}) => (
  <span
    css={`
      display: inline-flex;
      align-items: center;
      gap: var(--admin-space-4);
      white-space: nowrap;
    `}
  >
    <span
      aria-hidden="true"
      css:dot={relationColor[relation]}
      css={`
        width: 8px;
        height: 8px;
        border-radius: 999px;
        box-sizing: border-box;
        background: var(--dot);
        &[data-hollow] {
          background: transparent;
          border: 1.5px solid var(--dot);
        }
      `}
      data-hollow={relation === 'related' ? '' : undefined}
    />
    {label}
  </span>
)

const PathCrumbs = ({
  layout,
  onSelect,
}: {
  layout: RailLayout
  onSelect: (nodeId: number) => void
}) => {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]))
  const path = layout.selectedPathIds.flatMap((id) => {
    const node = byId.get(id)
    return node ? [node] : []
  })
  const isLong = path.length > PATH_HEAD + PATH_TAIL + 1
  const head = isLong ? path.slice(0, PATH_HEAD) : path
  const skipped = isLong ? path.slice(PATH_HEAD, -PATH_TAIL) : []
  const tail = isLong ? path.slice(-PATH_TAIL) : []

  const crumb = (node: RailLayoutNode) =>
    node.isSelected ? (
      <strong
        css={`
          ${type.data}
          ${truncate}
          max-width: 18ch;
          color: ${tokens.text1};
          font-weight: 650;
        `}
      >
        {node.label}
      </strong>
    ) : (
      <button
        type="button"
        title={`${node.label} #${node.id}`}
        css:crumb={relationColor[node.relation]}
        css={`
          ${type.data}
          ${truncate}
          ${focusVisible}
          max-width: 18ch;
          border: 0;
          padding: 0 var(--admin-space-2);
          border-radius: var(--admin-radius-2);
          background: transparent;
          color: var(--crumb);
          cursor: pointer;
          &:hover {
            background: ${soft(tokens.surface3, 80)};
            color: ${tokens.text1};
          }
        `}
        on:click={() => onSelect(node.id)}
      >
        {node.label}
      </button>
    )

  const separator = () => (
    <span
      aria-hidden="true"
      css={`
        color: ${tokens.text3};
      `}
    >
      ›
    </span>
  )

  const crumbs: Array<Element> = []
  for (const node of head) {
    if (crumbs.length > 0) crumbs.push(separator())
    crumbs.push(crumb(node))
  }
  if (skipped.length > 0) {
    crumbs.push(separator())
    crumbs.push(
      <span
        title={skipped.map((node) => node.label).join(' › ')}
        css={`
          ${type.meta}
          color: ${tokens.text2};
        `}
      >
        {`…${skipped.length}`}
      </span>,
    )
  }
  for (const node of tail) {
    crumbs.push(separator())
    crumbs.push(crumb(node))
  }

  return (
    <nav
      aria-label="Shortest path from root"
      css={`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--admin-space-2) var(--admin-space-4);
        min-width: 0;
      `}
    >
      <span
        css={`
          ${type.meta}
          color: ${tokens.text2};
          margin-inline-end: var(--admin-space-4);
        `}
      >
        {path.length <= 1 ? 'Root event, no recorded cause' : 'Path'}
      </span>
      {path.length <= 1 ? null : crumbs}
    </nav>
  )
}

const RailGutter = ({ layout }: { layout: RailLayout }) => {
  const width = laneX(layout.laneCount - 1) + GUTTER_PAD
  const height = layout.nodes.length * ROW_HEIGHT
  const edges = [...layout.edges].sort(
    (left, right) => edgeLayer(left) - edgeLayer(right),
  )

  return (
    <svg:svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      css={`
        position: absolute;
        z-index: 1;
        inset-block-start: 0;
        inset-inline-start: 0;
        pointer-events: none;
        overflow: visible;
      `}
    >
      {edges.map((edge) => (
        <svg:path
          data-rail-edge={`${edge.fromId}>${edge.toId}`}
          d={edgePath(edge)}
          fill="none"
          stroke={relationEdgeColor[edge.relation]}
          stroke-width={edge.isOnPath ? RAIL_LINE_WIDTH : 1.5}
          stroke-linecap="round"
          opacity={edge.isOnPath ? '1' : edge.relation === 'related' ? '0.7' : '0.6'}
        />
      ))}
      {layout.nodes.map((node) => {
        const cx = laneX(node.lane)
        const cy = rowY(node.row)
        const color = node.hasError ? tokens.error : relationColor[node.relation]
        if (node.isSelected) {
          return (
            <svg:g>
              <svg:circle
                cx={cx}
                cy={cy}
                r={SELECTED_HALO_RADIUS}
                fill={tokens.canvas}
                stroke={tokens.info}
                stroke-width={1.5}
              />
              <svg:circle cx={cx} cy={cy} r={SELECTED_RADIUS} fill={color} />
            </svg:g>
          )
        }
        if (node.relation === 'related' && !node.hasError) {
          return (
            <svg:circle
              cx={cx}
              cy={cy}
              r={NODE_RADIUS - 0.5}
              fill={tokens.canvas}
              stroke={color}
              stroke-width={1.5}
            />
          )
        }
        return (
          <svg:circle
            cx={cx}
            cy={cy}
            r={NODE_RADIUS}
            fill={color}
            stroke={tokens.canvas}
            stroke-width={1.5}
          />
        )
      })}
    </svg:svg>
  )
}

const RailRow = ({
  node,
  gutterWidth,
  onSelect,
  onReroot,
}: {
  node: RailLayoutNode
  gutterWidth: number
  onSelect: (nodeId: number) => void
  onReroot: (nodeId: number) => void
}) => (
  <li
    css={`
      display: block;
    `}
  >
    <button
      type="button"
      data-rail-node={String(node.id)}
      data-relation={node.relation}
      aria-label={`${node.label}${node.hasError ? ' error' : ''} #${node.id}`}
      aria-current={node.isSelected ? 'true' : undefined}
      title={nodeTitle(node)}
      css:gutter={`${gutterWidth}px`}
      css={`
        ${focusVisible}
        appearance: none;
        box-sizing: border-box;
        width: 100%;
        height: ${ROW_HEIGHT}px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--admin-space-8);
        padding-block: 0;
        padding-inline: var(--gutter) var(--admin-space-8);
        border: 0;
        border-radius: var(--admin-radius-4);
        background: transparent;
        color: ${tokens.text1};
        text-align: start;
        cursor: pointer;
        &:focus-visible {
          outline-offset: -2px;
        }
        &[data-lit] {
          background: ${soft(tokens.surface3, 45)};
        }
        &:hover {
          background: ${soft(tokens.surface3, 80)};
        }
        &[aria-current='true'] {
          background: ${soft(tokens.info, 16)};
        }
        &[data-relation='related'] [data-node-name] {
          color: ${tokens.text2};
        }
      `}
      on:click={() => onSelect(node.id)}
      on:dblclick={() => onReroot(node.id)}
      on:pointerenter={(event: PointerEvent) =>
        traceNode(graphOf(event), node.id)
      }
      on:pointerleave={(event: PointerEvent) => traceNode(graphOf(event), null)}
      on:focus={(event: FocusEvent) => traceNode(graphOf(event), node.id)}
      on:blur={(event: FocusEvent) => traceNode(graphOf(event), null)}
      on:keydown={(event: KeyboardEvent) => {
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault()
          onReroot(node.id)
        }
      }}
      ref={(element) => {
        if (!node.isSelected) return
        requestAnimationFrame(() => {
          if (element.isConnected) element.scrollIntoView({ block: 'nearest' })
        })
      }}
    >
      <span
        css={`
          display: inline-flex;
          align-items: center;
          gap: var(--admin-space-6);
          min-width: 0;
        `}
      >
        <span
          aria-hidden="true"
          css={`
            display: inline-flex;
            flex: none;
            width: 12px;
            color: ${tokens.text3};
            [data-admin-icons='false'] & {
              display: none;
            }
          `}
        >
          {node.kind === 'action' ? <Icon name="action" size={12} /> : null}
        </span>
        <span
          data-node-name={node.label}
          css={`
            ${type.data}
            ${truncate}
            font-weight: ${node.isSelected ? 650 : 400};
          `}
        >
          {node.label}
        </span>
      </span>{' '}
      <span
        css={`
          display: inline-flex;
          align-items: center;
          gap: var(--admin-space-6);
        `}
      >
        {node.hasError ? (
          <span
            css={`
              ${type.meta}
              padding-inline: var(--admin-space-4);
              border-radius: var(--admin-radius-2);
              background: ${soft(tokens.error, 18)};
              color: ${tokens.error};
            `}
          >
            error
          </span>
        ) : null}{' '}
        <span
          data-rail-id
          css={`
            ${type.data}
            font-size: 11px;
            color: ${tokens.text2};
            @container rail-graph (max-width: 240px) {
              display: none;
            }
          `}
        >
          {`#${node.id}`}
        </span>
      </span>
    </button>
  </li>
)

/** Lights up the edges and rows directly linked to the traced node. */
function traceNode(graph: Element | null, nodeId: number | null) {
  if (!graph) return
  const litRows = new Set<string>()
  for (const edge of graph.querySelectorAll('[data-rail-edge]')) {
    const [fromId, toId] = edge.getAttribute('data-rail-edge')!.split('>')
    const isLit =
      nodeId !== null && (fromId === String(nodeId) || toId === String(nodeId))
    edge.toggleAttribute('data-lit', isLit)
    if (isLit) {
      litRows.add(fromId!)
      litRows.add(toId!)
    }
  }
  for (const row of graph.querySelectorAll('[data-rail-node]')) {
    row.toggleAttribute(
      'data-lit',
      litRows.has(row.getAttribute('data-rail-node')!),
    )
  }
  graph.toggleAttribute('data-tracing', nodeId !== null)
}

const graphOf = (event: Event) =>
  event.target instanceof Element
    ? event.target.closest('[data-rail-graph]')
    : null

function moveFocus(list: HTMLElement, event: KeyboardEvent) {
  const buttons = Array.from(
    list.querySelectorAll<HTMLButtonElement>('button[data-rail-node]'),
  )
  if (buttons.length === 0) return
  const currentIndex = buttons.findIndex(
    (button) => button === event.target,
  )
  const lastIndex = buttons.length - 1
  const nextIndexByKey: Record<string, number> = {
    ArrowDown: Math.min(lastIndex, currentIndex + 1),
    ArrowUp: Math.max(0, currentIndex - 1),
    Home: 0,
    End: lastIndex,
  }
  const nextIndex = nextIndexByKey[event.key]
  if (nextIndex === undefined || currentIndex < 0) return
  event.preventDefault()
  buttons[nextIndex]?.focus()
}

export const RailGraph = ({
  nodes,
  selectedId,
  pathIds,
  onSelect,
  onReroot,
}: RailGraphProps) => {
  const layout = layoutRailGraph(nodes, selectedId, pathIds)
  const gutterWidth = laneX(layout.laneCount - 1) + GUTTER_PAD + 4
  const countOf = (relation: RailRelation) =>
    layout.nodes.filter((node) => node.relation === relation).length
  const causeCount = countOf('cause')
  const effectCount = countOf('effect')
  const relatedCount = countOf('related')

  return (
    <div
      data-reatom-name="RailGraph"
      data-rail-graph
      css={`
        container: rail-graph / inline-size;
        & [data-rail-edge] {
          transition: opacity var(--admin-motion-hover) ease;
        }
        &[data-tracing] [data-rail-edge] {
          opacity: 0.16;
        }
        &[data-tracing] [data-rail-edge][data-lit] {
          opacity: 1;
          stroke-width: ${RAIL_LINE_WIDTH}px;
        }
        @media (prefers-reduced-motion: reduce) {
          & [data-rail-edge] {
            transition: none;
          }
        }
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        min-width: 0;
      `}
    >
      <header
        css={`
          ${type.meta}
          display: grid;
          gap: var(--admin-space-6);
          padding: var(--admin-space-4) var(--admin-space-4) var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
          color: ${tokens.text2};
        `}
      >
        <div
          css={`
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--admin-space-4) var(--admin-space-12);
          `}
        >
          <LegendItem
            relation="cause"
            label={plural(causeCount, 'cause', 'causes')}
          />
          <LegendItem
            relation="effect"
            label={plural(effectCount, 'effect', 'effects')}
          />
          {relatedCount > 0 ? (
            <LegendItem relation="related" label={`${relatedCount} related`} />
          ) : null}
        </div>
        <PathCrumbs layout={layout} onSelect={onSelect} />
      </header>
      <div
        css={`
          ${scrollable}
          padding-block: var(--admin-space-4);
        `}
      >
        <div
          css={`
            position: relative;
          `}
        >
          <RailGutter layout={layout} />
          <ol
            aria-label="Cause chain, oldest first"
            css={`
              margin: 0;
              padding: 0;
              list-style: none;
            `}
            on:keydown={(event: KeyboardEvent) => {
              if (event.currentTarget instanceof HTMLElement) {
                moveFocus(event.currentTarget, event)
              }
            }}
          >
            {layout.nodes.map((node) => (
              <RailRow
                node={node}
                gutterWidth={gutterWidth}
                onSelect={onSelect}
                onReroot={onReroot}
              />
            ))}
          </ol>
        </div>
        {layout.hiddenCount > 0 ? (
          <p
            css:gutter={`${gutterWidth}px`}
            css={`
              ${type.meta}
              margin: var(--admin-space-4) 0 0;
              padding-inline: var(--gutter) var(--admin-space-8);
              color: ${tokens.text2};
            `}
          >
            {`+${plural(layout.hiddenCount, 'node', 'nodes')} not drawn. Re-root on a node to explore its branch.`}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { layoutRailGraph }
export type { RailInputNode, RailLayout, RailLayoutNode }
