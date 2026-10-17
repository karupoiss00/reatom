import { computed } from '@reatom/core'

import type { AdminConnection, AdminRecord, OtlpAdmin } from '../../otlp'
import { explainEmptyClauses } from '../../otlp'
import {
  Button,
  CodeChip,
  EmptyState,
  tokens,
  type,
} from '../design-system'
import { ImportRecords } from './ImportRecords'

export const CONNECT_ADMIN_SNIPPET = `import { connectAdmin } from '@reatom/admin'

connectAdmin(otel)`

const DOCS_HREF = 'https://v1001.reatom.dev'

export function selectLatestAction(admin: OtlpAdmin): AdminRecord | null {
  let latest: AdminRecord | null = null
  for (const record of admin.records()) {
    if (record.reatomKind !== 'action') continue
    if (latest === null || record.start > latest.start) latest = record
  }
  if (latest === null) {
    for (const record of admin.records()) {
      if (latest === null || record.start > latest.start) latest = record
    }
  }
  if (latest === null) return null
  admin.selectRecord(latest)
  admin.cardOpen.setTrue()
  return latest
}

const copySnippet = async () => {
  try {
    await navigator.clipboard.writeText(CONNECT_ADMIN_SNIPPET)
  } catch {
    return
  }
}

export const NoTracerEmpty = ({ admin }: { admin: OtlpAdmin }) => (
  <EmptyState
    testId="empty-no-tracer"
    icon="timeline"
    title="No tracer connected"
    description="Mount connectAdmin so this panel receives live spans and logs."
    docsHref={DOCS_HREF}
    docsLabel="OpenTelemetry setup"
    detail={
      <div
        css={`
          display: grid;
          gap: var(--admin-space-8);
        `}
      >
        <pre
          css={`
            ${type.data}
            margin: 0;
            padding: var(--admin-space-8);
            background: ${tokens.surface2};
            border: 1px solid ${tokens.border1};
            border-radius: var(--admin-radius-4);
            white-space: pre-wrap;
          `}
        >
          {CONNECT_ADMIN_SNIPPET}
        </pre>
        <div
          css={`
            display: flex;
            flex-wrap: wrap;
            gap: var(--admin-space-8);
          `}
        >
          <Button
            variant="primary"
            label="Copy connectAdmin snippet"
            onClick={() => {
              void copySnippet()
            }}
          >
            Copy snippet
          </Button>
          <ImportRecords admin={admin} />
        </div>
      </div>
    }
  />
)

export const CapturingEmpty = ({
  connection,
}: {
  connection: AdminConnection
}) => (
  <EmptyState
    testId="empty-capturing"
    icon="timeline"
    title="Capturing"
    description="Interact with the app."
    docsHref={DOCS_HREF}
    docsLabel="OpenTelemetry setup"
    detail={
      <p
        css={`
          ${type.meta}
          margin: 0;
          color: ${tokens.text3};
        `}
      >
        {() => {
          const stats = connection.stats()
          if (!stats) return ''
          return `queued ${stats.queued} · exported ${stats.exported} · dropped ${stats.dropped}`
        }}
      </p>
    }
  />
)

export const NoMatchingEmpty = ({ admin }: { admin: OtlpAdmin }) => (
  <EmptyState
    testId="empty-no-matching"
    icon="filters"
    title="No matching records"
    description="Reset filters to show the captured records again."
    action={
      <Button
        variant="primary"
        label="Reset filters"
        onClick={() => admin.resetFilter()}
      >
        Reset
      </Button>
    }
    docsHref={DOCS_HREF}
    docsLabel="OpenTelemetry setup"
    detail={
      <div
        data-testid="empty-clause-counts"
        css={`
          display: grid;
          gap: var(--admin-space-4);
          ${type.meta}
          color: ${tokens.text3};
        `}
      >
        {() => {
          const clauses = explainEmptyClauses(
            admin.filterCalculator(),
            admin.records(),
          )
          if (clauses === undefined || clauses.length === 0) return null
          const firstZero = clauses.find((clause) => clause.count === 0)
          return clauses.map((clause) => (
            <span
              data-zero={
                firstZero !== undefined && clause.clause === firstZero.clause
                  ? 'true'
                  : undefined
              }
              css={`
                &[data-zero='true'] {
                  color: ${tokens.warning};
                }
              `}
            >
              {`${clause.clause} ${clause.count}`}
              {firstZero !== undefined && clause.clause === firstZero.clause
                ? ' · first zero'
                : ''}
            </span>
          ))
        }}
      </div>
    }
  />
)

