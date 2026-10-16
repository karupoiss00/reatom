export type IconName =
  | 'activity'
  | 'state'
  | 'timeline'
  | 'graph'
  | 'filters'
  | 'search'
  | 'pause'
  | 'play'
  | 'export'
  | 'import'
  | 'close'
  | 'error'
  | 'more'
  | 'minimize'
  | 'copy'
  | 'download'
  | 'follow'
  | 'action'
  | 'atom'
  | 'computed'
  | 'effect'
  | 'log'
  | 'mount'
  | 'route'
  | 'framework'
  | 'abort'
  | 'suspense'
  | 'pending'
  | 'chevron-right'
  | 'chevron-down'

type GlyphPaint = 'stroke' | 'fill' | 'both'

interface GlyphPart {
  d: string
  paint: GlyphPaint
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

const stroke = (d: string): GlyphPart[] => [{ d, paint: 'stroke' }]

const BOLT = 'M8.2 1.5 3.2 8h3.3l-.9 4.5L10.8 6H7.4z'
const PROMPT = 'M2.5 4 5.5 7 2.5 10M7 10.5h4.5'
const POWER = 'M7 2v4.5M4.2 4.2a4 4 0 1 0 5.6 0'
const SIGNPOST = 'M5 12.5V1.5M5 2.5h5.5L12 4.25 10.5 6H5'
const SQUARE = 'M3.5 3.5h7v7h-7z'
const EFFECT_WAVES = 'M7.2 4.4a3.6 3.6 0 0 1 0 5.2M9.6 2.4a6.4 6.4 0 0 1 0 9.2'
const ATOM_HALF = 'M7 3.4a3.6 3.6 0 0 0 0 7.2z'

const GLYPHS: Record<IconName, GlyphPart[]> = {
  activity: stroke('M2.5 3.5h9M2.5 7h9M2.5 10.5h6'),
  state: stroke('M3 3.5h8v3H3zM3 8.5h8v3H3z'),
  timeline: stroke('M3 11V7.5M7 11V3.5M11 11V6'),
  graph: stroke(
    'M5.1 4.2L6.4 9.2M8.9 4.2L7.6 9.2M3.5 3.5a1.6 1.6 0 1 0 0.01 0M10.5 3.5a1.6 1.6 0 1 0 0.01 0M7 10.5a1.6 1.6 0 1 0 0.01 0',
  ),
  filters: stroke('M2.5 3.5h9L8.2 7.6V11l-2.4-1.2V7.6L2.5 3.5Z'),
  search: stroke('M9.2 9.2 12 12M6.2 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z'),
  pause: stroke('M4.5 3.2h1.8v7.6H4.5zM7.7 3.2h1.8v7.6H7.7z'),
  play: stroke('M4.5 3.2 11 7 4.5 10.8z'),
  export: stroke('M7 8.5V2.8M4.6 5 7 2.6 9.4 5M3 11.2h8'),
  import: stroke('M7 2.8v5.7M4.6 6.3 7 8.7 9.4 6.3M3 11.2h8'),
  close: stroke('M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5'),
  error: stroke('M7 3.2 12 11.2H2zM7 6.4v2.1M7 9.8h.01'),
  more: stroke('M3.2 7h.01M7 7h.01M10.8 7h.01'),
  minimize: stroke('M2.5 7h9'),
  copy: stroke('M5 5.2h6.2V11H5zM3.2 8.8V3.2H9'),
  download: stroke('M7 2.8v6.2M4.6 6.8 7 9.2 9.4 6.8M3 11.2h8'),
  follow: stroke('M3 7h5.2M6.4 4.8 8.8 7 6.4 9.2M10.6 4.2v5.6'),
  action: [{ d: BOLT, paint: 'both' }],
  atom: [
    { d: circle(7, 7, 3.6), paint: 'stroke' },
    { d: ATOM_HALF, paint: 'fill' },
  ],
  computed: [{ d: circle(7, 7, 3.6), paint: 'fill' }],
  effect: [
    { d: circle(3.8, 7, 2), paint: 'fill' },
    { d: EFFECT_WAVES, paint: 'stroke' },
  ],
  log: stroke(PROMPT),
  mount: stroke(POWER),
  route: stroke(SIGNPOST),
  framework: stroke(SQUARE),
  abort: stroke(`${circle(7, 7, 4.8)}M3.6 10.4 10.4 3.6`),
  suspense: stroke(
    'M3.5 1.8h7M3.5 12.2h7M4.5 1.8v1.4L7 7 4.5 10.8v1.4M9.5 1.8v1.4L7 7l2.5 3.8v1.4',
  ),
  pending: stroke(`${circle(7, 7, 4.8)}M7 4.4V7l1.9 1.3`),
  'chevron-right': stroke('M5.2 3.2 9.2 7 5.2 10.8'),
  'chevron-down': stroke('M3.2 5.2 7 9.2 10.8 5.2'),
}

const GlyphPath = ({ part }: { part: GlyphPart }) => {
  if (part.paint === 'stroke') {
    return (
      <svg:path
        d={part.d}
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    )
  }
  return (
    <svg:path
      d={part.d}
      fill="currentColor"
      stroke={part.paint === 'both' ? 'currentColor' : 'none'}
      stroke-width={part.paint === 'both' ? '1' : undefined}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  )
}

export interface IconProps {
  name: IconName
  size?: number
  label?: string
}

export const Icon = ({ name, size = 14, label }: IconProps) => {
  return (
    <svg:svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      css={`
        display: block;
        flex-shrink: 0;
      `}
    >
      {GLYPHS[name].map((part) => (
        <GlyphPath part={part} />
      ))}
    </svg:svg>
  )
}
