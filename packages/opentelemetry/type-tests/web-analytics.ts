/**
 * Create-mode analytics options must compile next to tracer sampling.
 * `errorSampling` is the analytics exception ratio; `sampling.errors` stays the
 * tracer ring-buffer flag (`'always'`).
 *
 * Public entry is `@reatom/opentelemetry/web-analytics` (package exports →
 * dist). Type-tests compile source, so they import the barrel path rather than
 * the root package (the root must not export `connectWebAnalytics`).
 */
import * as root from '../src/index.ts'
import * as webAnalytics from '../src/web-analytics/index.ts'
import {
  connectWebAnalytics,
  type AnalyticsPage,
  type AnalyticsSession,
  type Attribution,
  type NavigationSource,
  type WebAnalytics,
  type WebAnalyticsCreateOptions,
  type WebAnalyticsOptions,
} from '../src/web-analytics/index.ts'

declare function expectNever<Check extends never>(_check?: Check): void

export function connectWebAnalyticsIsNotARootExport() {
  expectNever(
    null as unknown as Extract<keyof typeof root, 'connectWebAnalytics'>,
  )
}

export function pageViewsSymbolIsNotAWebAnalyticsExport() {
  expectNever(
    null as unknown as Extract<
      keyof typeof webAnalytics,
      | 'PAGE_VIEWS_KEY'
      | 'recordedPageViewsThisLoad'
      | 'hasRecordedPageView'
      | 'rememberRecordedPageView'
    >,
  )
}

export function createModeAnalyticsOptionsCompile(): WebAnalytics {
  const options: WebAnalyticsOptions = {
    consent: true,
    errorSampling: 1,
    rateLimit: { errorsPerMin: 10, eventsPerMin: 60 },
  }
  const create: WebAnalyticsCreateOptions = {
    name: 'site',
    endpoint: 'https://collector.invalid/otel',
    serviceName: 'site-web',
    skipGlobalExtension: true,
    sampling: { ratio: 0.2, errors: 'always' },
    ...options,
  }
  const analytics = connectWebAnalytics(create)
  const page: AnalyticsPage = analytics.pageAtom()
  const session: AnalyticsSession = analytics.sessionAtom()
  const attribution: Attribution = analytics.attributionAtom()
  const navigation: NavigationSource = 'popstate'
  void page
  void session
  void attribution
  void navigation
  return analytics
}

export function analyticsErrorSamplingIsNotTracerErrors() {
  connectWebAnalytics({
    name: 'site',
    endpoint: 'https://collector.invalid/otel',
    serviceName: 'site-web',
    // @ts-expect-error analytics exception ratio is errorSampling, not sampling.errors
    sampling: { errors: 0.5 },
  })
}

export function removedWebVitalsOptionIsRejected(
  otel: import('../src/index.ts').ReatomOpentelemetry,
) {
  // @ts-expect-error Web Vitals requires its explicit optional connector.
  connectWebAnalytics(otel, { webVitals: true })
}
