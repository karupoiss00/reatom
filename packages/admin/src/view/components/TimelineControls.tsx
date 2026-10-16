import type { Admin } from '../../index'
import { Button, size } from '../design-system'
import {
  colors,
  flex,
  flexWrap,
  focusVisible,
  gap,
  hideInCompactShell,
  inputLike,
} from '../styles'

export interface TimelineControlsProps {
  admin: Admin
}

const controlLabel = `
  display: grid;
  gap: 0.35rem;
  color: ${colors.textMuted};
  font-size: 0.76rem;
  min-width: 0;
`

const rangeControl = `
  box-sizing: border-box;
  height: ${size.control};
  margin: 0;
  min-width: 0;
  accent-color: ${colors.accent};
  ${focusVisible}
`

export const TimelineControls = ({ admin }: TimelineControlsProps) => {
  const windowSizeMs = () => admin.timeline.effectiveBucketSize()

  const parseRangeInput = (
    event: Event,
    onValue: (value: number) => void,
  ): void => {
    const target = event.currentTarget
    if (!(target instanceof HTMLInputElement)) return
    const nextValue = Number.parseInt(target.value, 10)
    if (Number.isNaN(nextValue)) return
    onValue(nextValue)
  }

  return (
    <div
      css={`
        ${flex}
        ${gap(2)}
        ${flexWrap}
        align-items: end;

        @container admin-shell (max-width: 680px) {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.65rem;
        }
      `}
    >
      <label css={controlLabel}>
        Window (ms)
        <input
          type="number"
          min={10}
          step={10}
          prop:value={windowSizeMs}
          on:input={(event: Event) => {
            const target = event.currentTarget
            if (!(target instanceof HTMLInputElement)) return
            const nextValue = Number.parseInt(target.value, 10)
            if (Number.isNaN(nextValue) || nextValue < 10) return
            admin.timeline.useAutoFit.setFalse()
            admin.timeline.bucketSize.set(nextValue)
          }}
          css={`
            ${inputLike} height: ${size.control};
          `}
        />
      </label>

      <label css={controlLabel}>
        Detail
        <input
          type="range"
          min={1}
          max={8}
          step={1}
          prop:value={admin.timeline.zoom}
          on:input={(event: Event) => {
            parseRangeInput(event, (nextValue) => {
              if (nextValue < 1) return
              admin.timeline.zoom.set(nextValue)
            })
          }}
          css={rangeControl}
        />
      </label>

      <Button
        variant="secondary"
        label="Auto-fit session"
        onClick={() => admin.timeline.applyAutoFit()}
      />

      <Button
        variant="ghost"
        label="Reset timeline"
        onClick={() => admin.timeline.resetTimeline()}
      />

      <details
        css={`
          ${hideInCompactShell}
          min-width: 0;

          @container admin-shell (max-width: 680px) {
            grid-column: 1 / -1;
          }
        `}
      >
        <summary
          css={`
            cursor: pointer;
            color: ${colors.textMuted};
            font-size: 0.76rem;
            white-space: nowrap;
            width: fit-content;
          `}
        >
          Advanced pan
        </summary>
        <label
          css={`
            ${controlLabel} margin-top: 0.55rem;
          `}
        >
          Pan offset
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            prop:value={admin.timeline.offset}
            on:input={(event: Event) => {
              const target = event.currentTarget
              if (!(target instanceof HTMLInputElement)) return
              const nextValue = Number.parseFloat(target.value)
              if (Number.isNaN(nextValue)) return
              admin.timeline.offset.set(nextValue)
            }}
            css={rangeControl}
          />
        </label>
      </details>
    </div>
  )
}
