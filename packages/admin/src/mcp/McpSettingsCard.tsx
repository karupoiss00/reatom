import { atom } from '@reatom/core'

import { focusVisible, tokens, type } from '../view/design-system'
import {
  ADMIN_MCP_TOOL_NAMES,
  IN_PROCESS_MCP_SNIPPET,
  registeredMcpBridge,
} from './bridge.ts'

const CLIENTS = [
  { id: 'claude-code', label: 'Claude Code', path: '.mcp.json' },
  { id: 'cursor', label: 'Cursor', path: '.cursor/mcp.json' },
  { id: 'other', label: 'Other', path: 'mcp.json' },
] as const

export const McpSettingsCard = () => {
  const client = atom<(typeof CLIENTS)[number]['id']>(
    'claude-code',
    '_Admin.mcp.settingsClient',
  )

  return (
    <section
      data-testid="mcp-settings-card"
      css={`
        display: grid;
        gap: var(--admin-space-12);
      `}
    >
      <h2
        css={`
          ${type.title}
          margin: 0;
          color: ${tokens.text1};
        `}
      >
        Agents (MCP)
      </h2>
      <p
        data-testid="mcp-settings-status"
        css={`
          ${type.body}
          margin: 0;
          color: ${tokens.text2};
        `}
      >
        {`${ADMIN_MCP_TOOL_NAMES.length} tools · in-process · read-only except clear and connectRemote`}
      </p>
      <p
        css={`
          ${type.meta}
          margin: 0;
          color: ${tokens.text3};
        `}
      >
        clear writes the store and cannot be undone. connectRemote writes
        ClickHouse credentials into the form and fetches.
      </p>
      {() => {
        const bridge = registeredMcpBridge()
        if (!bridge) {
          return (
            <div
              css={`
                display: grid;
                gap: var(--admin-space-8);
              `}
            >
              <p
                css={`
                  ${type.body}
                  margin: 0;
                  color: ${tokens.text2};
                `}
              >
                Calls run inside the page. There is no hosted endpoint.
              </p>
              <pre
                data-testid="mcp-settings-snippet"
                css={`
                  ${type.data}
                  margin: 0;
                  padding: var(--admin-space-8);
                  border: 1px solid ${tokens.border1};
                  border-radius: var(--admin-radius-4);
                  background: ${tokens.surface2};
                  color: ${tokens.text1};
                  white-space: pre-wrap;
                `}
              >
                {IN_PROCESS_MCP_SNIPPET}
              </pre>
            </div>
          )
        }
        return (
          <div
            css={`
              display: grid;
              gap: var(--admin-space-8);
            `}
          >
            <p
              css={`
                ${type.body}
                margin: 0;
                color: ${tokens.text2};
              `}
            >
              Quick setup
            </p>
            <div
              role="tablist"
              aria-label="MCP client"
              css={`
                display: flex;
                flex-wrap: wrap;
                gap: var(--admin-space-8);
              `}
            >
              {CLIENTS.map((option) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={() =>
                    client() === option.id ? 'true' : 'false'
                  }
                  on:click={() => client.set(option.id)}
                  css={`
                    display: inline-flex;
                    align-items: center;
                    min-height: var(--admin-control-height);
                    padding: var(--admin-space-8);
                    border: 1px solid ${tokens.border1};
                    border-radius: var(--admin-radius-4);
                    background: ${tokens.surface2};
                    color: ${tokens.text1};
                    ${type.ui}
                    cursor: pointer;
                    ${focusVisible}
                    &[aria-selected='true'] {
                      border-color: ${tokens.accent};
                      background: ${tokens.surface3};
                    }
                  `}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p
              css={`
                ${type.meta}
                margin: 0;
                color: ${tokens.text3};
              `}
            >
              {() =>
                `Config path: ${bridge.configPath ?? CLIENTS.find((option) => option.id === client())?.path}`
              }
            </p>
            <pre
              data-testid="mcp-settings-snippet"
              css={`
                ${type.data}
                margin: 0;
                padding: var(--admin-space-8);
                border: 1px solid ${tokens.border1};
                border-radius: var(--admin-radius-4);
                background: ${tokens.surface2};
                color: ${tokens.text1};
                white-space: pre-wrap;
              `}
            >
              {bridge.snippet}
            </pre>
          </div>
        )
      }}
    </section>
  )
}
