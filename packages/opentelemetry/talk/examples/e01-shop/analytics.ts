import { reatomGDPR } from '@reatom/opentelemetry/gdpr'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

import { otel } from './setup'
import './routes'

export const consent = reatomGDPR({ name: 'consent', otel })

export const analytics = connectWebAnalytics(otel, {
  navigation: 'urlAtom',
  consent,
})
