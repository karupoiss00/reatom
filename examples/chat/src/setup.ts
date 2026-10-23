import './render/math'
import './routes'

import { log, wrap } from '@reatom/core'
import {
  reatomOpentelemetry,
  type ReatomOpentelemetry,
} from '@reatom/opentelemetry'
import { withGDPR } from '@reatom/opentelemetry/gdpr'
import { withWebAnalytics } from '@reatom/opentelemetry/web-analytics'

const collectorEndpoint = import.meta.env.VITE_OTEL_ENDPOINT || null

export const otel = reatomOpentelemetry({
  name: 'chat',
  endpoint: collectorEndpoint,
  serviceName: 'chat',
  environment: import.meta.env.MODE,
  keepRecords: import.meta.env.DEV,
}).extend(
  withGDPR({ name: 'consent', categories: { analytics: false } }),
  withWebAnalytics(),
)

export const consent = otel.gdpr
export const analytics = otel.analytics

if (import.meta.env.DEV) {
  Object.assign(globalThis, { otel })
}

if (import.meta.env.MODE === 'development') {
  const { connectChatAdmin } = await wrap(import('./devtools'))
  const disposeAdmin = connectChatAdmin(otel)
  import.meta.hot?.dispose(() => {
    disposeAdmin()
    otel.dispose()
  })
} else {
  import.meta.hot?.dispose(() => {
    otel.dispose()
  })
}

declare global {
  var LOG: typeof log
  var otel: ReatomOpentelemetry | undefined
}
globalThis.LOG = log
