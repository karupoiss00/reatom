import { action } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const hostOtel = reatomOpentelemetry({
  name: 'host',
  endpoint: 'https://otel.host.example',
  serviceName: 'host-web',
})
export const hostAnalytics = connectWebAnalytics(hostOtel, { consent: true })

export const widgetOtel = reatomOpentelemetry({
  name: 'widget',
  endpoint: 'https://otel.reviews-vendor.example',
  serviceName: 'reviews-widget',
  filter: (target) => target.name.startsWith('reviews.'),
})
export const widgetAnalytics = connectWebAnalytics(widgetOtel, {
  consent: true,
  errors: false,
})

export const submitReview = action((stars: number) => stars, 'reviews.submit')

hostAnalytics.visitorAtom()
widgetAnalytics.visitorAtom()
