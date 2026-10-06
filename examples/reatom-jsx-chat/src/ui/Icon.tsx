const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`

type IconShape = { strokes: readonly string[]; fills?: readonly string[] }

const ring = circle(12, 12, 9)

export const iconShapes = {
  plus: { strokes: ['M12 5v14', 'M5 12h14'] },
  send: { strokes: ['M12 19V5.5', 'M5.75 11.5 12 5.25l6.25 6.25'] },
  stop: { strokes: [], fills: ['M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z'] },
  copy: {
    strokes: [
      'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z',
      'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
    ],
  },
  check: { strokes: ['M5 12.5 9.5 17 19 7.5'] },
  close: { strokes: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'] },
  menu: { strokes: ['M4 7h16', 'M4 12h16', 'M4 17h16'] },
  more: { strokes: [], fills: [circle(5.5, 12, 1.6), circle(12, 12, 1.6), circle(18.5, 12, 1.6)] },
  'chevron-down': { strokes: ['m6.5 9.5 5.5 5.5 5.5-5.5'] },
  'chevron-up': { strokes: ['m6.5 14.5 5.5-5.5 5.5 5.5'] },
  'chevron-left': { strokes: ['m14.5 6.5-5.5 5.5 5.5 5.5'] },
  'chevron-right': { strokes: ['m9.5 6.5 5.5 5.5-5.5 5.5'] },
  info: { strokes: [ring, 'M12 11v5.25'], fills: [circle(12, 7.9, 1.1)] },
  warning: {
    strokes: [
      'M10.27 4.4 2.9 17.25A2 2 0 0 0 4.64 20.25h14.72a2 2 0 0 0 1.74-3L13.73 4.4a2 2 0 0 0-3.46 0z',
      'M12 9.5v4.25',
    ],
    fills: [circle(12, 16.9, 1.1)],
  },
  danger: { strokes: [ring, 'M12 7.5v5.5'], fills: [circle(12, 16.2, 1.1)] },
  success: { strokes: [ring, 'm8.25 12.25 2.6 2.6 4.9-5.1'] },
  search: { strokes: [circle(11, 11, 6.5), 'm20 20-4.2-4.2'] },
  settings: {
    strokes: ['M4 7.5h9', 'M18.5 7.5H20', 'M4 16.5h2.5', 'M11 16.5h9', circle(15.75, 7.5, 2.25), circle(8.75, 16.5, 2.25)],
  },
  edit: { strokes: ['M4 20h4L19.1 8.9a2.83 2.83 0 0 0-4-4L4 16z', 'm13.5 6.5 4 4'] },
  regenerate: {
    strokes: ['M19.5 10.5A7.75 7.75 0 0 0 5.3 7.6L4 9', 'M4 4.5V9h4.5', 'M4.5 13.5a7.75 7.75 0 0 0 14.2 2.9L20 15', 'M20 19.5V15h-4.5'],
  },
  trash: {
    strokes: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l.9 11.2A2 2 0 0 0 8.9 20h6.2a2 2 0 0 0 2-1.8L18 7', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
  },
  pin: { strokes: ['M12 16.5V21', 'M9 3.5h6l-.9 5.2 3.4 3.3v2.2h-11V12l3.4-3.3z'] },
  sidebar: { strokes: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9.5 4v16'] },
  key: { strokes: [circle(8, 15.5, 4), 'm10.9 12.6 8.6-8.6', 'm16.5 7 2.5 2.5', 'm14.5 9 1.75 1.75'] },
  globe: { strokes: [ring, 'M3 12h18', 'M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z'] },
  paperclip: {
    strokes: ['m19.5 11.5-7.9 7.9a4.95 4.95 0 0 1-7-7l8.2-8.2a3.3 3.3 0 0 1 4.67 4.67l-8.2 8.2a1.65 1.65 0 0 1-2.33-2.33l7.6-7.6'],
  },
  image: {
    strokes: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', circle(8.75, 9.25, 1.75), 'm21 15.5-4.8-4.8L5.5 20'],
  },
  file: { strokes: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'] },
  sun: {
    strokes: [circle(12, 12, 4), 'M12 2.75v1.75', 'M12 19.5v1.75', 'm5.46 5.46 1.24 1.24', 'm17.3 17.3 1.24 1.24', 'M2.75 12H4.5', 'M19.5 12h1.75', 'm5.46 18.54 1.24-1.24', 'm17.3 6.7 1.24-1.24'],
  },
  moon: { strokes: ['M20 14.6A8.25 8.25 0 0 1 9.4 4 8.25 8.25 0 1 0 20 14.6z'] },
  monitor: { strokes: ['M4.5 4h15A1.5 1.5 0 0 1 21 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4z', 'M8 20h8', 'M12 16v4'] },
  external: { strokes: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4'] },
  download: { strokes: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'] },
  upload: { strokes: ['M12 15V4', 'm7 9 5-5 5 5', 'M5 20h14'] },
  undo: { strokes: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'] },
  lock: { strokes: ['M6.5 11h11A1.5 1.5 0 0 1 19 12.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-7A1.5 1.5 0 0 1 6.5 11z', 'M8 11V7.5a4 4 0 0 1 8 0V11'] },
  sparkle: { strokes: ['M11 3.5l1.8 4.9 4.9 1.8-4.9 1.8L11 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z', 'M18.5 15v5', 'M16 17.5h5'] },
  compare: { strokes: ['M5 4h5v16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5z'] },
  branch: { strokes: ['M6.5 3.5v11', circle(6.5, 18, 2.5), circle(17.5, 6.5, 2.5), 'M17.5 9a8.5 8.5 0 0 1-8.5 8.5'] },
  compose: { strokes: ['M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6', 'M18.4 3.6a2.05 2.05 0 0 1 2.9 2.9L12.5 15.3 9 16l.7-3.5z'] },
  keyboard: {
    strokes: ['M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z', 'M8 14h8'],
    fills: [circle(7.5, 10, 0.9), circle(11, 10, 0.9), circle(14.5, 10, 0.9), circle(18, 10, 0.9)],
  },
  offline: { strokes: ['M3 3l18 18', 'M8.6 16.4a4.9 4.9 0 0 1 6.1-.6', 'M5.2 12.9a10 10 0 0 1 4.5-2.6', 'M18.8 12.9a10 10 0 0 0-2.2-1.6', 'M2 9.3a14.8 14.8 0 0 1 4.1-2.6', 'M22 9.3A14.8 14.8 0 0 0 12 5.5'], fills: [circle(12, 19.75, 1.1)] },
} satisfies Record<string, IconShape>

export type IconName = keyof typeof iconShapes

export const iconNames = Object.keys(iconShapes) as IconName[]

export type IconProps = {
  name: IconName
  label?: string
  size?: number | string
}

export const Icon = ({ name, label, size = '1.25rem' }: IconProps) => {
  const shape: IconShape = iconShapes[name]
  const dimension = typeof size === 'number' ? `${size}px` : size
  return (
    <svg:svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      data-icon={name}
      role={label ? 'img' : null}
      aria-label={label ?? null}
      aria-hidden={label ? null : 'true'}
      css:icon-size={dimension}
      css={`
        flex: none;
        display: block;
        width: var(--icon-size);
        height: var(--icon-size);
        overflow: visible;
      `}
    >
      {shape.strokes.map((path) => (
        <svg:path d={path} />
      ))}
      {(shape.fills ?? []).map((path) => (
        <svg:path d={path} fill="currentColor" stroke="none" />
      ))}
    </svg:svg>
  )
}
