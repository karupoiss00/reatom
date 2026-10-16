import {
  kindTokens,
  tokens,
  type as typeRoles,
} from '../../view/design-system'

export type RecordKind =
  | 'action'
  | 'atom'
  | 'computed'
  | 'effect'
  | 'log'
  | 'mount'
  | 'route'
  | 'framework'

export type RecordStatus = 'error' | 'abort' | 'suspense' | 'pending'

export type VariantId = 'solid' | 'outline' | 'letters' | 'markers'

type GlyphPart =
  | { d: string; paint: 'stroke' | 'fill' | 'both' }
  | { letter: string }

type Glyph = GlyphPart[]

export const recordKinds: RecordKind[] = [
  'action',
  'atom',
  'computed',
  'effect',
  'log',
  'mount',
  'route',
  'framework',
]

export const recordStatuses: RecordStatus[] = [
  'error',
  'abort',
  'suspense',
  'pending',
]

export const kindWords: Record<RecordKind, string> = {
  action: 'action',
  atom: 'atom',
  computed: 'computed',
  effect: 'effect',
  log: 'LOG',
  mount: 'mount',
  route: 'route',
  framework: 'framework span',
}

export const statusWords: Record<RecordStatus, string> = {
  error: 'error',
  abort: 'abort',
  suspense: 'suspense',
  pending: 'in progress',
}

export const kindColorVars = `
  --kind-action: ${kindTokens.action};
  --kind-atom: ${kindTokens.atom};
  --kind-computed: ${kindTokens.computed};
  --kind-effect: ${kindTokens.effect};
  --kind-log: ${kindTokens.log};
  --kind-mount: ${kindTokens.other};
  --kind-route: ${kindTokens.other};
  --kind-framework: ${kindTokens.other};
`

