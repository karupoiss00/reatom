import { computed, peek } from '@reatom/core'

import {
  allowToolOnce,
  alwaysAllowTool,
  denyTool,
} from '../../chat/engine'
import { humanToolName, serverDisplayName } from '../../mcp/names'
import {
  isMcpWriteTool,
  mcpBusy,
  mcpToolHostName,
} from '../../mcp/busy'
import { parseToolResult, toolCallIntent } from '../../mcp/intent'
import { mcpServers, mcpTools } from '../../mcp'
import { safeUrl } from '../../render/sanitize'
import type { ChatId, ToolCallRecord } from '../../storage/types'
import { Button } from '../../ui'
import type { AssistantSlotProps } from '../slots'

export interface ToolCardProps extends AssistantSlotProps {
  callId: string
}

const prettyArguments = (raw: string) => {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2)
  } catch {
    return raw
  }
}

const statusCopy = (call: ToolCallRecord, host: string, busy: boolean) => {
  if (call.status === 'calling') return `Calling ${host}…`
  if (call.status === 'denied') return 'Denied — it did not run.'
  if (call.status === 'error') {
    const failed = parseToolResult(call.result).text
    return failed.length > 0
      ? failed
      : `${host} stopped. Reconnect and check the server is running.`
  }
  if (busy) return `${host} busy`
  return null
}

export const ToolCard = ({ chat, message, callId }: ToolCardProps) => {
  const messageId = peek(message).id
  const name = `features.thread.toolCard#${messageId}.${callId}`
  const call = computed((): ToolCallRecord | null => {
    const current = message()
    return current.toolCalls?.find((item) => item.id === callId) ?? null
  }, `${name}.call`)

  return (
    <article
      data-mcp-tool-card=""
      data-fusion-tool-card=""
      data-tool-card=""
      data-call-id={callId}
      css={`
        display: grid;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--line);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
      `}
    >
      {() => {
        const current = call()
        if (!current) return null
        const host = mcpToolHostName(current.name)
        const server = serverDisplayName(mcpServers()[0]?.name)
        const human = humanToolName(current.name)
        const busy = mcpBusy()
        const notice = statusCopy(current, server, busy)
        const waiting = current.status === 'waiting'
        const write = isMcpWriteTool(current.name)
        const chatId = chat.id
        const intent = toolCallIntent(current, mcpTools())
        const completed =
          current.status === 'completed' ? parseToolResult(current.result) : null
        return (
          <div
            css={`
              display: grid;
              gap: var(--space-3);
              min-width: 0;
            `}
          >
            <header
              css={`
                display: grid;
                gap: 0.15rem;
                min-width: 0;
              `}
            >
              <strong
                css={`
                  color: var(--text);
                  font-size: var(--text-sm);
                  font-weight: var(--weight-medium);
                  line-height: var(--leading-snug);
                `}
              >
                {host} {human}
              </strong>
              <p
                data-mcp-tool-intent=""
                css={`
                  margin: 0;
                  color: var(--text-muted);
                  font-size: var(--text-sm);
                  line-height: var(--leading-snug);
                `}
              >
                {intent}
              </p>
            </header>
            <details
              open
              css={`
                min-width: 0;

                & summary {
                  cursor: pointer;
                  color: var(--text-muted);
                  font-size: var(--text-xs);
                }
              `}
            >
              <summary>Arguments</summary>
              <pre
                css={`
                  margin: var(--space-2) 0 0;
                  padding: var(--space-2);
                  overflow: auto;
                  border-radius: var(--radius-sm);
                  background: var(--bg);
                  color: var(--text);
                  font-size: var(--text-xs);
                  line-height: var(--leading-snug);
                  white-space: pre-wrap;
                `}
              >
                {prettyArguments(current.arguments)}
              </pre>
            </details>
            {notice ? (
              <p
                data-mcp-tool-status={current.status}
                css={`
                  margin: 0;
                  color: var(--text-muted);
                  font-size: var(--text-sm);
                  line-height: var(--leading-snug);
                `}
              >
                {notice}
              </p>
            ) : null}
            {completed ? (
              <div
                data-mcp-tool-result=""
                data-mcp-tool-status="completed"
                css={`
                  display: grid;
                  gap: var(--space-2);
                  min-width: 0;
                `}
              >
                {completed.text.length > 0 ? (
                  <p
                    css={`
                      margin: 0;
                      color: var(--text);
                      font-size: var(--text-sm);
                      line-height: var(--leading-snug);
                    `}
                  >
                    {completed.text}
                  </p>
                ) : (
                  <p
                    css={`
                      margin: 0;
                      color: var(--text-muted);
                      font-size: var(--text-sm);
                    `}
                  >
                    Completed
                  </p>
                )}
                {completed.images.map((src) => {
                  const href = safeUrl(src)
                  if (!href) return null
                  return (
                    <img
                      src={href}
                      alt={`${host} ${human} result`}
                      css={`
                        max-width: 100%;
                        border-radius: var(--radius-sm);
                      `}
                    />
                  )
                })}
              </div>
            ) : null}
            {waiting && chatId !== 'new' ? (
              <div
                css={`
                  display: flex;
                  flex-wrap: wrap;
                  gap: var(--space-2);
                `}
              >
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  on:click={() => allowToolOnce(chatId as ChatId, messageId, callId)}
                >
                  Allow once
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  on:click={() => denyTool(chatId as ChatId, messageId, callId)}
                >
                  Deny
                </Button>
                {write ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    on:click={() =>
                      alwaysAllowTool(chatId as ChatId, messageId, callId)
                    }
                  >
                    Always
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        )
      }}
    </article>
  )
}
