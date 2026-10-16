import { atom, peek } from '@reatom/core'

import type { OtlpAdmin } from '../otlp/chrome.ts'
import {
  Button,
  controlBase,
  focusVisible,
  reducedMotion,
  tokens,
  type,
} from '../view/design-system'
import { formatDurationMs } from './headline.ts'
import { mcpCallLog, type AdminMcpCallEntry } from './callLog.ts'

let logCounter = 0

const formatArgs = (args: unknown): string => {
  if (args === undefined || args === null) return ''
  if (typeof args !== 'object') return String(args)
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
            onClick={() => log.applyThisFilter(entry)}
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
  const panelId = `_AdminMcpLog${++logCounter}`
  const titleId = `${panelId}Title`
  const isOpen = atom(false, `_Admin.mcp.callLogOpen.${logCounter}`)
  let anchor: HTMLElement | null = null

  return (
    <div
      data-testid="agent-call-log"
      css={`
        position: relative;
        display: inline-flex;
      `}
      ref={(host: HTMLElement) => {
        anchor = host
        const root = host.getRootNode()
        const onPointerDown = (event: Event) => {
          if (!isOpen() || !anchor) return
          if (event.composedPath().includes(anchor)) return
          isOpen.set(false)
        }
        root.addEventListener('pointerdown', onPointerDown, true)
        return () =>
          root.removeEventListener('pointerdown', onPointerDown, true)
      }}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={() => isOpen()}
        aria-controls={() => (isOpen() ? panelId : undefined)}
        css={`
          ${controlBase}
          ${focusVisible}
          padding-inline: var(--admin-space-8);
          background: ${tokens.surface2};
          color: ${tokens.text1};
          cursor: pointer;
        `}
        on:click={() => isOpen.set(!peek(isOpen))}
      >
        {() => {
          log.revision()
          const count = log.entries().length
          return count === 0 ? 'Agent' : `Agent · ${count}`
        }}
      </button>
      {() =>
        isOpen() ? (
          <div
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabindex={-1}
            css={`
              ${type.body}
              ${reducedMotion}
              position: absolute;
              z-index: 3;
              inset-block-end: calc(100% + var(--admin-space-4));
              inset-inline-start: 0;
              min-width: 18rem;
              max-width: 28rem;
              max-height: 20rem;
              overflow: auto;
              padding: var(--admin-space-8);
              background: ${tokens.surface2};
              color: ${tokens.text1};
              border: 1px solid ${tokens.border1};
              border-radius: var(--admin-radius-4);
            `}
            ref={(panel: HTMLElement) => {
              panel.focus()
              const onKeyDown = (event: Event) => {
                if (!(event instanceof KeyboardEvent)) return
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                isOpen.set(false)
              }
              panel.addEventListener('keydown', onKeyDown)
              return () => panel.removeEventListener('keydown', onKeyDown)
            }}
          >
            <p
              id={titleId}
              css={`
                ${type.meta}
                margin: 0 0 var(--admin-space-4);
                color: ${tokens.text2};
              `}
            >
              Agent calls
            </p>
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
          </div>
        ) : null
      }
    </div>
  )
}
