import { action, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { reatomGDPR } from '@reatom/opentelemetry/gdpr'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})

export const consent = reatomGDPR({ name: 'consent', otel })
export const analytics = connectWebAnalytics(otel, {
  consent,
})

export const toggleAnalytics = action((checked: boolean) => {
  consent.fields.analytics.change(checked)
}, 'consentBanner.toggleAnalytics')

export const saveChoice = action(async () => {
  await wrap(consent.submit())
}, 'consentBanner.save')

consent.snapshot()
