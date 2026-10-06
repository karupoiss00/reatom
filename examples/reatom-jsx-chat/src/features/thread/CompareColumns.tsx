import { atom, computed, peek, reatomMediaQuery, wrap } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { exitCompare } from '../../chat/compare'
import type { AssistantMessage } from '../../storage/types'
import { Button } from '../../ui'
import type { NodeSlotProps } from '../slots'
import { CompareColumn, streamStatusLabel } from '../compare/Column'
import { modelName } from '../../catalog'

const phoneCompare = reatomMediaQuery(
  '(max-width: 480px)',
  'features.compare.phone',
)

const failed = new Set(['error', 'connection-lost', 'refused'])

export const CompareColumns = ({ chat, node }: NodeSlotProps) => {
  const opened = peek(node).message
  const groupId = opened.role === 'assistant' ? opened.compareGroup : null
  const name = `features.compare.columns#${groupId ?? peek(node).message.id}`
  const activeId = atom<string | null>(null, `${name}.active`)
  const clock = atom(Date.now(), `${name}.clock`)
  const lanes = computed(() => {
    if (!groupId) return []
    return [...chat.messages().values()]
      .filter(
        (message): message is AssistantMessage =>
          message.role === 'assistant' && message.compareGroup === groupId,
      )
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      )
  }, `${name}.lanes`)
  const selectedId = computed(() => {
    const ids = lanes().map((message) => message.id)
    const current = activeId()
    if (current && ids.includes(current)) return current
    return ids[0] ?? null
  }, `${name}.selected`)
  const bothFailed = computed(() => {
    const list = lanes()
    return list.length >= 2 && list.every((message) => failed.has(message.status))
  }, `${name}.bothFailed`)
  const panels = new Map<string, JSX.Element>()
  const tabs = new Map<string, JSX.Element>()

  const panelFor = (messageId: string) => {
    let panel = panels.get(messageId)
    if (!panel) {
      panel = (
        <CompareColumn
          chat={chat}
          messageId={messageId}
          selectedId={selectedId}
          clock={clock}
          panelId={`${name}-panel-${messageId}`}
          labelledBy={`${name}-tab-${messageId}`}
        />
      )
      panels.set(messageId, panel)
    }
    return panel
  }

  const tabFor = (messageId: string) => {
    let tab = tabs.get(messageId)
    if (!tab) {
      const seeded = chat.messages().get(messageId)
      const seed =
        seeded && seeded.role === 'assistant' ? seeded : lanes()[0]!
      const message = computed((): AssistantMessage => {
        const current = chat.messages().get(messageId)
        return current && current.role === 'assistant' ? current : seed
      }, `${name}.tab#${messageId}`)
      tab = (
        <button
          type="button"
          role="tab"
          id={`${name}-tab-${messageId}`}
          aria-controls={`${name}-panel-${messageId}`}
          aria-selected={() => (selectedId() === messageId ? 'true' : 'false')}
          aria-label={() =>
            `${modelName(message().model)}, ${streamStatusLabel(message().status)}`
          }
          on:click={() => activeId.set(messageId)}
          css={`
            appearance: none;
            flex: 1 1 0;
            min-width: 0;
            min-height: var(--hit);
            padding: 0.4rem 0.55rem;
            border: 0;
            border-bottom: 2px solid transparent;
            border-radius: var(--radius-sm) var(--radius-sm) 0 0;
            background: transparent;
            color: var(--text-muted);
            font: inherit;
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
            text-align: start;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;

            &[aria-selected='true'] {
              border-bottom-color: var(--accent);
              color: var(--text);
              font-weight: var(--weight-medium);
            }

            &:focus-visible {
              outline: var(--focus-width) solid var(--focus);
              outline-offset: 2px;
            }
          `}
        >
          {() => modelName(message().model)}
        </button>
      )
      tabs.set(messageId, tab)
    }
    return tab
  }

  return (
    <div
      data-slot="CompareColumns"
      data-layout={() => (phoneCompare() ? 'tabs' : 'columns')}
      ref={() => {
        const timer = setInterval(
          wrap(() => {
            clock.set(Date.now())
          }),
          200,
        )
        return () => clearInterval(timer)
      }}
      css={`
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--space-3);
        min-width: 0;

        &[data-layout='tabs'] {
          grid-template-columns: minmax(0, 1fr);
        }

        &[data-layout='columns'] [data-compare-tabs] {
          display: none;
        }

        &[data-layout='tabs'] [data-compare-panel][data-active='false'] {
          display: none;
        }
      `}
    >
      {() =>
        bothFailed() ? (
          <div css="grid-column: 1 / -1;">
            <Button size="sm" variant="secondary" on:click={() => void exitCompare()}>
              Exit compare
            </Button>
          </div>
        ) : null
      }
      <div
        data-compare-tabs=""
        role="tablist"
        aria-label="Compared models"
        css={`
          grid-column: 1 / -1;
          display: flex;
          gap: var(--space-1);
          min-width: 0;
          border-bottom: 1px solid var(--line);
        `}
      >
        {() => lanes().map((message) => tabFor(message.id))}
      </div>
      {() => lanes().map((message) => panelFor(message.id))}
    </div>
  )
}
