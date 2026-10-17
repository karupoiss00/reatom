import { tokens } from '../design-system'
import type { WritePoint } from '../../otlp'

function numericExtent(points: readonly WritePoint[]): { min: number; max: number } {
  let min = 0
  let max = 1
  let seen = false
  for (const point of points) {
    if (point.numeric === undefined) continue
    if (!seen) {
      min = point.numeric
      max = point.numeric
      seen = true
      continue
    }
    min = Math.min(min, point.numeric)
    max = Math.max(max, point.numeric)
  }
  if (min === max) {
    min -= 0.5
    max += 0.5
  }
  return { min, max }
}

function timeExtent(points: readonly WritePoint[]): { min: number; max: number } {
  const min = points[0]?.start ?? 0
  const max = points.at(-1)?.start ?? min + 1
  return { min, max: max === min ? max + 1 : max }
}

export const HistoryStepChart = ({
  points,
  onSelect,
}: {
  points: readonly WritePoint[]
  onSelect: (recordId: string) => void
}) => {
  const width = 220
  const height = 72
  const pad = 6
  const values = numericExtent(points)
  const time = timeExtent(points)
  const x = (start: number) =>
    pad + ((start - time.min) / (time.max - time.min)) * (width - pad * 2)
  const y = (value: number) =>
    height - pad - ((value - values.min) / (values.max - values.min)) * (height - pad * 2)
  const path: string[] = []
  points.forEach((point, index) => {
    if (point.numeric === undefined) return
    const px = x(point.start)
    const py = y(point.numeric)
    if (index === 0 || points[index - 1]?.numeric === undefined) {
      path.push(`M ${px} ${py}`)
      return
    }
    const previous = points[index - 1]!
    path.push(`H ${px} V ${py}`)
    void previous
  })
  return (
    <svg:svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Write history"
      css={`
        display: block;
        max-width: 100%;
      `}
    >
      <svg:path
        d={path.join(' ')}
        fill="none"
        stroke={tokens.accent}
        stroke-width="1.5"
        stroke-linejoin="miter"
        stroke-linecap="square"
      />
      {points.map((point) =>
        point.numeric === undefined ? null : (
          <svg:circle
            cx={x(point.start)}
            cy={y(point.numeric)}
            r="3"
            fill={point.hasErrorCause ? tokens.error : tokens.accent}
            css={`cursor: pointer;`}
            on:click={() => onSelect(point.record.id)}
          />
        ),
      )}
    </svg:svg>
  )
}

export const TickSparkline = ({
  points,
  mode,
}: {
  points: readonly WritePoint[]
  mode: 'step' | 'ticks'
}) => {
  const width = 60
  const height = 14
  if (points.length === 0) return null
  const time = timeExtent(points)
  const x = (start: number) =>
    ((start - time.min) / (time.max - time.min)) * Math.max(width - 2, 1)
  if (mode === 'ticks') {
    return (
      <svg:svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {points.map((point) => (
          <svg:rect
            x={x(point.start)}
            y="2"
            width="1"
            height="10"
            fill={point.hasErrorCause ? tokens.error : tokens.text3}
            opacity={point === points.at(-1) ? '1' : '0.45'}
          />
        ))}
        <svg:circle
          cx={x(points.at(-1)!.start) + 1}
          cy={7}
          r="1.5"
          fill={points.at(-1)!.hasErrorCause ? tokens.error : tokens.accent}
        />
      </svg:svg>
    )
  }
  const values = numericExtent(points)
  const y = (value: number) =>
    height - 2 - ((value - values.min) / (values.max - values.min)) * (height - 4)
  const path: string[] = []
  points.forEach((point, index) => {
    if (point.numeric === undefined) return
    const px = x(point.start)
    const py = y(point.numeric)
    if (index === 0) path.push(`M ${px} ${py}`)
    else path.push(`H ${px} V ${py}`)
  })
  const last = points.at(-1)
  return (
    <svg:svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <svg:path
        d={path.join(' ')}
        fill="none"
        stroke={tokens.accent}
        stroke-width="1"
        stroke-linejoin="miter"
      />
      {last?.numeric === undefined ? null : (
        <svg:circle
          cx={x(last.start)}
          cy={y(last.numeric)}
          r="1.5"
          fill={last.hasErrorCause ? tokens.error : tokens.accent}
        />
      )}
    </svg:svg>
  )
}
