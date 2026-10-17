import {
  causeThread,
  focusVisible,
  kindStripe,
  kindTokens,
  layoutRailGraph,
  scrollable,
  soft,
  tokens,
  truncate,
  type,
  type RailInputNode,
  type RailLayoutNode,
} from '../design-system'
import type { RailLayoutEdge } from '../design-system/rail-layout'
import type { OtlpRailNode } from '../../otlp'

const ROW_HEIGHT = 40
const GUTTER_PAD = 12
const LANE_GAP = 18

export type CauseRailCard = RailInputNode &
  Pick<
    OtlpRailNode,
    | 'recordKind'
    | 'causeParentIds'
    | 'dependencyParentIds'
    | 'durationMs'
    | 'outcome'
    | 'shortId'
  > & {
    dimmed?: boolean
  }

export interface CauseRailProps {
  nodes: readonly CauseRailCard[]
  selectedId: number
  pathIds?: readonly number[]
  errorPathUntilId?: string
  onSelect: (nodeId: number) => void
  onOpen?: (nodeId: number) => void
  onReroot?: (nodeId: number) => void
}

function laneX(lane: number) {
  return GUTTER_PAD + lane * LANE_GAP
}

function rowY(row: number) {
  return row * ROW_HEIGHT + ROW_HEIGHT / 2
}

function kindColor(kind: string | undefined): string {
  if (kind === 'action') return kindTokens.action
  if (kind === 'atom') return kindTokens.atom
  if (kind === 'computed') return kindTokens.computed
  if (kind === 'effect') return kindTokens.effect
  if (kind === 'log') return kindTokens.log
  return kindTokens.other
}

function durationText(ms: number | undefined): string {
  if (ms === undefined) return 'open'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
}

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

function isDependencyEdge(
  nodes: Map<number, CauseRailCard>,
  fromId: number,
  toId: number,
): boolean {
  const child = nodes.get(toId)
  return child?.dependencyParentIds?.includes(fromId) === true
    && child.causeParentIds?.includes(fromId) !== true
}

const RailRow = ({
  node,
  gutterWidth,
  onSelect,
  onOpen,
  onReroot,
}: {
  node: RailLayoutNode & Partial<CauseRailCard>
  gutterWidth: number
  onSelect: (nodeId: number) => void
  onOpen?: (nodeId: number) => void
  onReroot?: (nodeId: number) => void
}) => {
  const stripe = kindColor(node.recordKind ?? node.kind)
  const outcome = node.outcome ?? (node.hasError ? 'error' : 'ok')
  return (
    <li css={`display: block;`}>
      <button
        type="button"
        data-rail-node={String(node.id)}
        data-dimmed={node.dimmed ? '' : undefined}
        aria-label={`${node.label}${node.hasError ? ' error' : ''} #${node.id}`}
        aria-current={node.isSelected ? 'true' : undefined}
        css:gutter={`${gutterWidth}px`}
        css={`
          ${focusVisible}
          appearance: none;
          box-sizing: border-box;
          width: 100%;
          min-height: ${ROW_HEIGHT}px;
          display: grid;
          align-content: center;
          gap: 0;
          padding: 2px var(--admin-space-8) 2px var(--gutter);
          border: 0;
          border-radius: var(--admin-radius-4);
          background: ${tokens.surface1};
          color: ${tokens.text1};
          text-align: start;
          cursor: pointer;
          box-shadow: ${kindStripe(stripe)};
          &[aria-current='true'] {
            background: ${tokens.surface2};
            outline: 1px solid ${tokens.accent};
            outline-offset: -1px;
          }
          &[data-error] {
            box-shadow: ${kindStripe(tokens.error)};
          }
          &[data-dimmed] {
            opacity: 0.35;
          }
        `}
        data-error={node.hasError ? '' : undefined}
        on:click={() => onSelect(node.id)}
        on:dblclick={() => onReroot?.(node.id)}
        on:keydown={(event: KeyboardEvent) => {
          if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault()
            onReroot?.(node.id)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onOpen?.(node.id)
          }
        }}
      >
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
        <span
          css={`
            ${type.meta}
            display: flex;
            flex-wrap: wrap;
            gap: var(--admin-space-6);
            color: ${tokens.text3};
            font-variant-numeric: tabular-nums;
          `}
        >
          <span>{durationText(node.durationMs)}</span>
          <span>{outcome}</span>
          <span>{`#${node.shortId ?? node.id}`}</span>
          {node.hasError ? (
            <span css={`color: ${tokens.error};`}>error</span>
          ) : null}
        </span>
      </button>
    </li>
  )
}

