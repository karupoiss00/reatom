// Pixel widths matching Panda CSS default breakpoints (1rem = 16px base font).
// If you ever add custom `theme.extend.breakpoints` to panda.config.ts, update
// these values to match.

export const FALLBACK_VIEWPORT = { width: 1280, height: 720 } as const

type ViewportName =
  'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'narrow' | 'wide' | 'chat'

const viewportWidths: Record<ViewportName, { width: number; height: number }> =
  {
    sm: { width: 640, height: 720 },
    md: { width: 768, height: 720 },
    lg: { width: 1024, height: 720 },
    xl: { width: 1280, height: 720 },
    '2xl': { width: 1536, height: 720 },
    narrow: { width: 560, height: 760 },
    wide: { width: 1280, height: 800 },
    chat: { width: 1440, height: 900 },
  }

/** Returns `{ width, height }` for a viewport name, or `null` if unknown. */
export function getViewportSize(
  name: string,
): { width: number; height: number } | null {
  return viewportWidths[name as ViewportName] ?? null
}

export const storybookViewports = Object.fromEntries(
  Object.entries(viewportWidths).map(([name, size]) => [
    name,
    {
      name,
      styles: {
        width: `${size.width}px`,
        height: `${size.height}px`,
      },
      type: 'desktop' as const,
    },
  ]),
) as Record<
  ViewportName,
  {
    name: string
    styles: { width: string; height: string }
    type: 'desktop'
  }
>
