import { atom } from '@reatom/core'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

type HistoryAction = 'POP' | 'PUSH' | 'REPLACE'

const hasNavigationApi = 'navigation' in window

export const analyticsConsent = atom(false, 'site.consent.analytics')

export const analytics = connectWebAnalytics({
  name: 'site',
  endpoint: 'https://site.example/otel',
  serviceName: 'site-web',
  skipGlobalExtension: true,
  consent: analyticsConsent,
  navigation: hasNavigationApi ? 'navigation-api' : 'popstate',
})

export const reportRouterNavigation = (historyAction: HistoryAction) => {
  if (hasNavigationApi || historyAction === 'POP') return
  analytics.pageView()
}
