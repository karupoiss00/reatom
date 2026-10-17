import type { OtlpAdmin, OtlpGraphDepth } from '../../otlp'
import { focusKeepIds } from '../../otlp'
import {
  Button,
  SearchField,
  kindTokens,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { CauseRail } from './CauseRail'
import { GraphEmptyState } from './emptyStates'
import { StateInspector } from './StateInspector'

const directions = ['ancestors', 'descendants', 'full'] as const
const depths: Array<{ id: OtlpGraphDepth; label: string }> = [
  { id: 1, label: '1-hop' },
  { id: 2, label: '2-hop' },
  { id: 'all', label: 'all' },
]

export const OtlpStateView = ({ admin }: { admin: OtlpAdmin }) => {
  return (
    <div
      css={`
        display: grid;
        height: 100%;
        min-height: 0;
      `}
    >
      <h2 css={visuallyTitle}>State</h2>
      <StateInspector admin={admin} />
    </div>
  )
}

function kindInGraph(kind: string): boolean {
  return (
    kind === 'action' ||
    kind === 'atom' ||
    kind === 'computed' ||
    kind === 'effect'
  )
}

export const OtlpGraphView = ({ admin }: { admin: OtlpAdmin }) => {
  return (
    <div
      css={`
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr) 22px;
        height: 100%;
        min-height: 0;
        background: ${tokens.canvas};
        background-image: radial-gradient(
          ${tokens.graphDot} 1px,
          transparent 1px
        );
        background-size: 16px 16px;
        background-color: ${tokens.canvas};
      `}
    >
      <h2 css={visuallyTitle}>Graph</h2>
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--admin-space-6);
          padding: var(--admin-space-8);
        `}
      >
        {directions.map((direction) => (
          <Button
            variant="ghost"
            label={direction}
            pressed={() => admin.graphDirection() === direction}
            onClick={() => admin.graphDirection.set(direction)}
          >
            {direction}
          </Button>
        ))}
        {depths.map((depth) => (
          <Button
            variant="ghost"
            label={depth.label}
            pressed={() => admin.graphDepth() === depth.id}
            onClick={() => admin.graphDepth.set(depth.id)}
          >
            {depth.label}
          </Button>
        ))}
      </div>
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--admin-space-8);
          padding: 0 var(--admin-space-8) var(--admin-space-8);
          align-items: end;
        `}
      >
        <label
          css={`
            ${type.meta}
            display: grid;
            gap: var(--admin-space-4);
            color: ${tokens.text2};
            min-width: 12rem;
          `}
        >
          Find path from
          <select
            aria-label="Find path from"
            prop:value={() => admin.graphPathFrom() ?? ''}
            on:change={(event: Event) => {
              const target = event.currentTarget
              if (!(target instanceof HTMLSelectElement)) return
              admin.graphPathFrom.set(target.value === '' ? null : target.value)
            }}
            css={`
              ${type.data}
              height: var(--admin-control-height);
              background: ${tokens.surface2};
              color: ${tokens.text1};
              border: 1px solid ${tokens.border1};
              border-radius: var(--admin-radius-4);
            `}
          >
            <option value="">Select a frame</option>
            {() => {
              const selected = admin.selectedRecord()
              const traceId = selected?.traceId
              const frames = admin
                .records()
                .filter(
                  (entry) =>
                    entry.frameId !== undefined &&
                    (traceId === undefined || entry.traceId === traceId),
                )
              const seen = new Set<string>()
              return frames.flatMap((entry) => {
                const id = entry.frameId!
                if (seen.has(id)) return []
                seen.add(id)
                return [
                  <option value={id}>
                    {`#${id} ${entry.atomName ?? entry.name}`}
                  </option>,
                ]
              })
            }}
          </select>
        </label>
        <SearchField
          value={admin.graphFocus}
          label="Focus"
          placeholder="Focus…"
          shortcut=""
        />
        <Button
          variant="ghost"
          label="Clear graph focus"
          onClick={() => {
            admin.graphFocus.set('')
            admin.graphPathFrom.set(null)
            admin.graphDepth.set('all')
          }}
        >
          Clear
        </Button>
      </div>
      <div
        css={`
          ${scrollable}
          min-height: 0;
          padding: var(--admin-space-8);
        `}
      >
        {() => {
          const nodes = admin.railNodes()
          if (nodes.length === 0) {
            return <GraphEmptyState admin={admin} />
          }
          const selected = Number(admin.selectedRootFrameId())
          const selectedId = Number.isFinite(selected) ? selected : nodes[0]!.id
          const focus = admin.graphFocus().trim().toLowerCase()
          const focusRoot =
            focus === ''
              ? selectedId
              : (nodes.find((node) =>
                  node.label.toLowerCase().includes(focus),
                )?.id ?? selectedId)
          const keep =
            focus === '' ? null : focusKeepIds(nodes, focusRoot)
          const cards = nodes.map((node) => ({
            ...node,
            dimmed: keep !== null && !keep.has(node.id),
          }))
          return (
            <CauseRail
              nodes={cards}
              selectedId={selectedId}
              pathIds={admin.graphPathIds()}
              errorPathUntilId={admin.causeThread().errorAncestorFrameId}
              onSelect={(nodeId) => admin.selectFrame(nodeId)}
              onOpen={(nodeId) => {
                admin.selectFrame(nodeId)
                admin.cardOpen.setTrue()
              }}
              onReroot={(nodeId) => admin.selectFrame(nodeId)}
            />
          )
        }}
      </div>
      <footer
        css={`
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--admin-space-8);
          height: 22px;
          padding-inline: var(--admin-space-8);
          border-top: 1px solid ${tokens.border1};
          background: ${tokens.surface1};
          ${type.meta}
          color: ${tokens.text3};
        `}
      >
        {() => {
          const kinds = new Set(
            admin.railNodes().map((node) => node.recordKind),
          )
          const dots = ['action', 'atom', 'computed', 'effect'].filter((kind) =>
            kinds.has(kind),
          )
          return dots.map((kind) => (
            <span
              css={`
                display: inline-flex;
                align-items: center;
                gap: var(--admin-space-4);
              `}
            >
              <span
                css={`
                  width: 6px;
                  height: 6px;
                  border-radius: 999px;
                  background: ${kindInGraph(kind) ? kindTokens[kind as 'action'] : kindTokens.other};
                `}
              />
              {kind}
            </span>
          ))
        }}
        <span>Click reroot · Enter open · Esc close</span>
      </footer>
    </div>
  )
}

const visuallyTitle = `
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`
