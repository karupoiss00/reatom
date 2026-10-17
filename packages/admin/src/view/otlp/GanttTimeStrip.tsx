import { atom } from '@reatom/core'

import type { Gantt } from '../../gantt'
import {
  collideAxisMarkers,
  markerWindow,
  sessionAxisMarkers,
} from '../../gantt/axisMarkers'
import {
  hoverKindCounts,
  timeAtStripFraction,
  timeStripModel,
} from '../../gantt/timeStrip'
import type { AdminRecord, OtlpAdmin } from '../../otlp'
import {
  barHatch,
  focusVisible,
  kindTokens,
  reducedMotion,
  tokens,
  type,
} from '../design-system'
import { kindShareColorVar } from '../../otlp'

const STRIP_HEIGHT = 30

function kindColor(kind: string): string {
  return kindTokens[kindShareColorVar(kind)]
}

export const GanttTimeStrip = ({
  gantt,
  admin,
}: {
  gantt: Gantt<AdminRecord>
  admin: OtlpAdmin
}) => {
  const hover = atom('', `_Admin.gantt.strip.hover`)
  return (
    <div
      data-testid="gantt-time-strip"
      role="slider"
      tabindex={0}
      aria-label="Session time strip"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={() => {
        const range = gantt.range()
        const view = gantt.visibleTime()
        if (range === null || view === null || range.end <= range.start) return 0
        return Math.round(((view.start - range.start) / (range.end - range.start)) * 100)
      }}
      title={() => hover() || 'Drag to pan the timeline'}
      css={`
        position: relative;
        height: ${STRIP_HEIGHT}px;
        margin-inline: var(--admin-space-8);
        margin-block: var(--admin-space-4);
        background: ${tokens.surface2};
        border: 1px solid ${tokens.border1};
        border-radius: var(--admin-radius-2);
        overflow: hidden;
        cursor: ew-resize;
        touch-action: none;
        ${focusVisible}
        ${reducedMotion}
      `}
      on:keydown={(event: KeyboardEvent) => {
        const view = gantt.visibleTime()
        if (view === null) return
        const span = view.end - view.start
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          gantt.pan(-span * 0.15)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          gantt.pan(span * 0.15)
        }
      }}
      on:pointerdown={(event: PointerEvent) => {
        if (event.button !== 0) return
        const range = gantt.range()
        const strip = event.currentTarget
        if (range === null || !(strip instanceof HTMLElement)) return
        const rect = strip.getBoundingClientRect()
        if (rect.width <= 0) return
        const fraction = (event.clientX - rect.left) / rect.width
        const time = timeAtStripFraction(range, fraction)
        const view = gantt.visibleTime()
        if (view === null) {
          gantt.scrollToTime(time)
          return
        }
        const half = (view.end - view.start) / 2
        gantt.timeWindow.set({ start: time - half, end: time + half })
        strip.setPointerCapture(event.pointerId)
      }}
      on:pointermove={(event: PointerEvent) => {
        const range = gantt.range()
        const strip = event.currentTarget
        if (range === null || !(strip instanceof HTMLElement)) return
        const rect = strip.getBoundingClientRect()
        if (rect.width <= 0) return
        const fraction = (event.clientX - rect.left) / rect.width
        const model = timeStripModel(
          admin.ganttRecords(),
          range,
          gantt.visibleTime(),
          {
            paused: admin.paused(),
            dropped: false,
          },
        )
        if (model === null) {
          hover.set('')
          return
        }
        const counts = hoverKindCounts(model, fraction)
        hover.set(
          counts.length === 0
            ? ''
            : counts.map((entry) => `${entry.kind} ${entry.count}`).join(' · '),
        )
        if (!strip.hasPointerCapture(event.pointerId)) return
        const time = timeAtStripFraction(range, fraction)
        const view = gantt.visibleTime()
        if (view === null) return
        const half = (view.end - view.start) / 2
        gantt.timeWindow.set({ start: time - half, end: time + half })
      }}
      on:pointerleave={() => hover.set('')}
    >
      {() => {
        const range = gantt.range()
        const model = timeStripModel(
          admin.ganttRecords(),
          range,
          gantt.visibleTime(),
          { paused: admin.paused(), dropped: false },
        )
        if (model === null) return null
        return (
          <div
            css={`
              position: absolute;
              inset: 0;
            `}
          >
            {model.stacks.map((stack) => (
              <div
                style:left={`${stack.left * 100}%`}
                style:width={`${stack.width * 100}%`}
                css={`
                  position: absolute;
                  top: 0;
                  bottom: 0;
                  display: flex;
                  flex-direction: column-reverse;
                `}
              >
                {stack.kinds.map((entry) => (
                  <span
                    style:height={`${entry.share * 100}%`}
                    css={`
                      display: block;
                      background: ${kindColor(entry.kind)};
                      opacity: 0.55;
                    `}
                  />
                ))}
              </div>
            ))}
            {model.gaps.map((gap) => (
              <div
                style:left={`${gap.left * 100}%`}
                style:width={`${gap.width * 100}%`}
                css={`
                  position: absolute;
                  inset-block: 0;
                  background: ${barHatch};
                  pointer-events: none;
                `}
              />
            ))}
            {model.errorTicks.map((tick) => (
              <span
                style:left={`${tick * 100}%`}
                css={`
                  position: absolute;
                  top: 0;
                  bottom: 0;
                  width: 2px;
                  background: ${tokens.error};
                  pointer-events: none;
                `}
              />
            ))}
            {model.viewport ? (
              <div
                style:left={`${model.viewport.left * 100}%`}
                style:width={`${model.viewport.width * 100}%`}
                css={`
                  position: absolute;
                  inset-block: 0;
                  box-shadow: inset 0 0 0 1px ${tokens.accent};
                  pointer-events: none;
                `}
              />
            ) : null}
          </div>
        )
      }}
    </div>
  )
}

