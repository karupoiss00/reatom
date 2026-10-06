import { computed, type Atom, type Computed } from '@reatom/core'

import { modelName } from '../../catalog'
import {
  continueWithCompare,
  stopCompareLane,
} from '../../chat/compare'
import type { ChatModel } from '../../chat/types'
import { MessageBody } from '../../render'
import type { AssistantMessage, AssistantStatus } from '../../storage/types'
import { Button } from '../../ui'
import { ErrorCard } from '../errors/ErrorCard'
import { CostFooter } from '../thread/CostFooter'

const live = new Set<AssistantStatus>(['waiting', 'streaming'])

export const streamStatusLabel = (status: AssistantStatus) => {
  switch (status) {
    case 'waiting':
      return 'Waiting'
    case 'streaming':
      return 'Streaming'
    case 'done':
      return 'Done'
    case 'stopped':
      return 'Stopped'
    case 'interrupted':
      return 'Interrupted'
    case 'connection-lost':
      return 'Connection lost'
    case 'error':
      return 'Failed'
    case 'cut-off':
      return 'Cut off'
    case 'refused':
      return 'Refused'
  }
}

const elapsedLabel = (message: AssistantMessage, clock: number) => {
  const end = message.timing.endAt ?? clock
  const seconds = Math.max(0, end - message.timing.requestAt) / 1000
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

export const CompareColumn = ({
  chat,
  messageId,
  selectedId,
  clock,
  panelId,
  labelledBy,
}: {
  chat: ChatModel
  messageId: string
  selectedId: Computed<string | null>
  clock: Atom<number>
  panelId: string
  labelledBy: string
}) => {
  const name = `features.compare.column#${messageId}`
  const seeded = chat.messages().get(messageId)
  const seed =
    seeded && seeded.role === 'assistant' ? seeded : null
  const message = computed((): AssistantMessage => {
    const current = chat.messages().get(messageId)
    if (current && current.role === 'assistant') return current
    if (seed) return seed
    throw new Error(`Missing compare reply ${messageId}`)
  }, `${name}.message`)
  const content = computed(() => message().content, `${name}.content`)
  const streaming = computed(() => live.has(message().status), `${name}.streaming`)
  const label = computed(() => modelName(message().model), `${name}.label`)

  return (
    <article
      id={panelId}
      role="tabpanel"
      aria-labelledby={labelledBy}
      data-compare-panel=""
      data-model={seed?.model}
      data-status={() => message().status}
      data-active={() => (selectedId() === messageId ? 'true' : 'false')}
      css={`
        display: grid;
        align-content: start;
        gap: var(--space-3);
        min-width: 0;
        padding: var(--space-3);
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        background: var(--bg-elevated);
        box-shadow: var(--shadow-1);
      `}
    >
      <header
        css={`
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--space-2);
          min-width: 0;
        `}
      >
        <div css="min-width: 0;">
          <p
            css={`
              margin: 0;
              font-family: var(--font-display);
              font-size: var(--text-md);
              line-height: var(--leading-tight);
              letter-spacing: -0.02em;
            `}
          >
            {label}
          </p>
          <p
            data-compare-timing=""
            css={`
              margin: 0.15rem 0 0;
              color: var(--text-muted);
              font-size: var(--text-xs);
              font-variant-numeric: tabular-nums;
            `}
          >
            {() => elapsedLabel(message(), clock())}
          </p>
        </div>
        {() =>
          live.has(message().status) ? (
            <Button
              size="sm"
              variant="secondary"
              icon="stop"
              aria-label={`Stop ${modelName(seed?.model ?? '')}`}
              on:click={() => stopCompareLane(messageId)}
            >
              Stop
            </Button>
          ) : null
        }
      </header>
      {() => {
        const current = message()
        const waiting =
          live.has(current.status) && current.content.length === 0 && !current.error
        if (!waiting) return null
        return (
          <p
            css={`
              margin: 0;
              color: var(--text-muted);
              font-size: var(--text-sm);
            `}
          >
            Waiting for {label()}…
          </p>
        )
      }}
      {() =>
        message().content.length > 0 ? (
          <div dir="auto" css="min-width: 0; line-height: var(--leading-body);">
            <MessageBody source={content} streaming={streaming} />
          </div>
        ) : null
      }
      {() => {
        const error = message().error
        if (!error) return null
        return <ErrorCard chat={chat} message={message} error={error} />
      }}
      <CostFooter chat={chat} message={message} />
      {() =>
        live.has(message().status) ? null : (
          <Button
            size="sm"
            variant="primary"
            on:click={() => {
              void continueWithCompare(messageId)
            }}
          >
            Continue with this
          </Button>
        )
      }
    </article>
  )
}
