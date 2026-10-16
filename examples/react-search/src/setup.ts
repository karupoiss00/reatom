import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { reatomGDPR } from '@reatom/opentelemetry/gdpr'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

const collectorEndpoint = import.meta.env.VITE_OTEL_ENDPOINT || null

const isTracedAppTarget = (target: { name: string }) => {
  const { name } = target
  if (name.startsWith('analytics.')) return false
  return (
    name.startsWith('github.') ||
    name.startsWith('issue') ||
    name.startsWith('navigation.') ||
    name.startsWith('consent') ||
    /search|issue/i.test(name)
  )
}

export const otel = reatomOpentelemetry({
  name: 'search',
  endpoint: collectorEndpoint,
  serviceName: 'github-search-web',
  environment: import.meta.env.MODE,
  skipGlobalExtension: false,
  filter: isTracedAppTarget,
  keepRecords: import.meta.env.DEV,
})

export const consent = reatomGDPR({
  name: 'consent',
  otel,
  categories: { analytics: false },
})

export const analytics = connectWebAnalytics(otel, {
  consent,
})

if (import.meta.env.DEV) {
  Object.assign(globalThis, { otel })
  otel.records.subscribe((records) => {
    console.debug('[otel.records]', records.length)
  })
}

import.meta.hot?.dispose(() => {
  analytics.dispose()
  otel.dispose()
})