export const GanttAxisMarkers = ({
  gantt,
  admin,
}: {
  gantt: Gantt<AdminRecord>
  admin: OtlpAdmin
}) => {
  const expanded = atom<number | null>(null, `_Admin.gantt.markers.hover`)
  return (
    <div
      data-testid="gantt-axis-markers"
      css={`
        position: absolute;
        inset: 0;
        pointer-events: none;
      `}
    >
      {() => {
        const time = gantt.visibleTime()
        if (time === null) return null
        const markers = collideAxisMarkers(
          sessionAxisMarkers(admin.ganttRecords()),
          time,
          400,
        )
        if (markers.length === 0) return null
        return markers.map((marker, index) => (
          <button
            type="button"
            title={
              marker.extra > 0
                ? marker.members.map((entry) => entry.label).join(', ')
                : marker.label
            }
            style:left={`${((marker.time - time.start) / (time.end - time.start)) * 100}%`}
            css={`
              position: absolute;
              top: 0;
              bottom: 0;
              width: 0;
              padding: 0;
              border: 0;
              background: transparent;
              pointer-events: auto;
              cursor: pointer;
              ${focusVisible}
              &::before {
                content: '';
                position: absolute;
                top: 0;
                bottom: 0;
                left: 0;
                border-left: 1px dashed ${tokens.text3};
              }
            `}
            on:click={() => {
              const range = gantt.range()
              if (range === null) return
              gantt.timeWindow.set(markerWindow(marker.time, range))
              gantt.scrollToTime(marker.time)
            }}
            on:pointerenter={() => expanded.set(index)}
            on:pointerleave={() => expanded.set(null)}
          >
            <span
              css={`
                ${type.meta}
                position: absolute;
                top: 2px;
                left: 4px;
                color: ${tokens.text2};
                white-space: nowrap;
                background: ${tokens.surface1};
              `}
            >
              {() =>
                expanded() === index && marker.extra > 0
                  ? marker.members.map((entry) => entry.label).join(' · ')
                  : marker.label
              }
            </span>
          </button>
        ))
      }}
    </div>
  )
}
