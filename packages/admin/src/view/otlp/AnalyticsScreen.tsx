import { atom, type Atom } from '@reatom/core'

import { CLICKHOUSE_FETCH_LIMIT, type OtlpAdmin } from '../../otlp'
import {
  ANALYTICS_BOUNCE_WARNING,
  analyticsDeltaText,
  analyticsFunnelMeta,
  analyticsPercentText,
  type AnalyticsBreakdownDimension,
  type AnalyticsBreakdownRow,
  type AnalyticsTotals,
  type AnalyticsTrendMetric,
} from '../../otlp/analytics'
import {
  Button,
  Eyebrow,
  FunnelTrack,
  KpiCell,
  Popover,
  SearchField,
  Tabs,
  barHatch,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { AnalyticsEmptyState } from './emptyStates'
import { formatAxisOffset } from './GanttChart'

const TOP_ROWS = 10

const PAGE_TABS = [
  { id: 'page' as const, label: 'Pages', title: 'Pages' },
  { id: 'entry' as const, label: 'Entries', title: 'Entry pages' },
  { id: 'exit' as const, label: 'Exits', title: 'Exit pages' },
]

const SOURCE_TABS = [
  { id: 'source' as const, label: 'Source', title: 'Sources' },
  { id: 'campaign' as const, label: 'Campaign', title: 'Campaign' },
  { id: 'clickId' as const, label: 'Click id', title: 'Click id' },
]

export function analystStatusWords(admin: OtlpAdmin): string {
  const shown = admin.analytics.segment().length
  const total = admin.analytics.sessions().length
  const source =
    admin.source() === 'remote'
      ? 'ClickHouse'
      : admin.source() === 'replay'
        ? 'Replay'
        : 'Live'
  const partial =
    admin.source() === 'remote'
      ? ` · latest ${CLICKHOUSE_FETCH_LIMIT} records per signal`
      : ''
  return `${shown} of ${total} consented sessions · ${source}${partial}`
}

const sessionCaption = (sessions: number) =>
  `Of ${sessions} consented sessions`

const showErrorSessions = (admin: OtlpAdmin) => {
  admin.filterHasError.set(true)
  admin.view.set('timeline')
  admin.timelineUnit.set('records')
}

let breakdownCardCounter = 0

export const OtlpAnalyticsScreen = ({ admin }: { admin: OtlpAdmin }) => (
  <section
    data-testid="otlp-analytics"
    data-reatom-name="AnalyticsScreen"
    css={`
      ${scrollable}
      box-sizing: border-box;
      display: grid;
      align-content: start;
      gap: var(--admin-space-16);
      height: 100%;
      min-height: 0;
      padding: var(--admin-space-12);
      background: ${tokens.canvas};
      color: ${tokens.text1};
    `}
  >
    <p
      data-testid="analytics-status"
      css={`
        ${type.meta}
        margin: 0;
        color: ${tokens.text2};
      `}
    >
      {() => analystStatusWords(admin)}
    </p>
    {() => {
      const sessions = admin.analytics.sessions().length
      return sessions > 0 && sessions < 5 ? (
        <p
          css={`
            ${type.meta}
            margin: 0;
            color: ${tokens.text3};
          `}
        >
          Shares hide below 5 sessions
        </p>
      ) : null
    }}
    {() =>
      admin.analytics.sessions().length === 0 ? (
        <AnalyticsEmptyState />
      ) : (
        <div
          css={`
            display: grid;
            gap: var(--admin-space-16);
            min-width: 0;
          `}
        >
          <AnalyticsKpis admin={admin} />
          <AnalyticsTrend admin={admin} />
          <div
            css={`
              display: grid;
              grid-template-columns: repeat(
                auto-fit,
                minmax(min(100%, 360px), 1fr)
              );
              gap: var(--admin-space-12);
              min-width: 0;
            `}
          >
            <PageBreakdownCard admin={admin} />
            <SourceBreakdownCard admin={admin} />
          </div>
        </div>
      )
    }
  </section>
)

const AnalyticsKpis = ({ admin }: { admin: OtlpAdmin }) => (
  <div
    css={`
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-12) 0;
    `}
  >
    {() => {
      const totals = admin.analytics.totals()
      const sessions = totals.sessions
      const deltas = admin.analytics.deltas()
      const first = deltas?.first
      const second = deltas?.second
      const deltaOf = (
        pick: (item: AnalyticsTotals) => number,
      ): string | undefined => {
        if (!first || !second) return undefined
        return analyticsDeltaText(pick(second), pick(first))
      }
      const setMetric = (metric: AnalyticsTrendMetric) => {
        admin.analytics.trendMetric.set(metric)
      }
      const errorCount = totals.sessionsWithErrors
      return (
        <>
          <KpiCell
            id="visitors"
            label="Visitors"
            value={String(totals.visitors)}
            caption={sessionCaption(sessions)}
            delta={deltaOf((item) => item.visitors)}
            onClick={() => setMetric('visitors')}
          />
          <KpiCell
            id="sessions"
            label="Sessions"
            value={String(totals.sessions)}
            caption={sessionCaption(sessions)}
            delta={deltaOf((item) => item.sessions)}
            onClick={() => setMetric('sessions')}
          />
          <KpiCell
            id="pageViews"
            label="Page views"
            value={String(totals.pageViews)}
            caption={sessionCaption(sessions)}
            delta={deltaOf((item) => item.pageViews)}
            onClick={() => setMetric('pageViews')}
          />
          <KpiCell
            id="engaged"
            label="Engaged"
            value={`${totals.engagedSessions} · ${analyticsPercentText(totals.engagementRate, sessions)}`}
            caption="active > 10s or ≥ 2 views"
            delta={deltaOf((item) => item.engagedSessions)}
            onClick={() => setMetric('engaged')}
          />
          <KpiCell
            id="bounce"
            label="Bounce"
            value={analyticsPercentText(totals.bounceRate, sessions)}
            caption={sessionCaption(sessions)}
            tone={
              totals.bounceRate > ANALYTICS_BOUNCE_WARNING
                ? 'warning'
                : 'default'
            }
            onClick={() => setMetric('sessions')}
          />
          <KpiCell
            id="activeTime"
            label="Median active"
            value={formatAxisOffset(totals.activeMsPerSession.median)}
            caption={sessionCaption(sessions)}
            onClick={() => setMetric('sessions')}
          />
          <KpiCell
            id="errors"
            label="Errors"
            value={String(errorCount)}
            caption={sessionCaption(sessions)}
            tone={errorCount > 0 ? 'error' : 'muted'}
            delta={deltaOf((item) => item.sessionsWithErrors)}
            onClick={
              errorCount > 0
                ? () => {
                    setMetric('errors')
                    showErrorSessions(admin)
                  }
                : () => setMetric('errors')
            }
          />
        </>
      )
    }}
  </div>
)

const AnalyticsTrend = ({ admin }: { admin: OtlpAdmin }) => (
  <div
    data-testid="analytics-trend"
    role="img"
    aria-label={() => {
      const trend = admin.analytics.trend()
      const sessions = trend.buckets.reduce(
        (sum, bucket) => sum + bucket.sessions,
        0,
      )
      return `${trend.buckets.length} buckets of ${formatAxisOffset(trend.bucketMs)}, ${sessions} sessions`
    }}
    css={`
      display: flex;
      align-items: end;
      gap: 2px;
      height: 72px;
      min-width: 0;
      padding: var(--admin-space-8);
      background: ${tokens.surface1};
      border: 1px solid ${tokens.border1};
      border-radius: var(--admin-radius-2);
    `}
  >
    {() => {
      const trend = admin.analytics.trend()
      const metric = admin.analytics.trendMetric()
      const live = admin.source() === 'live'
      const now = Date.now()
      const values = trend.buckets.map((bucket) => bucket[metric])
      const max = values.reduce((peak, value) => Math.max(peak, value), 0)
      return trend.buckets.map((bucket, index) => {
        const value = values[index] ?? 0
        const last = index === trend.buckets.length - 1
        const open = live && last && now < bucket.start + trend.bucketMs
        return (
          <div
            title={open ? 'This bucket is still open' : `${value}`}
            data-open={open ? 'true' : undefined}
            style:height={max === 0 ? '0%' : `${(value / max) * 100}%`}
            css={`
              flex: 1 1 0;
              min-width: 2px;
              background: ${tokens.accent};
              &[data-open='true'] {
                background: ${barHatch}, ${tokens.surface3};
              }
            `}
          />
        )
      })
    }}
  </div>
)

const PageBreakdownCard = ({ admin }: { admin: OtlpAdmin }) => {
  const tab = atom<(typeof PAGE_TABS)[number]['id']>(
    'page',
    `_Admin.analytics.pageTab.${++breakdownCardCounter}`,
  )
  return (
    <BreakdownCard
      admin={admin}
      tab={tab}
      items={PAGE_TABS}
      paths
      empty="No pages in this segment."
    />
  )
}

const SourceBreakdownCard = ({ admin }: { admin: OtlpAdmin }) => {
  const tab = atom<(typeof SOURCE_TABS)[number]['id']>(
    'source',
    `_Admin.analytics.sourceTab.${++breakdownCardCounter}`,
  )
  return (
    <BreakdownCard
      admin={admin}
      tab={tab}
      items={SOURCE_TABS}
      paths={false}
      empty={() => {
        const dimension = tab()
        if (dimension === 'campaign') {
          return 'No campaign attributes on these sessions. Analytics reads app.utm.campaign and app.attribution.last.campaign.'
        }
        if (dimension === 'clickId') {
          return 'No click id attributes on these sessions. Analytics reads app.click_id.* and app.attribution.last.*clid.'
        }
        return 'No sources in this segment.'
      }}
    />
  )
}

const BreakdownCard = <T extends AnalyticsBreakdownDimension>({
  admin,
  tab,
  items,
  paths,
  empty,
}: {
  admin: OtlpAdmin
  tab: Atom<T>
  items: ReadonlyArray<{ id: T; label: string; title: string }>
  paths: boolean
  empty: string | (() => string)
}) => {
  const query = atom(
    '',
    `_Admin.analytics.filter.${items[0]!.id}.${++breakdownCardCounter}`,
  )
  const titleOf = (dimension: AnalyticsBreakdownDimension) =>
    items.find((item) => item.id === dimension)?.title ?? dimension
  const rowsOf = (dimension: AnalyticsBreakdownDimension) => {
    if (dimension === 'campaign') return admin.analytics.campaignRows()
    if (dimension === 'clickId') return admin.analytics.clickIdRows()
    return admin.analytics.breakdowns()[dimension]
  }
  return (
    <div
      css={`
        display: grid;
        gap: var(--admin-space-8);
        min-width: 0;
        padding: var(--admin-space-12);
        border: 1px solid ${tokens.border1};
        border-radius: var(--admin-radius-4);
        background: ${tokens.surface1};
      `}
    >
      <Eyebrow>{() => titleOf(tab())}</Eyebrow>
      <Tabs value={tab} items={[...items]} ariaLabel={items[0]!.label} />
      <SearchField
        value={query}
        label="Filter"
        placeholder="Filter…"
        shortcut=""
      />
      {() => {
        const dimension = tab()
        const needle = query().trim().toLowerCase()
        const rows = rowsOf(dimension).filter(
          (row) =>
            needle === '' || row.key.toLowerCase().includes(needle),
        )
        const shown = rows.slice(0, TOP_ROWS)
        const hidden = rows.length - shown.length
        const totalSessions = admin.analytics.segment().length
        if (shown.length === 0) {
          return (
            <p
              data-testid={`analytics-breakdown-${dimension}`}
              css={`
                ${type.ui}
                margin: 0;
                color: ${tokens.text2};
              `}
            >
              {typeof empty === 'function' ? empty() : empty}
            </p>
          )
        }
        return (
          <div
            data-testid={`analytics-breakdown-${dimension}`}
            css={`
              display: grid;
              gap: var(--admin-space-12);
            `}
          >
            {shown.map((row) => (
              <BreakdownRow
                admin={admin}
                dimension={dimension}
                title={titleOf(dimension)}
                row={row}
                paths={paths}
                totalSessions={totalSessions}
              />
            ))}
            {hidden > 0 ? <p css={moreRows}>{`+${hidden} more`}</p> : null}
          </div>
        )
      }}
    </div>
  )
}

const BreakdownRow = ({
  admin,
  dimension,
  title,
  row,
  paths,
  totalSessions,
}: {
  admin: OtlpAdmin
  dimension: AnalyticsBreakdownDimension
  title: string
  row: AnalyticsBreakdownRow
  paths: boolean
  totalSessions: number
}) => {
  const share = totalSessions === 0 ? 0 : row.sessions / totalSessions
  const selected = () => {
    const scope = admin.analytics.scope()
    return scope?.dimension === dimension && scope.key === row.key
  }
  const showSessions = () => {
    const focus =
      dimension === 'campaign' || dimension === 'clickId'
        ? undefined
        : { dimension, key: row.key }
    admin.showSessions(
      `${title}: ${row.key}`,
      new Set(row.sessionIds),
      focus,
    )
  }
  const scopeToRow = () => {
    const focus =
      dimension === 'campaign' || dimension === 'clickId'
        ? undefined
        : { dimension, key: row.key }
    admin.analytics.scope.scopeTo(
      `${title}: ${row.key}`,
      new Set(row.sessionIds),
      focus,
    )
  }
  return (
    <div
      data-row-id={row.key}
      data-selected={() => (selected() ? 'true' : undefined)}
      on:click={scopeToRow}
      css={`
        display: grid;
        gap: var(--admin-space-6);
        cursor: pointer;
        &[data-selected='true'] {
          outline: 1px solid ${tokens.accent};
          outline-offset: 4px;
        }
      `}
    >
      <FunnelTrack
        label={row.key}
        meta={analyticsFunnelMeta(row.sessions, share, totalSessions)}
        fill={share}
      />
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--admin-space-4);
        `}
        on:click={(event: MouseEvent) => event.stopPropagation()}
      >
        <Button
          variant="ghost"
          label={`Show sessions ${row.key}`}
          onClick={showSessions}
        >
          Show sessions
        </Button>
        {paths ? (
          <Popover triggerLabel="More" label={`More actions for ${row.key}`}>
            <Button
              variant="ghost"
              label={`Paths from here ${row.key}`}
              onClick={() => admin.showPaths(row.key)}
            >
              Paths from here
            </Button>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}

const moreRows = `
  ${type.meta}
  margin: 0;
  color: ${tokens.text3};
`
