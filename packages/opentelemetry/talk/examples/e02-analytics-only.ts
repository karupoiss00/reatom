import { action, atom } from '@reatom/core'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

type Order = { id: string; total: number; currency: string }

export const analyticsConsent = atom(false, 'cookieBanner.analytics')

export const analytics = connectWebAnalytics({
  name: 'site',
  endpoint: 'https://site.example/otel',
  serviceName: 'site-web',
  skipGlobalExtension: true,
  consent: analyticsConsent,
})

export const purchase = action((order: Order) => order, 'app.purchase').extend(
  analytics.otel.withOTel(),
)

document.querySelector('#accept-analytics')?.addEventListener('click', () => {
  analyticsConsent.set(true)
})

purchase({ id: 'o-1', total: 59.9, currency: 'EUR' })