let emptyKindSerial = 0

export const TimelineEmptyState = ({
  admin,
  connection = null,
}: {
  admin: OtlpAdmin
  connection?: AdminConnection | null
}) => {
  const kind = computed(() => {
    if (admin.records().length > 0) return 'noMatch' as const
    return connection ? ('capturing' as const) : ('noTracer' as const)
  }, `_Admin.empty.kind.${++emptyKindSerial}`)
  return (
    <>
      {() => {
        const current = kind()
        if (current === 'noMatch') return <NoMatchingEmpty admin={admin} />
        if (current === 'capturing' && connection) {
          return <CapturingEmpty connection={connection} />
        }
        return <NoTracerEmpty admin={admin} />
      }}
    </>
  )
}

export const PathsEmptyState = () => (
  <EmptyState
    testId="empty-paths"
    icon="route"
    title="No paths"
    description="Paths come from consented page views. Open Analytics after session.start and app.page_view records arrive."
    docsHref={DOCS_HREF}
    docsLabel="OpenTelemetry setup"
  />
)

export const GraphEmptyState = ({ admin }: { admin: OtlpAdmin }) => (
  <EmptyState
    testId="empty-graph"
    icon="graph"
    title="No cause graph"
    description="Select a frame in Timeline"
    action={
      <Button
        variant="primary"
        label="Select the latest action"
        disabled={() => admin.records().length === 0}
        onClick={() => {
          selectLatestAction(admin)
        }}
      >
        Select latest action
      </Button>
    }
    docsHref={DOCS_HREF}
    docsLabel="OpenTelemetry setup"
  />
)

export const AnalyticsEmptyState = () => (
  <EmptyState
    testId="empty-analytics"
    icon="activity"
    title="No analytics sessions"
    description="Analytics needs a consented session.start plus page views that carry session.id."
    docsHref={DOCS_HREF}
    docsLabel="OpenTelemetry setup"
    detail={
      <p
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--admin-space-4);
          margin: 0;
        `}
      >
        <CodeChip>session.start</CodeChip>
        <CodeChip>session.id</CodeChip>
        <CodeChip>app.page_view</CodeChip>
      </p>
    }
  />
)

export const ClickHouseEmptyState = ({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) => {
  const denied = /ClickHouse 40[13]/.test(message)
  return (
    <EmptyState
      testId="empty-clickhouse"
      icon="error"
      iconKind="other"
      title={denied ? 'ClickHouse denied the request' : 'ClickHouse is unreachable'}
      description={
        denied
          ? `${message} Check the ClickHouse user and password, then try Connect again. Credentials stay in this form and are not saved.`
          : `${message} Credentials stay in this form and are not saved.`
      }
      docsHref={DOCS_HREF}
      docsLabel="OpenTelemetry setup"
      detail={
        <ol
          css={`
            ${type.ui}
            margin: 0;
            padding-inline-start: 1.2rem;
            color: ${tokens.text2};
          `}
        >
          <li>Check the HTTP URL reaches ClickHouse.</li>
          <li>Database should be otel, with otel_traces and otel_logs.</li>
          <li>Confirm the user. The password is not saved.</li>
        </ol>
      }
      action={
        <Button variant="primary" label="Retry ClickHouse" onClick={onRetry}>
          Retry
        </Button>
      }
    />
  )
}
