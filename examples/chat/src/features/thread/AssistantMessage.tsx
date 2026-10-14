import { atom, computed, peek } from '@reatom/core'

import { modelName } from '../../catalog'
import { announce, IconButton } from '../../ui'
import { MessageBody } from '../../render'
import type { AssistantMessage as AssistantRecord } from '../../storage/types'
import { ErrorCard } from '../errors/ErrorCard'
import type { NodeSlotProps } from '../slots'
import { CostFooter } from './CostFooter'
import { ForkContinue } from './ForkContinue'
import { MessageActions } from './MessageActions'
import { Reasoning } from './Reasoning'
import { RegenerateMenu } from './RegenerateMenu'
import { Sources } from './Sources'
import { ToolCard } from './ToolCard'
import { VersionSwitcher } from './VersionSwitcher'

const billingNames: Record<string, string> = {
  google: 'Google',
  groq: 'Groq',
  mistral: 'Mistral',
  bedrock: 'Bedrock',
}

const billingNote = (provider: string | null) => {
  const known = provider ? billingNames[provider.trim().toLowerCase()] : undefined
  if (known) return `Stop ends the reply here. ${known} may still bill for the rest.`
  return 'Stop ends the reply here. Some providers may still bill for the rest.'
}

const statusLabel = (message: AssistantRecord) => {
  if (message.status === 'stopped' && message.content.length === 0) {
    return 'Stopped before any reply'
  }
  if (message.status === 'stopped') return 'Stopped'
  if (message.status === 'interrupted') return 'Interrupted'
  if (message.status === 'connection-lost') return 'Connection lost'
  return null
}

const readUnsaved = (chat: NodeSlotProps['chat']) => {
  const unsaved = (chat as { unsaved?: () => boolean }).unsaved
  return typeof unsaved === 'function' ? unsaved() : false
}

export const AssistantMessage = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const name = `features.thread.assistant#${messageId}`
  const message = computed(
    () => node().message as AssistantRecord,
    `${name}.message`,
  )
  const content = computed(() => message().content, `${name}.content`)
  const streamingBody = computed(() => {
    const status = message().status
    return status === 'waiting' || status === 'streaming'
  }, `${name}.streaming`)
  const waiting = computed(() => {
    const current = message()
    const tools = current.toolCalls ?? []
    return (
      (current.status === 'waiting' || current.status === 'streaming') &&
      current.content.length === 0 &&
      tools.length === 0
    )
  }, `${name}.waiting`)
  const toolCalls = computed(
    () => message().toolCalls ?? [],
    `${name}.toolCalls`,
  )
  const showBody = computed(() => {
    const current = message()
    const emptyStop = current.status === 'stopped' && current.content.length === 0
    return !emptyStop && !waiting() && current.content.length > 0
  }, `${name}.showBody`)
  const error = computed(() => message().error, `${name}.error`)
  const unsaved = computed(() => readUnsaved(chat), `${name}.unsaved`)
  const billingOpen = atom(false, `${name}.billingOpen`)

  return (
    <article
      data-slot="AssistantMessage"
      css={`
        display: grid;
        gap: var(--space-2);
        min-width: 0;

        @keyframes thread-pulse {
          0%,
          100% {
            opacity: 0.35;
          }
          50% {
            opacity: 1;
          }
        }

        & [data-processing-dot] {
          width: 0.55rem;
          height: 0.55rem;
          border-radius: var(--radius-pill);
          background: var(--accent);
          animation: thread-pulse 1.1s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          & [data-processing-dot] {
            animation: none;
            opacity: 1;
          }
        }
      `}
      ref={() => {
        let announced = ''
        const unsub = message.subscribe((current) => {
          const label = statusLabel(current)
          if (label && label !== announced) {
            announced = label
            announce(label)
          }
        })
        return () => unsub()
      }}
    >
      <Reasoning message={message} />
      {() => {
        const label = statusLabel(message())
        if (!label) return null
        return (
          <div
            data-reply-status={message().status}
            css={`
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: var(--space-2);
              color: var(--text-muted);
              font-size: var(--text-sm);
            `}
          >
            <span>{label}</span>
            {message().status === 'stopped' ? (
              <IconButton
                icon="info"
                label="About billing after stop"
                size="sm"
                pressed={billingOpen}
                on:click={() => billingOpen.set((open) => !open)}
              />
            ) : null}
          </div>
        )
      }}
      {() =>
        message().status === 'stopped' && billingOpen() ? (
          <p
            data-billing-note=""
            css={`
              margin: 0;
              color: var(--text-muted);
              font-size: var(--text-sm);
              line-height: var(--leading-snug);
            `}
          >
            {billingNote(message().provider)}
          </p>
        ) : null
      }
      <div
        data-message-content=""
        dir="auto"
        css={`
          min-width: 0;
          line-height: var(--leading-body);
        `}
      >
        {() =>
          waiting() ? (
            <p
              data-state="processing"
              css={`
                display: flex;
                align-items: center;
                gap: var(--space-2);
                margin: 0;
                color: var(--text-muted);
              `}
            >
              <span data-processing-dot="" />
              Waiting for {modelName(message().model)}…
            </p>
          ) : null
        }
        {() =>
          showBody() ? (
            <MessageBody source={content} streaming={streamingBody} />
          ) : null
        }
        {() => {
          const calls = toolCalls()
          if (calls.length === 0) return null
          return (
            <div
              css={`
                display: grid;
                gap: var(--space-2);
                min-width: 0;
                margin-top: var(--space-3);
              `}
            >
              {calls.map((call) => (
                <ToolCard chat={chat} message={message} callId={call.id} />
              ))}
            </div>
          )
        }}
      </div>
      {() =>
        unsaved() ? (
          <span
            css={`
              justify-self: start;
              padding: 0.15rem 0.55rem;
              border: 1px solid var(--warning-line);
              border-radius: var(--radius-pill);
              background: var(--warning-soft);
              color: var(--warning);
              font-size: var(--text-xs);
            `}
          >
            Not saved on this device
          </span>
        ) : null
      }
      {() => {
        const current = error()
        return current ? (
          <ErrorCard chat={chat} message={message} error={current} />
        ) : null
      }}
      {() => {
        const current = message()
        const hasCitations = current.citations.length > 0
        const searching =
          !hasCitations &&
          current.content.length === 0 &&
          (current.status === 'waiting' || current.status === 'streaming') &&
          chat.settings().webSearch === true
        if (!hasCitations && !searching) return null
        return <Sources message={message} />
      }}
      <div
        data-slot="ReplyFooter"
        css={`
          display: grid;
          gap: 0.25rem;
          min-width: 0;
          margin-top: calc(10px - var(--space-2));
        `}
      >
        <CostFooter chat={chat} message={message} />
        <div
          data-slot="ReplyActions"
          css={`
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 0.125rem 0.25rem;
            min-width: 0;
            margin: 0;
            padding: 0;
          `}
        >
          <VersionSwitcher chat={chat} node={node} />
          <RegenerateMenu chat={chat} node={node} />
          <MessageActions chat={chat} node={node} />
          <ForkContinue chat={chat} node={node} />
        </div>
      </div>
    </article>
  )
}
