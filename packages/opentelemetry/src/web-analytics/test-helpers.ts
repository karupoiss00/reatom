import { bind } from '@reatom/core'
import {
  reatomOpentelemetry,
  type ReatomOpentelemetry,
  type ReatomOpentelemetryInput,
} from '../reatomOpentelemetry.ts'
import {
  withWebAnalytics,
  type WebAnalyticsOptions,
} from './connectWebAnalytics.ts'

export type AnalyticsFixtureOptions = ReatomOpentelemetryInput &
  WebAnalyticsOptions

const statsReaders = new WeakMap<
  ReatomOpentelemetry,
  ReatomOpentelemetry['stats']
>()
export const readAnalyticsStats = (otel: ReatomOpentelemetry) =>
  statsReaders.get(otel)?.() ?? otel.stats()
const readers = new WeakMap<ReatomOpentelemetry, () => readonly unknown[]>()
export const readAnalyticsRecords = (
  otel: ReatomOpentelemetry,
): readonly unknown[] => readers.get(otel)?.() ?? otel.records()

/** Fixture groups the explicitly created parent and its native extension. */
export const createAnalytics = (
  input: ReatomOpentelemetry | (ReatomOpentelemetryInput & WebAnalyticsOptions),
  options?: WebAnalyticsOptions,
) => {
  const owned = typeof input !== 'function'
  const otel = owned
    ? reatomOpentelemetry({
        ...input,
        skipGlobalExtension: input.skipGlobalExtension ?? true,
      })
    : input
  const { analytics } = otel.extend(withWebAnalytics(owned ? input : options))
  readers.set(otel, bind(otel.records))
  statsReaders.set(otel, Object.assign(bind(otel.stats), otel.stats))
  return {
    analytics,
    visitor: analytics.visitor,
    session: analytics.session,
    page: analytics.page,
    attribution: analytics.attribution,
    focus: analytics.focus,
    pageView: bind(analytics.pageView),
    enable: bind(analytics.setTrue),
    otel,
    dispose: bind(() => (owned ? otel.dispose() : analytics.setFalse())),
  }
}
