import { analyticsConsentCounts } from './analytics.ts'
import type { OtlpTimelineUnit } from './analyticsModel.ts'
import { hasActiveFilter } from './filter.ts'
import type { AdminRecord } from './ingest.ts'
import type { AdminMcpFilter } from '../mcp/types.ts'

export type ExclusionKind = 'consent' | 'remoteCap' | 'hidden' | 'segment'

export interface ExclusionDraft {
  kind: ExclusionKind
  text: string
  actionLabel: string
}

export interface ExclusionInput {
  records: readonly AdminRecord[]
  source: 'live' | 'replay' | 'remote'
  hiddenRows: number
  filter: AdminMcpFilter
  view: 'timeline' | 'state' | 'graph' | 'analytics' | 'settings'
  timelineUnit: OtlpTimelineUnit
}

export function exclusionDrafts(input: ExclusionInput): ExclusionDraft[] {
  const drafts: ExclusionDraft[] = []
  const consent = analyticsConsentCounts(input.records)
  if (consent.excludedSessions > 0) {
    const total = consent.consentedSessions + consent.excludedSessions
    drafts.push({
      kind: 'consent',
      text: `${consent.excludedSessions} of ${total} sessions have no consent and are excluded`,
      actionLabel: 'Docs',
    })
  }
  if (input.source === 'remote') {
    drafts.push({
      kind: 'remoteCap',
      text: 'latest 500 records per signal',
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
