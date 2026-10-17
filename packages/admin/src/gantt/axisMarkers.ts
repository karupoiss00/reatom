import type { AdminRecord } from '../otlp/ingest'
import type { GanttTime } from './reatomGantt'

export type AxisMarkerKind = 'page' | 'session'

export type AxisMarker = {
  time: number
  label: string
  kind: AxisMarkerKind
}

export type CollidedAxisMarker = {
  time: number
  label: string
  kind: AxisMarkerKind
  extra: number
  members: AxisMarker[]
}

function cleanedPath(record: AdminRecord): string {
  const path =
    record.attributes['url.path'] ??
    record.attributes['page.path'] ??
    record.attributes['path'] ??
    record.name
  const text = typeof path === 'string' && path !== '' ? path : record.name
  return text.replace(/[?#].*$/, '') || '/'
}

export function sessionAxisMarkers(
  records: readonly AdminRecord[],
): AxisMarker[] {
  const markers: AxisMarker[] = []
  for (const record of records) {
    if (
      record.eventName === 'app.page_view' ||
      record.reatomKind === 'page_view'
    ) {
      markers.push({
        time: record.start,
        label: cleanedPath(record),
        kind: 'page',
      })
      continue
    }
    if (
      record.eventName === 'session.start' ||
      record.reatomKind === 'session'
    ) {
      markers.push({
        time: record.start,
        label: 'session',
        kind: 'session',
      })
    }
  }
  return markers.sort((left, right) => left.time - right.time)
}

export function collideAxisMarkers(
  markers: readonly AxisMarker[],
  range: GanttTime,
  widthPx: number,
  thresholdPx = 12,
): CollidedAxisMarker[] {
  if (markers.length === 0 || !(range.end > range.start) || !(widthPx > 0)) {
    return []
  }
  const span = range.end - range.start
  const collided: CollidedAxisMarker[] = []
  for (const marker of markers) {
    const x = ((marker.time - range.start) / span) * widthPx
    const previous = collided[collided.length - 1]
    if (previous === undefined) {
      collided.push({
        time: marker.time,
        label: marker.label,
        kind: marker.kind,
        extra: 0,
        members: [marker],
      })
      continue
    }
    const previousX =
      ((previous.time - range.start) / span) * widthPx
    if (Math.abs(x - previousX) <= thresholdPx) {
      previous.members.push(marker)
      previous.extra = previous.members.length - 1
      previous.label = `+${previous.members.length}`
      continue
    }
    collided.push({
      time: marker.time,
      label: marker.label,
      kind: marker.kind,
      extra: 0,
      members: [marker],
    })
  }
  return collided
}

export function markerWindow(time: number, range: GanttTime): GanttTime {
  const span = range.end - range.start
  const pad = Math.max(span * 0.15, 1)
  return { start: time - pad, end: time + pad }
}
