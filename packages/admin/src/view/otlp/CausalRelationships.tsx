import { atom, computed, reatomVirtual } from '@reatom/core'

import type { OtlpAdmin } from '../../otlp'
import { recordLabel } from '../../otlp'
import {
  Button,
  RailGraph,
  SearchField,
  Tabs,
  scrollable,
  tokens,
  truncate,
  type,
} from '../design-system'
import { KindMark } from './KindMark'
import { recordKindIcon } from './recordKind'

let serial = 0

/**
 * Product detail: exact scoped neighbors, independent of the bounded bus
 * geometry.
 */
export function CausalRelationships({ admin }: { admin: OtlpAdmin }) {
  const model = admin.causal,
    name = `_Admin.causal.relationships.${++serial}`,
    query = atom('', `${name}.query`)
  const counts = computed(() => {
    const key = model.selectedRow()?.key,
      relations = model.rawRelations()
    return {
      causes: key ? (relations.incoming.get(key)?.length ?? 0) : 0,
      effects: key ? (relations.outgoing.get(key)?.length ?? 0) : 0,
    }
  }, `${name}.counts`)
  const entries = computed(() => {
    const key = model.selectedRow()?.key
    if (!key) return []
    const direction = model.relationshipDirection(),
      relations = model.rawRelations(),
      graph = model.graph()
    const search = query().trim().toLowerCase()
    const edges =
      (direction === 'causes' ? relations.incoming : relations.outgoing).get(
        key,
      ) ?? []
    return edges.filter((edge) => {
      const event = graph.events.get(
        direction === 'causes' ? edge.from : edge.to,
      )!
      return (
        !search ||
        `${recordLabel(event.record)} ${event.record.id}`
          .toLowerCase()
          .includes(search)
      )
    })
  }, `${name}.entries`)
  const virtual = reatomVirtual(
    entries,
    {
      itemSize: 76,
      overscan: 2,
      viewportSize: 288,
      stickToEnd: atom(false, `${name}.follow`),
    },
    `${name}.virtual`,
  )
  const rows = virtual.reatomMap((edge) => {
    const target = () =>
      model.relationshipDirection() === 'causes' ? edge.from : edge.to
    const event = () => model.graph().events.get(target())!
    const drawable = () =>
      model.sections.graph() && model.buses().edgeByKey.has(edge.key)
    return (
      <li
        aria-posinset={() =>
          virtual().offset + virtual().items.indexOf(edge) + 1
        }
        aria-setsize={() => entries().length}
        data-causal-relation={edge.key}
        css={`
          height: 76px;
          box-sizing: border-box;
          padding: 4px 0;
          border-bottom: 1px solid ${tokens.border1};
          display: grid;
          gap: 2px;
          min-width: 0;
        `}
      >
        <div
          css={`
            ${type.data} display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
          `}
        >
          {() => (
            <KindMark
              kind={recordKindIcon(event().record, admin.mountLogIds())}
            />
          )}
          <span
            title={() => recordLabel(event().record)}
            css={`
              ${truncate} direction: rtl;
              text-align: left;
            `}
          >
            {() => recordLabel(event().record)}
          </span>
        </div>
        <span
          title={() => event().record.id}
          css={`
            ${type.meta} ${truncate} color: ${tokens.text3};
          `}
        >
          {() =>
            `${!model.sections.graph() ? 'Graph hidden' : drawable() ? 'Recorded relation' : 'Endpoint hidden by filters'} · ${event().record.frameId ?? event().record.spanId}`
          }
        </span>
        <div css="display: flex; gap: 6px;">
          <Button
            label={`Trace ${recordLabel(event().record)}`}
            disabled={() => !drawable()}
            title={() =>
              !model.sections.graph()
                ? 'Show Graph to trace this relationship'
                : drawable()
                  ? 'Trace this exact relationship without changing selection'
                  : 'Reveal the hidden endpoint before tracing'
            }
            onClick={() => model.tracedEdgeKey.set(edge.key)}
          >
            Trace
          </Button>
          <Button
            label={`Go to ${recordLabel(event().record)}`}
            onClick={() => {
              admin.selectRecord(event().record)
              const visible = model.visible()
              let index = 0
              for (let row = visible.head; row; row = row[visible.LL_NEXT]) {
                if (row.key === target()) {
                  model.virtual.scrollToIndex(index, 'nearest')
                  break
                }
                index++
              }
            }}
          >
            Go to event
          </Button>
        </div>
      </li>
    )
  }, `${name}.rows`)
  return (
    <div
      aria-label="Recorded relationships"
      css="display: grid; gap: 8px; min-width: 0;"
    >
      <p
        css={`
          ${type.meta} margin: 0;
          color: ${tokens.text2};
        `}
      >
        {() =>
          `${counts().causes} recorded causes · ${counts().effects} recorded effects`
        }
      </p>
      {() => {
        const anchor = model.selectedRow()?.key
        if (
          !anchor ||
          counts().causes + counts().effects > 8 ||
          counts().causes + counts().effects === 0
        )
          return null
        const graph = model.graph(),
          relations = model.rawRelations()
        const members = new Set([anchor])
        for (const edge of [
          ...(relations.incoming.get(anchor) ?? []),
          ...(relations.outgoing.get(anchor) ?? []),
        ]) {
          members.add(edge.from)
          members.add(edge.to)
        }
        const keys = [...members],
          ids = new Map(
            keys.map((key) => [
              key,
              Number(graph.events.get(key)!.record.frameId),
            ]),
          )
        // RailGraph displays its numeric IDs. Never substitute local indices
        // for missing, nonnumeric or colliding telemetry frame identities.
        if (
          keys.some(
            (key) =>
              graph.events.get(key)!.record.frameId === undefined ||
              !Number.isFinite(ids.get(key)),
          ) ||
          new Set(ids.values()).size !== keys.length
        )
          return null
        const byId = new Map(keys.map((key) => [ids.get(key)!, key]))
        const nodes = keys.map((key) => {
          const record = graph.events.get(key)!.record
          return {
            id: ids.get(key)!,
            label: recordLabel(record),
            kind:
              record.reatomKind === 'action'
                ? ('action' as const)
                : ('state' as const),
            timestamp: record.start,
            parentIds: (graph.parents.get(key) ?? [])
              .filter((parent) => ids.has(parent))
              .map((parent) => ids.get(parent)!),
            hasError: !!record.error,
          }
        })
        return (
          <RailGraph
            nodes={nodes}
            selectedId={ids.get(anchor)!}
            onSelect={(id) =>
              admin.selectRecord(graph.events.get(byId.get(id)!)!.record)
            }
            onReroot={(id) =>
              admin.selectRecord(graph.events.get(byId.get(id)!)!.record)
            }
          />
        )
      }}
      <Tabs
        value={model.relationshipDirection}
        ariaLabel="Relationship direction"
        items={[
          { id: 'causes', label: 'Causes' },
          { id: 'effects', label: 'Effects' },
        ]}
      />
      <SearchField
        value={query}
        label="Find related record"
        placeholder="Find a recorded event…"
        shortcut=""
      />
      <p
        role="status"
        css={`
          ${type.meta} margin: 0;
          color: ${tokens.text2};
        `}
      >
        {() =>
          `${entries().length} ${model.relationshipDirection()}${query().trim() ? ' match' : ' in this scope'}`
        }
      </p>
      <div
        css={`
          ${scrollable} height: 288px;
          min-height: 0;
          overflow-anchor: none;
        `}
        ref={virtual.bindScroller}
      >
        <div style:height={() => `${virtual.padding().before}px`} />
        <ol
          aria-label="Related records"
          css="list-style: none; padding: 0; margin: 0; position: sticky;"
          style:top={() => `${virtual.stickyInset()}px`}
          style:bottom={() => `${virtual.stickyInset()}px`}
        >
          {rows}
        </ol>
        <div style:height={() => `${virtual.padding().after}px`} />
        {() =>
          !entries().length ? (
            <p
              css={`
                ${type.meta} color: ${tokens.text3};
              `}
            >
              {query().trim()
                ? 'No matching recorded events'
                : model.selectedRow()?.synthetic()
                  ? 'Causal links not yet available'
                  : `No recorded ${model.relationshipDirection()} in this scope`}
            </p>
          ) : null
        }
      </div>
      {() => {
        const key = model.selectedRow()?.key
        if (!key) return null
        const relations = model.rawRelations()
        const outside =
          (relations.excludedIncoming.get(key) ?? 0) +
          (relations.excludedOutgoing.get(key) ?? 0)
        const boundaries = relations.boundaries.get(key) ?? []
        return boundaries.length || outside ? (
          <p
            css={`
              ${type.meta} margin: 0;
              color: ${tokens.text3};
            `}
          >
            {outside ? `${outside} relationships outside scope. ` : ''}
            {boundaries.join('. ')}
          </p>
        ) : null
      }}
      <Button
        label="Clear relationship trace"
        disabled={() => !model.tracedEdgeKey()}
        onClick={() => model.tracedEdgeKey.set(null)}
      >
        Clear trace
      </Button>
    </div>
  )
}