export const CauseRail = ({
  nodes,
  selectedId,
  pathIds,
  errorPathUntilId,
  onSelect,
  onOpen,
  onReroot,
}: CauseRailProps) => {
  const cards = new Map(nodes.map((node) => [node.id, node]))
  const layout = layoutRailGraph([...nodes], selectedId, pathIds ? [...pathIds] : undefined)
  const gutterWidth = laneX(layout.laneCount - 1) + GUTTER_PAD + 4
  const errorUntil = errorPathUntilId === undefined ? undefined : Number(errorPathUntilId)
  const errorPath = new Set<number>()
  if (errorUntil !== undefined && Number.isFinite(errorUntil)) {
    const path = layout.selectedPathIds
    const stop = path.indexOf(errorUntil)
    const from = stop >= 0 ? stop : 0
    for (const id of path.slice(from)) errorPath.add(id)
  }
  const height = layout.nodes.length * ROW_HEIGHT

  return (
    <div
      data-reatom-name="RailGraph"
      data-rail-graph
      css={`
        container: rail-graph / inline-size;
        min-width: 0;
      `}
    >
      <div
        css={`
          ${scrollable}
          position: relative;
        `}
      >
        <svg:svg
          width={gutterWidth}
          height={height}
          viewBox={`0 0 ${gutterWidth} ${height}`}
          aria-hidden="true"
          css={`
            position: absolute;
            inset-block-start: 0;
            inset-inline-start: 0;
            pointer-events: none;
            overflow: visible;
          `}
        >
          {layout.edges.map((edge) => {
            const dashed = isDependencyEdge(cards, edge.fromId, edge.toId)
            const intoError = cards.get(edge.toId)?.hasError === true
            const onPath = edge.isOnPath
            const errorStroke =
              onPath && (errorPath.has(edge.fromId) || errorPath.has(edge.toId))
            const sourceKind = cards.get(edge.fromId)?.recordKind
            const stroke = errorStroke
              ? tokens.error
              : intoError
                ? tokens.error
                : onPath
                  ? causeThread.color
                  : soft(kindColor(sourceKind), 35)
            return (
              <svg:path
                data-rail-edge={`${edge.fromId}>${edge.toId}`}
                d={edgePath(edge)}
                fill="none"
                stroke={stroke}
                stroke-width={intoError || onPath ? 2 : 1.5}
                stroke-linecap={onPath ? 'square' : 'round'}
                stroke-dasharray={dashed ? '4 3' : undefined}
              />
            )
          })}
          {layout.nodes.map((node) => {
            const card = cards.get(node.id)
            const cx = laneX(node.lane)
            const cy = rowY(node.row)
            const diamond = (card?.parentIds.length ?? 0) > 1
            const color = node.hasError ? tokens.error : causeThread.color
            if (diamond) {
              const size = 3
              return (
                <svg:polygon
                  points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`}
                  fill="none"
                  stroke={color}
                  stroke-width="1.5"
                />
              )
            }
            return (
              <svg:circle
                cx={cx}
                cy={cy}
                r={3}
                fill={node.isOnPath ? color : kindColor(card?.recordKind)}
                stroke={tokens.canvas}
                stroke-width="1"
              />
            )
          })}
        </svg:svg>
        <ol
          aria-label="Cause chain, oldest first"
          css={`
            margin: 0;
            padding: 0;
            list-style: none;
          `}
        >
          {layout.nodes.map((node) => (
            <RailRow
              node={{ ...node, ...cards.get(node.id) }}
              gutterWidth={gutterWidth}
              onSelect={onSelect}
              onOpen={onOpen}
              onReroot={onReroot}
            />
          ))}
        </ol>
      </div>
    </div>
  )
}