export const kindColor = (kind: RecordKind) => `var(--kind-${kind})`

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`

const BOLT = 'M8.2 1.5 3.2 8h3.3l-.9 4.5L10.8 6H7.4z'
const PROMPT = 'M2.5 4 5.5 7 2.5 10M7 10.5h4.5'
const POWER = 'M7 2v4.5M4.2 4.2a4 4 0 1 0 5.6 0'
const SIGNPOST = 'M5 12.5V1.5M5 2.5h5.5L12 4.25 10.5 6H5'
const SQUARE = 'M3.5 3.5h7v7h-7z'
const EFFECT_WAVES = 'M7.2 4.4a3.6 3.6 0 0 1 0 5.2M9.6 2.4a6.4 6.4 0 0 1 0 9.2'

const statusGlyphs: Record<RecordStatus, Glyph> = {
  error: [{ d: 'M7 2.2 12.5 11.5h-11zM7 6v2.3M7 9.9h.01', paint: 'stroke' }],
  abort: [{ d: `${circle(7, 7, 4.8)}M3.6 10.4 10.4 3.6`, paint: 'stroke' }],
  suspense: [
    {
      d: 'M3.5 1.8h7M3.5 12.2h7M4.5 1.8v1.4L7 7 4.5 10.8v1.4M9.5 1.8v1.4L7 7l2.5 3.8v1.4',
      paint: 'stroke',
    },
  ],
  pending: [{ d: `${circle(7, 7, 4.8)}M7 4.4V7l1.9 1.3`, paint: 'stroke' }],
}

const solid: Record<RecordKind, Glyph> = {
  action: [{ d: BOLT, paint: 'both' }],
  atom: [
    { d: circle(7, 7, 3.6), paint: 'stroke' },
    { d: 'M7 3.4a3.6 3.6 0 0 0 0 7.2z', paint: 'fill' },
  ],
  computed: [{ d: circle(7, 7, 3.6), paint: 'fill' }],
  effect: [
    { d: circle(3.8, 7, 2), paint: 'fill' },
    { d: EFFECT_WAVES, paint: 'stroke' },
  ],
  log: [{ d: PROMPT, paint: 'stroke' }],
  mount: [{ d: POWER, paint: 'stroke' }],
  route: [{ d: SIGNPOST, paint: 'stroke' }],
  framework: [{ d: SQUARE, paint: 'stroke' }],
}

const outline: Record<RecordKind, Glyph> = {
  action: [{ d: BOLT, paint: 'stroke' }],
  atom: [
    { d: circle(7, 7, 4), paint: 'stroke' },
    { d: circle(7, 7, 1.2), paint: 'fill' },
  ],
  computed: [{ d: `${circle(7, 7, 4)}M5 6h4M5 8h4`, paint: 'stroke' }],
  effect: [{ d: `${circle(3.8, 7, 1.6)}${EFFECT_WAVES}`, paint: 'stroke' }],
  log: [{ d: PROMPT, paint: 'stroke' }],
  mount: [{ d: POWER, paint: 'stroke' }],
  route: [{ d: SIGNPOST, paint: 'stroke' }],
  framework: [{ d: SQUARE, paint: 'stroke' }],
}

const BADGE =
  'M3.5 1.5h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z'

const letterGlyph = (letter: string): Glyph => [
  { d: BADGE, paint: 'stroke' },
  { letter },
]

const letters: Record<RecordKind, Glyph> = {
  action: letterGlyph('ƒ'),
  atom: letterGlyph('a'),
  computed: letterGlyph('c'),
  effect: letterGlyph('e'),
  log: letterGlyph('L'),
  mount: letterGlyph('m'),
  route: letterGlyph('r'),
  framework: letterGlyph('·'),
}

const markers: Record<RecordKind, Glyph> = {
  action: [{ d: 'M7 2.3 11.7 7 7 11.7 2.3 7z', paint: 'fill' }],
  atom: [{ d: circle(7, 7, 3.4), paint: 'fill' }],
  computed: [{ d: circle(7, 7, 3.2), paint: 'stroke' }],
  effect: [{ d: 'M7 2.8 11.2 10.6H2.8z', paint: 'fill' }],
  log: [{ d: 'M3 7h8', paint: 'stroke' }],
  mount: [{ d: `${circle(7, 7, 3.6)}${circle(7, 7, 0.9)}`, paint: 'stroke' }],
  route: [{ d: 'M4 4h6v6H4z', paint: 'fill' }],
  framework: [{ d: 'M4.5 4.5h5v5h-5z', paint: 'stroke' }],
}

export interface IconVariant {
  id: VariantId
  title: string
  summary: string
  kinds: Record<RecordKind, Glyph>
}

export const iconVariants: IconVariant[] = [
  {
    id: 'solid',
    title: 'A · Solid geometric',
    summary:
      'Round means state, angular means something happened. Filled bolt, half-filled disk for atom, filled disk for computed, broadcast for effect.',
    kinds: solid,
  },
  {
    id: 'outline',
    title: 'B · Outline',
    summary:
      'Stroke only, matches the current Icon set. Ring with a core for atom, ring with "=" for computed.',
    kinds: outline,
  },
  {
    id: 'letters',
    title: 'C · Letter badges',
    summary:
      'IDE-style symbol chips: ƒ action, a atom, c computed, e effect, L log.',
    kinds: letters,
  },
  {
    id: 'markers',
    title: 'D · Rail markers',
    summary:
      'Minimal marks from the RailGraph language: diamond, dot, ring, triangle, dash.',
    kinds: markers,
  },
]

export const variantById = (id: VariantId) =>
  iconVariants.find((variant) => variant.id === id) ?? iconVariants[0]!

const GlyphSvg = ({ glyph, size }: { glyph: Glyph; size: number }) => (
  <svg:svg
    width={size}
    height={size}
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
    css={`
      display: block;
      flex-shrink: 0;
    `}
  >
    {glyph.map((part) =>
      'letter' in part ? (
        <svg:text
          x="7"
          y="10.2"
          text-anchor="middle"
          fill="currentColor"
          css={`
            font-family: ${tokens.fontData};
            font-size: 8.5px;
            font-weight: 700;
          `}
        >
          {part.letter}
        </svg:text>
      ) : (
        <svg:path
          d={part.d}
          fill={part.paint === 'stroke' ? 'none' : 'currentColor'}
          stroke={part.paint === 'fill' ? 'none' : 'currentColor'}
          stroke-width={part.paint === 'both' ? '1' : '1.5'}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      ),
    )}
  </svg:svg>
)

export const KindGlyph = ({
  variant,
  kind,
  size = 14,
}: {
  variant: IconVariant
  kind: RecordKind
  size?: number
}) => <GlyphSvg glyph={variant.kinds[kind]} size={size} />

export const StatusGlyph = ({
  status,
  size = 14,
}: {
  status: RecordStatus
  size?: number
}) => <GlyphSvg glyph={statusGlyphs[status]} size={size} />

export interface MockRow {
  name: string
  kind: RecordKind
  depth: number
  childCount?: number
  status?: RecordStatus
  errorMessage?: string
  duration?: string
  slow?: boolean
  left: number
  width: number
}

export const mockRows: MockRow[] = [
  { name: 'makeMove', kind: 'action', depth: 0, childCount: 3, duration: '2ms', left: 0.08, width: 0.04 },
  { name: 'currentPlayer.setX', kind: 'action', depth: 1, childCount: 1, duration: '0ms', left: 0.09, width: 0.01 },
  { name: 'currentPlayer', kind: 'atom', depth: 2, left: 0.095, width: 0 },
  { name: 'board', kind: 'atom', depth: 1, left: 0.1, width: 0 },
  { name: 'winner', kind: 'computed', depth: 1, left: 0.1, width: 0 },
  { name: 'reatom.log', kind: 'log', depth: 1, left: 0.105, width: 0 },
  { name: 'syncScore', kind: 'effect', depth: 1, duration: '1ms', left: 0.11, width: 0.01 },
  { name: 'TurnIndicator', kind: 'mount', depth: 1, left: 0.11, width: 0 },
  { name: 'footer.repositoryStarCount', kind: 'action', depth: 0, status: 'error', errorMessage: 'HTTP 403', duration: '84ms', slow: true, left: 0.2, width: 0.18 },
  { name: 'chat.sendMessage', kind: 'action', depth: 0, childCount: 2, status: 'pending', duration: '1.2s', slow: true, left: 0.42, width: 0.58 },
  { name: 'chat.stream', kind: 'action', depth: 1, status: 'abort', duration: '640ms', slow: true, left: 0.45, width: 0.3 },
  { name: 'chat.reply', kind: 'computed', depth: 1, status: 'suspense', left: 0.46, width: 0.54 },
  { name: '/chat/:id', kind: 'route', depth: 0, duration: '3ms', left: 0.4, width: 0.02 },
  { name: 'app.session', kind: 'framework', depth: 0, left: 0, width: 0 },
]

const kindSelectors = recordKinds
  .map(
    (kind) => `
      &[data-colors='true'] [data-kind='${kind}'] [data-kind-mark],
      &[data-colors='true'] [data-kind='${kind}'] [data-bar] {
        color: ${kindColor(kind)};
        --bar-color: ${kindColor(kind)};
      }
    `,
  )
  .join('')

export const timelineDisplayCss = `
  ${kindColorVars}
  --bar-color: ${tokens.text3};
  [data-kind-mark] {
    color: ${tokens.text2};
  }
  [data-bar] {
    --bar-color: ${tokens.text3};
  }
  ${kindSelectors}
  &[data-icons='false'] [data-kind-glyph] {
    display: none;
  }
  [data-kind-swatch] {
    display: none;
  }
  &[data-icons='false'][data-colors='true'] [data-kind-swatch] {
    display: block;
  }
  &[data-icons='false'][data-colors='false'] [data-kind-mark] {
    display: none;
  }
  &[data-colors='true'] [data-band='true']:not([aria-selected='true']) {
    background: color-mix(in oklch, var(--kind-action) 7%, ${tokens.canvas});
  }
