import type { Reservation } from './createBatchQueue.ts'
import type { CapturedRecord } from './records.ts'
import type { ReatomOpentelemetry } from './reatomOpentelemetry.ts'

export type DeliveryItem = {
  record: CapturedRecord
  provenance: {
    root: object
    signalClass: 'traces' | 'diagnosticLogs' | 'publicLogs'
    epoch: number
  }
}

export interface ExportReservation extends Reservation<DeliveryItem> {
  /** Encode and validate before sampling without queueing a held record. */
  prepare(item: DeliveryItem): boolean
  /** False means wire admission failed and the slot has been released. */
  commit(item: DeliveryItem): boolean
}
export interface ExporterBinding {
  reserve(signal: 'traces' | 'logs'): ExportReservation | undefined
  dropQueued(predicate: (item: DeliveryItem) => boolean): void
  flush(): Promise<void>
  dispose(): void
}

export interface CaptureHost {
  canDeliver(item: DeliveryItem): boolean
  onStatsChange(): void
  closePendingSpans(): void
  attachCleanup(cleanup: () => void): () => void
}

type ExporterSlot = { host: CaptureHost; binding?: ExporterBinding }
const exporters = new WeakMap<ReatomOpentelemetry, ExporterSlot>()

export const installCaptureHost = (
  instance: ReatomOpentelemetry,
  host: CaptureHost,
): void => {
  exporters.set(instance, { host })
}

export const bindExporter = (
  instance: ReatomOpentelemetry,
  binding: ExporterBinding,
): CaptureHost => {
  const slot = exporters.get(instance)
  if (!slot || instance.disposed())
    throw new Error('[@reatom/opentelemetry] capture instance is disposed')
  if (slot.binding)
    throw new Error('[@reatom/opentelemetry] OTLP is already installed')
  slot.binding = binding
  return slot.host
}

export const exporterOf = (instance: ReatomOpentelemetry) =>
  exporters.get(instance)?.binding

/** Roll back only an installation that never completed native composition. */
export const unbindExporter = (
  instance: ReatomOpentelemetry,
  binding: ExporterBinding,
) => {
  const slot = exporters.get(instance)
  if (slot?.binding === binding) delete slot.binding
}
