import type { OtlpAdmin } from '../otlp/chrome.ts'
import {
  Button,
  Popover,
  tokens,
  type,
} from '../view/design-system'
import { formatDurationMs } from './headline.ts'
import { mcpCallLog, type AdminMcpCallEntry } from './callLog.ts'

const formatArgs = (args: unknown): string => {
  if (args === undefined || args === null) return ''
  if (typeof args !== 'object') return ''
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  try {
    const text = JSON.stringify(args)
    return text.length > 80 ? `${text.slice(0, 80)}…` : text
  } catch {
    return ''
  }
}

const CallRow = ({
  entry,
  admin,
}: {
  entry: AdminMcpCallEntry
  admin: OtlpAdmin
}) => {
  const log = mcpCallLog()
  return (
    <li
      css={`
        display: grid;
        gap: var(--admin-space-4);
        padding-block: var(--admin-space-8);
        border-bottom: 1px solid ${tokens.border1};
        ${type.data}
      `}
    >
      <div>{`→ ${entry.tool} ${formatArgs(entry.args)} ${entry.ms}ms`}</div>
      <div
        css={`
          color: ${entry.ok ? tokens.text2 : tokens.error};
        `}
      >
        {`← ${entry.headline}`}
      </div>
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--admin-space-4);
        `}
      >
        {entry.filter ? (
          <Button
            variant="ghost"
            label="Apply this filter"
            onClick={() => log.applyThisFilter(admin, entry)}
          >
            Apply this filter
          </Button>
        ) : null}
        {entry.recordIds.length > 0 ? (
          <Button
            variant="ghost"
            label="Show on timeline"
            onClick={() => log.showOnTimeline(admin, entry)}
          >
            Show on timeline
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export const AgentCallLog = ({ admin }: { admin: OtlpAdmin }) => {
  const log = mcpCallLog()
  return (
    <div data-testid="agent-call-log">
      <Popover
        triggerLabel={() => {
          log.revision()
          const count = log.entries().length
          return count === 0 ? 'Agent' : `Agent · ${count}`
        }}
        label="Agent calls"
        placement="top"
      >
        <ol
          css={`
            margin: 0;
            padding: 0;
            list-style: none;
          `}
        >
          {() => {
            log.revision()
            const rows = log.entries()
            if (rows.length === 0) return <li>No agent calls yet</li>
            return rows.map((entry) => (
              <CallRow entry={entry} admin={admin} />
            ))
          }}
        </ol>
        <p
          data-testid="agent-call-log-footer"
          css={`
            ${type.meta}
            margin: var(--admin-space-8) 0 0;
            color: ${tokens.text3};
          `}
        >
          {() => {
            log.revision()
            return `${log.entries().length} calls · ${formatDurationMs(log.totalMs())} · ${log.writeCount()} writes`
          }}
        </p>
      </Popover>
    </div>
  )
}
