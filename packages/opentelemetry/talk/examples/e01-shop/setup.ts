import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
  serviceVersion: '1.4.0',
  environment: 'production',
  filter: (target) => !target.name.startsWith('analytics.'),
})
