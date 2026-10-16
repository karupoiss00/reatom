const VIEWPORT_GAP = 16
const MIN_VISIBLE_WIDTH = 280
const MIN_VISIBLE_HEIGHT = 200

/** Stacking layer of the admin host. It stays above host app overlays. */
export const ADMIN_HOST_Z_INDEX = '2147483000'

interface HostBoxSnapshot {
  position: string
  width: string
  height: string
  maxWidth: string
  maxHeight: string
  left: string
  top: string
  right: string
  bottom: string
  zIndex: string
  boxSizing: string
}

function snapshotHostBox(host: HTMLElement): HostBoxSnapshot {
  return {
    position: host.style.position,
    width: host.style.width,
    height: host.style.height,
    maxWidth: host.style.maxWidth,
    maxHeight: host.style.maxHeight,
    left: host.style.left,
    top: host.style.top,
    right: host.style.right,
    bottom: host.style.bottom,
    zIndex: host.style.zIndex,
    boxSizing: host.style.boxSizing,
  }
}

function restoreHostBox(host: HTMLElement, snapshot: HostBoxSnapshot) {
  host.style.position = snapshot.position
  host.style.width = snapshot.width
  host.style.height = snapshot.height
  host.style.maxWidth = snapshot.maxWidth
  host.style.maxHeight = snapshot.maxHeight
  host.style.left = snapshot.left
  host.style.top = snapshot.top
  host.style.right = snapshot.right
  host.style.bottom = snapshot.bottom
  host.style.zIndex = snapshot.zIndex
  host.style.boxSizing = snapshot.boxSizing
}

function intersectionSize(bounds: DOMRect) {
  const width =
    Math.min(bounds.right, window.innerWidth) - Math.max(bounds.left, 0)
  const height =
    Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0)
  return {
    width: Math.max(0, width),
    height: Math.max(0, height),
  }
}

function hostFits(bounds: DOMRect) {
  if (bounds.width < 2 || bounds.height < 2) return false
  const visible = intersectionSize(bounds)
  return (
    visible.width >= Math.min(bounds.width, MIN_VISIBLE_WIDTH) - 1 &&
    visible.height >= Math.min(bounds.height, MIN_VISIBLE_HEIGHT) - 1
  )
}

function pinHost(host: HTMLElement, bounds: DOMRect) {
  const width = Math.min(
    Math.max(bounds.width, MIN_VISIBLE_WIDTH),
    Math.max(MIN_VISIBLE_WIDTH, window.innerWidth - VIEWPORT_GAP * 2),
  )
  const height = Math.min(
    Math.max(bounds.height, MIN_VISIBLE_HEIGHT),
    Math.max(MIN_VISIBLE_HEIGHT, window.innerHeight - VIEWPORT_GAP * 2),
  )
  host.style.boxSizing = 'border-box'
  host.style.position = 'fixed'
  host.style.zIndex = ADMIN_HOST_Z_INDEX
  host.style.width = `${width}px`
  host.style.height = `${height}px`
  host.style.maxWidth = `${window.innerWidth - VIEWPORT_GAP * 2}px`
  host.style.maxHeight = `${window.innerHeight - VIEWPORT_GAP * 2}px`
  host.style.right = `${VIEWPORT_GAP}px`
  host.style.bottom = `${VIEWPORT_GAP}px`
  host.style.left = 'auto'
  host.style.top = 'auto'
}

function raiseHost(host: HTMLElement) {
  host.style.zIndex = ADMIN_HOST_Z_INDEX
  if (!host.isConnected) return
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }
}

/**
 * Keeps the admin host on screen when the story viewport clips it or collapses
 * it to an empty box, and above host app overlays at all times. The story's own
 * box is restored once the viewport can hold it again.
 */
export function keepAdminHostInView(host: HTMLElement): () => void {
  const original = snapshotHostBox(host)
  raiseHost(host)
  let pinned = false
  let rememberedRight = 0
  let rememberedBottom = 0
  let applying = false
  let frame = 0
  let sawRealBox = false

  const apply = () => {
    if (applying || !host.isConnected) return
    applying = true
    try {
      if (pinned) {
        const viewportHoldsNaturalBox =
          window.innerWidth + 1 >= rememberedRight &&
          window.innerHeight + 1 >= rememberedBottom
        if (!viewportHoldsNaturalBox) return
        restoreHostBox(host, original)
        pinned = false
      }
      raiseHost(host)

      const bounds = host.getBoundingClientRect()
      const collapsed = bounds.width < 2 || bounds.height < 2
      if (collapsed) {
        if (!sawRealBox) return
        rememberedRight = Number.POSITIVE_INFINITY
        rememberedBottom = Number.POSITIVE_INFINITY
        pinHost(host, new DOMRect(0, 0, 720, 640))
        pinned = true
        return
      }

      sawRealBox = true
      if (hostFits(bounds)) {
        rememberedRight = bounds.right
        rememberedBottom = bounds.bottom
        return
      }

      rememberedRight = bounds.right
      rememberedBottom = bounds.bottom
      pinHost(host, bounds)
      pinned = true
    } finally {
      applying = false
    }
  }

  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(apply)
  }

  apply()
  window.addEventListener('resize', schedule)
  const observer = new ResizeObserver(schedule)
  observer.observe(host)
  observer.observe(document.documentElement)

  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    observer.disconnect()
    if (pinned) restoreHostBox(host, original)
  }
}
