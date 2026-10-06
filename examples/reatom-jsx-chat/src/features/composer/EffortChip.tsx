import { catalogById } from '../../catalog'
import type { ReasoningEffort } from '../../storage/types'
import { Chip, Menu } from '../../ui'
import type { ChatSlotProps } from '../slots'
import {
  effortsFor,
  shownEffort,
  watchUnsupportedSwitch,
  writeReasoningEffort,
} from '../settings/chat/AdvancedSection'

const chevronCount = 5

const chevronPath = (index: number) => `m${2 + index * 4} 4.5 4.5 7.5 -4.5 7.5`

const marksByEffort: Record<ReasoningEffort, number> = {
  none: 1,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 4,
  max: 5,
}

const colorByEffort: Record<ReasoningEffort, string> = {
  none: 'var(--success)',
  minimal: 'var(--success)',
  low: 'var(--success)',
  medium: 'var(--warning)',
  high: 'var(--accent)',
  xhigh: 'var(--accent)',
  max: 'var(--danger)',
}

const EffortMarks = ({ effort }: { effort: ReasoningEffort }) => {
  const marks = marksByEffort[effort]
  return (
    <svg:svg
      viewBox="0 4 24 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      data-effort={effort}
      data-marks={marks}
      attr:aria-hidden="true"
      css={`
        display: block;
        width: 1.5rem;
        height: 1rem;
        color: ${colorByEffort[effort]};
      `}
    >
      {Array.from({ length: chevronCount }, (_, index) => (
        <svg:path
          d={chevronPath(index)}
          opacity={index < marks ? '1' : '0.25'}
        />
      ))}
    </svg:svg>
  )
}

export const EffortChip = ({ chat }: ChatSlotProps) => (
  <span
    data-slot="EffortChip"
    css="display: contents;"
    ref={() => watchUnsupportedSwitch(chat)}
  >
    {() => {
      const model = catalogById().get(chat.model() ?? '') ?? null
      const efforts = effortsFor(model)
      if (efforts.length === 0) return null
      const selected = shownEffort(chat.settings().params, efforts)
      const label = `Effort: ${selected}`
      return (
        <Menu
          label={label}
          placement="top-start"
          items={() => {
            const current = effortsFor(
              catalogById().get(chat.model() ?? '') ?? null,
            )
            const currentEffort = shownEffort(chat.settings().params, current)
            return current.map((effort) => ({
              label: effort,
              selected: effort === currentEffort,
              onSelect: () => writeReasoningEffort(chat, effort, current),
            }))
          }}
          trigger={(props) => (
            <Chip {...props} caret attr:aria-label={label}>
              <EffortMarks effort={selected} />
            </Chip>
          )}
        />
      )
    }}
  </span>
)