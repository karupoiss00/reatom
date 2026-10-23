import { atom, computed, effect, peek, reatomLinkedList } from '@reatom/core'

import { crossingBuses } from '../../causal/buses'
import type { OtlpAdmin } from '../../otlp'
import { recordLabel } from '../../otlp'
import { Button, tokens, truncate, type } from '../design-system'
import { adminSettings } from '../settings'

let counter = 0
interface Continuation {
  key: string
  anchor: string
  label: string
  above: boolean
  count: number
  direction: string
}

/** Keep the strip and surviving controls mounted while the viewport moves. */
export function CausalContinuations({ admin }: { admin: OtlpAdmin }) {
  const model = admin.causal,
    settings = adminSettings(),
    name = `_Admin.causal.continuations.${++counter}`
  const shown = computed(
    () => settings.graphContinuations() && model.sections.graph(),
    `${name}.shown`,
  )
  const viewport = computed((previous?: { first: number; last: number }) => {
    const height = model.rowHeight(),
      offset = model.virtual.scrollOffset()
    const first = Math.floor(offset / height)
    const last = Math.ceil((offset + model.virtual.viewportSize()) / height) - 1
    return previous?.first === first && previous.last === last
      ? previous
      : { first, last }
  }, `${name}.viewport`)
  const ports = computed((): Continuation[] => {
    if (!shown() || !model.visible().size) return []
    const layout = model.buses(),
      { first, last } = viewport()
    return crossingBuses(layout, first, last).flatMap((route) => {
      const rank = layout.ranks.get(route.anchor)!
      if (rank >= first && rank <= last) return []
      const label = recordLabel(model.graph().events.get(route.anchor)!.record),
        above = rank < first
      return [
        {
          // A changed destination/name is a new control; count updates stay on
          // the same handle, and ordinary pixel scrolling does not remount it.
          key: JSON.stringify([route.key, above, label]),
          anchor: route.anchor,
          label,
          above,
          count: route.edges.length,
          direction:
            route.direction === 'causes'
              ? 'causes converge on'
              : 'effects from',
        },
      ]
    })
  }, `${name}.ports`)
  const items = reatomLinkedList(
    (entry: Continuation) => ({
      key: entry.key,
      entry: atom(entry, `${name}.${entry.key}`),
    }),
    `${name}.items`,
  )
  type Item = ReturnType<typeof items.create>
  const handles = new Map<string, Item>()
  const controls = items.reatomMap((item) => {
    const initial = item.entry()
    return (
      <span
        data-causal-continuation={initial.key}
        css="display: inline-flex; flex: none;"
        ref={(element) => {
          if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return
          const motion = getComputedStyle(element)
            .getPropertyValue('--admin-motion-overlay')
            .trim()
          const duration =
            parseFloat(motion) * (motion.endsWith('ms') ? 1 : 1000)
          const animation = element.animate(
            [
              { opacity: 0, transform: 'translateY(2px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            {
              duration: Number.isFinite(duration) ? duration : 160,
              easing: 'ease-out',
            },
          )
          return () => animation.cancel()
        }}
      >
        <Button
          label={`Go to ${initial.label} ${initial.above ? 'above' : 'below'}`}
          title={() => {
            const entry = item.entry()
            return `${entry.count} ${entry.direction} ${entry.label}`
          }}
          onClick={() => {
            // Resolve current data rather than the layout when it first
            // entered the strip: appends and late causes can change ranks.
            const { anchor } = item.entry(),
              event = model.graph().events.get(anchor)
            const rank = model.buses().ranks.get(anchor)
            if (!event || rank === undefined) return
            admin.selectRecord(event.record)
            model.virtual.scrollToIndex(rank, 'nearest')
          }}
        >
          <span
            css={`
              ${truncate} max-width: 24ch;
            `}
          >
            {initial.above ? '↑' : '↓'} {initial.label}
          </span>
          <span css="font-variant-numeric: tabular-nums;">
            · {() => item.entry().count}
          </span>
        </Button>
      </span>
    )
  })
  return (
    <div
      role="region"
      aria-label="Graph continuations"
      style:display={() => (shown() ? 'flex' : 'none')}
      css={`
        ${type.meta} align-items: center;
        gap: 8px;
        padding: 3px 8px;
        height: 36px;
        box-sizing: border-box;
        flex: none;
        overflow-x: auto;
        white-space: nowrap;
        border-bottom: 1px solid ${tokens.border1};
      `}
      ref={() => {
        const sync = effect(() => {
          const next = ports()
          peek(() => {
            const keys = new Set(next.map((entry) => entry.key))
            items.batch(() => {
              for (const [key, item] of handles)
                if (!keys.has(key)) {
                  items.remove(item)
                  handles.delete(key)
                }
              let after: Item | null = null
              for (const entry of next) {
                let item = handles.get(entry.key)
                if (!item) {
                  item = items.create(entry)
                  handles.set(entry.key, item)
                } else if (item.entry().count !== entry.count)
                  item.entry.set(entry)
                if (item[items.LL_PREV] !== after) items.move(item, after)
                after = item
              }
            })
          })
        }, `${name}.sync`)
        return () => sync.unsubscribe()
      }}
    >
      <span css="display: contents;">{controls}</span>
      <span
        style:display={() =>
          shown() && model.buses().omittedRelationCount ? '' : 'none'
        }
        title="These relationships remain available from their endpoint counts; their tracks are summarized to keep this graph legible."
      >
        {() =>
          shown()
            ? `${model.buses().omittedRelationCount} relationships summarized`
            : ''
        }
      </span>
      <span
        style:display={() =>
          shown() && !ports().length && !model.buses().omittedRelationCount
            ? ''
            : 'none'
        }
      >
        {() => {
          if (!shown()) return ''
          const layout = model.buses()
          return `${layout.routes.length} routes · ${layout.relationCount} visible relationships`
        }}
      </span>
    </div>
  )
}
