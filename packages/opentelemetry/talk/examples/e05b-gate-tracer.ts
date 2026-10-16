import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { reatomGDPR } from '@reatom/opentelemetry/gdpr'

const COLLECTOR_URL = 'https://shop.example/otel'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: null,
  serviceName: 'shop-web',
})

export const consent = reatomGDPR({ name: 'consent', otel })

consent.snapshot.subscribe((snapshot) => {
  const diagnosticsAllowed = snapshot?.categories.diagnostics === true
  otel.options.set((current) => ({
    ...current,
    endpoint: diagnosticsAllowed ? COLLECTOR_URL : null,
  }))
})