`

export const MockTimeline = ({
  variant,
  label,
  icons,
  colors,
}: {
  variant: () => IconVariant
  label: string
  icons: () => boolean
  colors: () => boolean
}) => (
  <div
    data-testid="kind-mock-timeline"
    data-icons={() => String(icons())}
    data-colors={() => String(colors())}
    css={`
      ${timelineDisplayCss}
      border: 1px solid ${tokens.border1};
      background: ${tokens.canvas};
      min-width: 0;
    `}
  >
    <style>{barDriftKeyframes}</style>
    {() => {
      const currentVariant = variant()
      return (
        <ul
          aria-label={label}
          css={`
            list-style: none;
            margin: 0;
            padding: 0;
          `}
        >
          {mockRows.map((row) => (
            <MockTimelineRow variant={currentVariant} row={row} />
          ))}
        </ul>
      )
    }}
  </div>
)

const barDriftKeyframes = `
  @keyframes kind-bar-drift {
    to {
      background-position: 11.3px 0;
    }
  }
`

const statusBarCss = `
  &[data-status='error'] {
    background: ${tokens.error};
  }
  &[data-status='abort'] {
    background: repeating-linear-gradient(
      135deg,
      ${tokens.text3} 0 2px,
      transparent 2px 5px
    );
  }
  &[data-status='pending'],
  &[data-status='suspense'] {
    background: repeating-linear-gradient(
      135deg,
      var(--bar-color) 0 4px,
      color-mix(in oklch, var(--bar-color) 35%, transparent) 4px 8px
    );
    background-size: 11.3px 11.3px;
    animation: kind-bar-drift 1.6s linear infinite;
  }
  &[data-status='pending'] {
    mask-image: linear-gradient(90deg, black 70%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const MockTimelineRow = ({
  variant,
  row,
}: {
  variant: IconVariant
  row: MockRow
}) => {
  const isError = row.status === 'error'
  const accessibleName = [
    row.name,
    kindWords[row.kind],
    row.status ? statusWords[row.status] : undefined,
    row.childCount ? `${row.childCount} children` : undefined,
    row.duration,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <li
      aria-label={accessibleName}
      data-kind={row.kind}
      data-band={String(row.kind === 'action' && (row.childCount ?? 0) > 0)}
      css={`
        box-sizing: border-box;
        display: grid;
        grid-template-columns: 210px minmax(0, 1fr);
        align-items: center;
        height: 22px;
        border-bottom: 1px solid ${tokens.border1};
        ${typeRoles.data}
      `}
    >
      <div
        style={{ 'padding-left': `${row.depth * 12 + 8}px` }}
        css={`
          display: flex;
          align-items: center;
          gap: var(--admin-space-4);
          min-width: 0;
          padding-right: var(--admin-space-8);
        `}
      >
        <span
          aria-hidden="true"
          css={`
            width: 10px;
            flex: 0 0 10px;
            color: ${tokens.text2};
          `}
        >
          {row.childCount ? '▾' : ''}
        </span>
        <span
          data-kind-mark=""
          css={`
            display: flex;
            align-items: center;
            justify-content: center;
            width: 14px;
            flex: 0 0 14px;
          `}
        >
          <span data-kind-glyph="">
            <KindGlyph variant={variant} kind={row.kind} />
          </span>
          <span
            data-kind-swatch=""
            css={`
              width: 3px;
              height: 12px;
              border-radius: 2px;
              background: currentColor;
            `}
          />
        </span>
        <span
          css={`
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: ${isError ? tokens.error : row.kind === 'mount' ? tokens.text2 : tokens.text1};
          `}
        >
          {row.name}
          {row.errorMessage ? ` — ${row.errorMessage}` : ''}
          {row.childCount ? (
            <span
              css={`
                color: ${tokens.text2};
              `}
            >{` ${row.childCount}`}</span>
          ) : (
            ''
          )}
        </span>
        <span
          css={`
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: var(--admin-space-4);
            flex: 0 0 auto;
          `}
        >
          {row.status ? (
            <span
              css={`
                color: ${isError ? tokens.error : tokens.text2};
              `}
            >
              <StatusGlyph status={row.status} size={12} />
            </span>
          ) : (
            ''
          )}
          {row.duration ? (
            <span
              css={`
                color: ${row.slow ? tokens.warning : tokens.text2};
                font-variant-numeric: tabular-nums;
              `}
            >
              {row.duration}
            </span>
          ) : (
            ''
          )}
        </span>
      </div>
      <div
        css={`
          position: relative;
          height: 10px;
          margin-inline: var(--admin-space-8);
          background: ${tokens.surface3};
          border-radius: var(--admin-radius-2);
          overflow: hidden;
        `}
      >
        <div
          data-bar=""
          data-status={row.status ?? ''}
          style={{
            left: `${row.left * 100}%`,
            width: row.width <= 0 ? '2px' : `${row.width * 100}%`,
          }}
          css={`
            position: absolute;
            top: 0;
            bottom: 0;
            min-width: 2px;
            border-radius: var(--admin-radius-2);
            background: var(--bar-color);
            ${statusBarCss}
          `}
        />
      </div>
    </li>
  )
}
