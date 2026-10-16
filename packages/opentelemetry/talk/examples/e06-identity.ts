import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const analytics = connectWebAnalytics({
  name: 'kiosk',
  endpoint: 'https://kiosk.example/otel',
  serviceName: 'kiosk-web',
  skipGlobalExtension: true,
  consent: true,
  persistVisitor: false,
  sessionTimeout: 10 * 60 * 1000,
  perTab: true,
})

analytics.sessionAtom.subscribe((session) => {
  if (session.previousId) console.info('rotated from', session.previousId)
})
