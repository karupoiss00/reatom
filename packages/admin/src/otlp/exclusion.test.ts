import { expect, test } from 'test'

import { analyticsConsentCounts } from './analytics.ts'
import { analyticsLog } from './fixtures/analyticsRecords.ts'
import { exclusionDrafts } from './exclusion.ts'

const emptyConsent = {
  consentedSessions: 0,
  excludedVisitors: 0,
  excludedEvents: 0,
}

const base = {
  consent: emptyConsent,
  source: 'live' as const,
  hiddenRows: 0,
  filter: {},
  view: 'analytics' as const,
  timelineUnit: 'records' as const,
}

test('an empty capture has no exclusion banner', () => {
  expect(exclusionDrafts(base)).toEqual([])
})

test('hidden rows, the remote cap, and a segment each add a clause', () => {
  const drafts = exclusionDrafts({
    ...base,
    source: 'remote',
    hiddenRows: 37,
    filter: { name: 'mount' },
    view: 'timeline',
    timelineUnit: 'paths',
  })
  expect(drafts.map((draft) => draft.kind)).toEqual([
    'remoteCap',
    'hidden',
    'segment',
  ])
  expect(drafts.find((draft) => draft.kind === 'hidden')?.actionLabel).toBe(
    'Show',
  )
})

test('consent wording counts visitors without session.id', () => {
  const drafts = exclusionDrafts({
    ...base,
    consent: analyticsConsentCounts([
      analyticsLog(
        'app.page_view',
        1,
        { 'session.id': 's1', 'url.path': '/' },
        'ok',
      ),
      analyticsLog(
        'app.page_view',
        2,
        { 'url.path': '/private', 'app.visitor.id': 'anon' },
        'denied',
      ),
    ]),
  })
  expect(drafts[0]).toMatchObject({
    kind: 'consent',
    text: '1 visitor has no consent and is excluded',
  })
})
