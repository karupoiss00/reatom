import './render/math'
import './routes'

import { log, wrap } from '@reatom/core'
import {
  reatomOpentelemetry,
  type ReatomOpentelemetry,
} from '@reatom/opentelemetry'
import { reatomGDPR } from '@reatom/opentelemetry/gdpr'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

const collectorEndpoint = import.meta.env.VITE_OTEL_ENDPOINT || null

export const otel = reatomOpentelemetry({
  name: 'chat',
  endpoint: collectorEndpoint,
  serviceName: 'chat',
  environment: import.meta.env.MODE,
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
}

if (import.meta.env.MODE === 'development') {
  const { connectChatAdmin } = await wrap(import('./devtools'))
  const disposeAdmin = connectChatAdmin(otel)
  import.meta.hot?.dispose(() => {
    disposeAdmin()
    analytics.dispose()
    otel.dispose()
  })
} else {
  import.meta.hot?.dispose(() => {
    analytics.dispose()
    otel.dispose()
  })
}

declare global {
  var LOG: typeof log
  var otel: ReatomOpentelemetry | undefined
}
globalThis.LOG = log
