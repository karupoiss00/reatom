import {
  connectMcp,
  exampleMcpUrl,
  isMcpUrlFieldError,
  mcpError,
  mcpReady,
  mcpTools,
  mcpUrlDraft,
  removeMcpServer,
} from '../../../mcp'
import { mcpServers } from '../../../storage/prefs'
import { Banner, Button, TextField } from '../../../ui'

const headingStyles = `
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-display);
`

const noteStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-wrap: pretty;
`

const syncDraftFromSaved = () => {
  const saved = mcpServers()[0]?.url
  if (saved) mcpUrlDraft.set(saved)
}

const submitFromField = (event: Event) => {
  const root = (event.currentTarget as HTMLElement).closest(
    '[data-slot="McpSection"]',
  )
  const field = root?.querySelector('input, textarea')
  const typed =
    field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
      ? field.value
      : mcpUrlDraft()
  mcpUrlDraft.set(typed)
  void connectMcp(typed)
}

const SavedServer = () => (
  <span css="display: contents;">
    {() => {
      const server = mcpServers()[0]
      if (!server) return null
      const tools = mcpTools()
      const ready = mcpReady()
      const failed = Boolean(mcpError())
      const connecting = !connectMcp.ready()
      const status = ready
        ? 'ready'
        : failed
          ? 'failed'
          : connecting
            ? 'connecting'
            : 'saved'
      return (
        <div
          data-mcp-saved=""
          data-mcp-status={status}
          css={`
            display: grid;
            gap: var(--space-2);
            min-width: 0;
            padding: var(--space-3);
            border: 1px solid var(--line);
            border-radius: var(--radius-md);
            background: var(--bg-elevated);

            &[data-mcp-status='failed'] {
              border-color: var(--danger-line);
            }
          `}
        >
          <p
            css={`
              margin: 0;
              font-size: var(--text-sm);
              font-weight: var(--weight-medium);
            `}
          >
            {server.name ?? 'MCP'}
          </p>
          <p
            css={`
              margin: 0;
              color: var(--text-muted);
              font-size: var(--text-sm);
              font-variant-numeric: tabular-nums;
              overflow-wrap: anywhere;
            `}
          >
            {server.url}
          </p>
          {tools.length > 0 ? (
            <ul
              data-mcp-tools=""
              css={`
                display: grid;
                gap: var(--space-1);
                margin: 0;
                padding: 0;
                list-style: none;
              `}
            >
              {tools.map((tool) => (
                <li
                  css={`
                    color: var(--text);
                    font-size: var(--text-sm);
                    line-height: var(--leading-snug);
                  `}
                >
                  {tool.humanName}
                  {tool.description ? (
                    <span css="color: var(--text-muted);">
                      {' — '}
                      {tool.description}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p css={noteStyles}>
              {connecting
                ? 'Connecting…'
                : failed
                  ? 'Disconnected'
                  : ready
                    ? 'No tools listed.'
                    : 'Saved. Reconnect to list tools.'}
            </p>
          )}
        </div>
      )
    }}
  </span>
)

export const McpSection = () => (
  <section
    data-slot="McpSection"
    aria-label="MCP"
    ref={syncDraftFromSaved}
    css={`
      display: grid;
      align-content: start;
      gap: var(--space-5);
      min-width: 0;
      max-width: 36rem;
    `}
  >
    <div css="display: grid; gap: var(--space-1); min-width: 0;">
      <h3 css={headingStyles}>MCP</h3>
      <p css={noteStyles}>
        Paste any Streamable HTTP MCP URL. localhost is rewritten to 127.0.0.1.
        Example: {exampleMcpUrl}
      </p>
    </div>
    <TextField
      label="MCP URL"
      name="mcp"
      placeholder={exampleMcpUrl}
      value={mcpUrlDraft}
      hint="Example endpoint. Edit or remove a saved URL to try again."
      error={() => {
        const message = mcpError()
        return message && isMcpUrlFieldError(message) ? message : null
      }}
    />
    <div
      css={`
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
      `}
    >
      <Button
        variant="primary"
        size="sm"
        loading={() => !connectMcp.ready()}
        on:click={submitFromField}
      >
        {() =>
          mcpServers().length > 0 || mcpError() ? 'Reconnect' : 'Connect'
        }
      </Button>
      {() =>
        mcpServers().length > 0 ? (
          <Button variant="ghost" size="sm" on:click={() => removeMcpServer()}>
            Remove
          </Button>
        ) : null
      }
    </div>
    {() => <SavedServer />}
    {() => {
      const message = mcpError()
      if (!message || isMcpUrlFieldError(message)) return null
      return <Banner tone="danger" title={message} />
    }}
  </section>
)
