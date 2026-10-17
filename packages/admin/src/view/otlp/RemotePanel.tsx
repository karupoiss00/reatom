import { CLICKHOUSE_FETCH_LIMIT, type OtlpAdmin } from '../../otlp'
import {
  Button,
  Hint,
  controlBase,
  focusVisible,
  tokens,
  type,
} from '../design-system'
import { ClickHouseEmptyState } from './emptyStates'

export interface OtlpRemotePanelProps {
  admin: OtlpAdmin
}

const fieldCss = `
  display: grid;
  gap: var(--admin-space-4);
  ${type.meta}
  color: ${tokens.text2};
`

const inputCss = `
  ${controlBase}
  ${focusVisible}
  padding-inline: var(--admin-space-8);
  background: ${tokens.surface2};
  color: ${tokens.text1};
  min-width: 0;
`

export const OtlpRemotePanel = ({ admin }: OtlpRemotePanelProps) => {
  const fields = admin.remoteForm.fields
  return (
    <form
      model={admin.remoteForm}
      data-testid="otlp-remote-panel"
      data-reatom-name="OtlpRemotePanel"
      css={`
        display: grid;
        grid-template-columns: repeat(4, minmax(8rem, 1fr)) auto;
        gap: var(--admin-space-8);
        align-items: end;
        padding: var(--admin-space-8) var(--admin-space-12);
        border-bottom: 1px solid ${tokens.border1};
        background: ${tokens.surface1};
      `}
    >
      <label css={fieldCss}>
        ClickHouse URL
        <input
          model:field={fields.url}
          attr:type="url"
          name="url"
          autocomplete="off"
          data-testid="otlp-remote-url"
          aria-label="ClickHouse URL"
          css={inputCss}
        />
        <Hint>HTTP endpoint for this ClickHouse instance.</Hint>
      </label>
      <label css={fieldCss}>
        Database
        <input
          model:field={fields.database}
          attr:type="text"
          name="database"
          autocomplete="off"
          data-testid="otlp-remote-database"
          aria-label="ClickHouse database"
          css={inputCss}
        />
        <Hint>Reads otel_traces and otel_logs.</Hint>
      </label>
      <label css={fieldCss}>
        User
        <input
          model:field={fields.user}
          attr:type="text"
          name="user"
          autocomplete="off"
          data-testid="otlp-remote-user"
          aria-label="ClickHouse user"
          css={inputCss}
        />
        <Hint>ClickHouse user for those two tables.</Hint>
      </label>
      <label css={fieldCss}>
        Password
        <input
          model:field={fields.password}
          attr:type="password"
          name="password"
          autocomplete="off"
          data-testid="otlp-remote-password"
          aria-label="ClickHouse password"
          css={inputCss}
        />
        <Hint>Stays in memory for this session. Nothing is saved.</Hint>
      </label>
      <div
        css={`
          display: grid;
          gap: var(--admin-space-4);
        `}
      >
        <Button
          type="submit"
          variant="primary"
          label="Connect ClickHouse"
          testId="otlp-remote-connect"
          disabled={() => !admin.remoteForm.submit.ready()}
          onClick={() => {}}
        >
          {() => (admin.remoteForm.submit.ready() ? 'Connect' : 'Connecting')}
        </Button>
        <Hint>{`Fetches the newest ${CLICKHOUSE_FETCH_LIMIT} spans and ${CLICKHOUSE_FETCH_LIMIT} logs.`}</Hint>
      </div>
      <p
        data-testid="otlp-remote-error"
        css={`
          grid-column: 1 / -1;
          margin: 0;
          ${type.meta}
          color: ${tokens.error};
          min-height: 1em;
        `}
      >
        {() => admin.remoteForm.submit.error()?.message ?? ''}
      </p>
      {() => {
        const message = admin.remoteForm.submit.error()?.message ?? ''
        if (message === '') return null
        return (
          <div
            css={`
              grid-column: 1 / -1;
            `}
          >
            <ClickHouseEmptyState
              message={message}
              onRetry={() => {
                void admin.remoteForm.submit()
              }}
            />
          </div>
        )
      }}
    </form>
  )
}
