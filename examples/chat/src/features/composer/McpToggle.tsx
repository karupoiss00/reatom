import { mcpReady, mcpServers, mcpTools } from '../../mcp'
import { Chip } from '../../ui'
import type { ChatSlotProps } from '../slots'

export const McpToggle = ({ chat }: ChatSlotProps) => (
  <span
    data-slot="McpToggle"
    css={`
      display: inline-flex;
      flex: none;
      flex-direction: row;
      align-items: center;
      gap: var(--space-1-5);
    `}
  >
    {() => {
      const server = mcpServers()[0]
      if (!server) return null
      const tools = mcpTools()
      const mcpOn = () => chat.settings().mcpEnabled === true && mcpReady()
      const label = server.name?.trim() || 'MCP'
      return (
        <span
          css={`
            display: inline-flex;
            flex: none;
            align-items: center;
            gap: var(--space-1-5);
          `}
        >
          <Chip
            data-mcp-toggle=""
            aria-label={label}
            selected={mcpOn}
            on:click={() => chat.updateSettings({ mcpEnabled: !mcpOn() })}
          >
            {label}
          </Chip>
          {tools.length > 0 ? (
            <span
              data-mcp-tools=""
              css={`
                color: var(--text-muted);
                font-size: var(--text-xs);
                font-weight: var(--weight-regular);
                white-space: nowrap;
              `}
            >
              {tools.map((tool) => tool.humanName).join(' · ')}
            </span>
          ) : null}
        </span>
      )
    }}
  </span>
)
