import type { AnalyticsConsentCounts } from './analytics.ts'
import { CLICKHOUSE_FETCH_LIMIT } from './clickhouse.ts'
import type { OtlpTimelineUnit } from './analyticsModel.ts'
import { hasActiveFilter } from './filter.ts'
import type { AdminMcpFilter } from '../mcp/types.ts'

export type ExclusionKind = 'consent' | 'remoteCap' | 'hidden' | 'segment'

export interface ExclusionDraft {
  kind: ExclusionKind
  text: string
  actionLabel: string
}

export interface ExclusionInput {
  consent: AnalyticsConsentCounts
  source: 'live' | 'replay' | 'remote'
  hiddenRows: number
  filter: AdminMcpFilter
  view: 'timeline' | 'state' | 'graph' | 'analytics' | 'settings'
  timelineUnit: OtlpTimelineUnit
}

function consentExclusionText(consent: AnalyticsConsentCounts): string {
  const visitors = consent.excludedVisitors
  const events = consent.excludedEvents
  if (visitors === events) {
    return visitors === 1
      ? '1 visitor has no consent and is excluded'
      : `${visitors} visitors have no consent and are excluded`
  }
  return events === 1
    ? '1 event has no consent and is excluded'
    : `${events} events have no consent and are excluded`
}

export function exclusionDrafts(input: ExclusionInput): ExclusionDraft[] {
  const drafts: ExclusionDraft[] = []
  if (input.consent.excludedEvents > 0) {
    drafts.push({
      kind: 'consent',
      text: consentExclusionText(input.consent),
      actionLabel: 'Docs',
    })
  }
  if (input.source === 'remote') {
    drafts.push({
      kind: 'remoteCap',
      text: `latest ${CLICKHOUSE_FETCH_LIMIT} records per signal`,
      actionLabel: 'Remote',
    })
  }
  if (input.hiddenRows > 0) {
    drafts.push({
      kind: 'hidden',
      text: `${input.hiddenRows} rows hidden`,
      actionLabel: 'Show',
    })
  }
  const analystView =
    input.view === 'analytics' ||
    (input.view === 'timeline' && input.timelineUnit === 'paths')
  if (analystView && hasActiveFilter(input.filter)) {
    drafts.push({
      kind: 'segment',
      text: 'Include/Exclude segment active',
      actionLabel: 'Clear',
    })
  }
  return drafts
}
