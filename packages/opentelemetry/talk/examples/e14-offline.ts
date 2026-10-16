import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'field-app',
  endpoint: 'https://field.example/otel',
  serviceName: 'field-web',
  maxQueueSize: 2000,
})

export const reportTelemetryHealth = () => {
  const stats = otel.stats()
  return {
    queued: stats.queued,
    exported: stats.exported,
    dropped: stats.dropped,
    droppedByReason: stats.droppedByReason,
  }
}
