import { computed } from '@reatom/core'

import { extraEstimateLines, type ExtraEstimateLine } from '../../app/ui'
import { catalogById, type CatalogModel } from '../../catalog'
import { assembleContext, contextCharacterCount } from '../../chat/context'
import type { ChatModel } from '../../chat/types'
import {
  estimateTokens,
  formatContextLength,
  formatEstimate,
  formatTokenCount,
  formatUsd,
} from '../../money'
import { Button, Icon, Tooltip } from '../../ui'
import type { ChatSlotProps } from '../slots'
import { openChatFromTail } from '../errors/actions'
import { JSX } from '@reatom/jsx/jsx-runtime'

const mayAddCost = 'Web search may add cost'

type Suggestion = {
  id: string
  name: string
  contextLength: number
}

type CostQuote = {
  ready: boolean
  tone: 'neutral' | 'warning'
  label: JSX.ElementChildren
  contextLabel: string
  fill: number
  inputTokens: number
  contextLength: number
  lines: string[]
  over: boolean
  suggestions: Suggestion[]
}

const isWebSearchLine = (line: ExtraEstimateLine) =>
  line.key === 'web-search' || /web search/i.test(line.label)

const extraLineText = (line: ExtraEstimateLine) => {
  if (line.amount === null) {
    return isWebSearchLine(line) ? mayAddCost : line.label
  }
  const label = line.label.trim()
  const withPlus = label.startsWith('+') ? label : `+ ${label}`
  return `${withPlus} ${formatUsd(line.amount)}`
}

const webSearchText = (model: CatalogModel) =>
  model.webSearchPrice === null
    ? mayAddCost
    : `+ web search ${formatUsd(model.webSearchPrice)}`

const longerContextSuggestions = (model: CatalogModel): Suggestion[] =>
  [...catalogById().values()]
    .filter((candidate) => candidate.contextLength > model.contextLength)
    .sort((left, right) => right.contextLength - left.contextLength)
    .slice(0, 3)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      contextLength: candidate.contextLength,
    }))

const quoteFor = (chat: ChatModel): CostQuote => {
  const modelId = chat.model()
  const model = modelId ? catalogById().get(modelId) : undefined
  if (!model || !Number.isFinite(model.contextLength)) {
    return {
      ready: false,
      tone: 'neutral',
      label: '',
      contextLabel: '',
      fill: 0,
      inputTokens: 0,
      contextLength: 0,
      lines: [],
      over: false,
      suggestions: [],
    }
  }
  const settings = chat.settings()
  const wire = assembleContext({
    path: chat.path().map((node) => node.message),
    systemPrompt: settings.systemPrompt,
    requestModel: model.id,
    attachment: () => undefined,
  })
  const inputTokens = estimateTokens(
    contextCharacterCount(wire) + chat.draft.text().length,
  )
  const total = chat.totalCost()
  const money = total.hasEstimate
    ? formatEstimate(total.amount)
    : formatUsd(total.amount)
  const over = inputTokens > model.contextLength
  const contextLabel = `${formatTokenCount(inputTokens)} / ${formatContextLength(model.contextLength)}`
  const extras = extraEstimateLines()
  const lines = [
    ...(settings.webSearch && !extras.some(isWebSearchLine)
      ? [webSearchText(model)]
      : []),
    ...extras.map(extraLineText),
  ].filter((line) => line !== mayAddCost)
  const share =
    model.contextLength > 0 ? (inputTokens / model.contextLength) * 100 : 0
  return {
    ready: true,
    tone: over ? 'warning' : 'neutral',
    label: over ? (
      `Too long for this model (${contextLabel})`
    ) : (
      <>
        <ChatTotal amount={money} />
        <span
          aria-hidden="true"
          css={`
            flex: none;
            width: 2px;
            height: 1rem;
            margin-inline: 0.5rem;
            border-radius: var(--radius-pill);
            background: currentColor;
            opacity: 0.7;
          `}
        />
        {contextLabel}
      </>
    ),
    contextLabel,
    fill: Math.min(100, Math.max(0, share)),
    inputTokens,
    contextLength: model.contextLength,
    lines,
    over,
    suggestions: over ? longerContextSuggestions(model) : [],
  }
}

const ChatTotal = ({ amount }: { amount: string }) => (
  <Tooltip placement="top-start" label="Total cost of replies in this chat">
    <span
      data-chat-total=""
      tabindex="0"
      css={`
        cursor: help;

        &:focus-visible {
          outline: var(--focus-width) solid var(--focus);
          outline-offset: 2px;
        }
      `}
    >
      {amount}
    </span>
  </Tooltip>
)

const ContextActions = ({
  chat,
  suggestions,
}: {
  chat: ChatModel
  suggestions: Suggestion[]
}) => (
  <div
    data-context-actions=""
    css={`
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    `}
  >
    {suggestions.length > 0 ? (
      <Button
        size="sm"
        variant="secondary"
        data-action="switch-longer-context"
        on:click={() => chat.setModel(suggestions[0]!.id)}
      >
        Switch to a longer-context model
      </Button>
    ) : (
      <Button
        size="sm"
        variant="secondary"
        disabled
        data-action="switch-longer-context"
      >
        No larger-context model available
      </Button>
    )}
    {suggestions.map((suggestion) => (
      <Button
        size="sm"
        variant="secondary"
        data-action="switch-longer-context"
        data-model={suggestion.id}
        on:click={() => chat.setModel(suggestion.id)}
      >
        {suggestion.name} · {formatContextLength(suggestion.contextLength)}
      </Button>
    ))}
    <Button
      size="sm"
      variant="secondary"
      data-action="new-chat-last-4"
      on:click={() => {
        void openChatFromTail(chat)
      }}
    >
      New chat with the last 4 messages
    </Button>
  </div>
)

export const CostNotes = ({ chat }: ChatSlotProps) => {
  const quote = computed(
    () => quoteFor(chat),
    `features.costNotes.${chat.id}.quote`,
  )
  return (
    <span css="display: contents;">
      {() => {
        const current = quote()
        if (!current.ready || (current.lines.length === 0 && !current.over)) {
          return null
        }
        return (
          <div
            data-cost-notes=""
            css={`
              display: grid;
              gap: var(--space-2);
              max-width: 46rem;
              margin: 0 auto var(--space-2);
              color: var(--text-muted);
              font-size: var(--text-xs);
              line-height: var(--leading-snug);
            `}
          >
            {current.lines.map((line) => (
              <span data-estimate-line="">{line}</span>
            ))}
            {current.over ? (
              <ContextActions chat={chat} suggestions={current.suggestions} />
            ) : null}
          </div>
        )
      }}
    </span>
  )
}

export const CostChip = ({ chat }: ChatSlotProps) => {
  const quote = computed(
    () => quoteFor(chat),
    `features.costChip.${chat.id}.quote`,
  )
  return (
    <div
      data-slot="CostChip"
      class="cost-chip"
      data-ready={() => (quote().ready ? 'true' : 'false')}
      data-tone={() => quote().tone}
      css={`
        --fill: var(--accent);
        --chip-fg: var(--text-muted);

        &[data-ready='false'] {
          display: none;
        }

        &[data-tone='warning'] {
          --fill: var(--warning);
          --chip-fg: var(--warning);
        }
      `}
    >
      <div
        data-cost-chip=""
        class="cost-chip-row"
        css={`
          display: flex;
          flex-wrap: nowrap;
          align-items: center;
          align-self: center;
          justify-content: flex-end;
          gap: var(--space-1-5);
          height: var(--control-height-compact);
          min-height: var(--control-height-compact);
          min-width: 0;
          color: var(--chip-fg);
        `}
      >
        {() => (quote().over ? <Icon name="warning" size="0.875rem" /> : null)}
        <span
          data-cost-label=""
          css={`
            display: inline-flex;
            align-items: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
            font-size: var(--text-xs);
            font-weight: var(--weight-medium);
            line-height: var(--leading-none);
            font-variant-numeric: tabular-nums;
          `}
        >
          {() => quote().label}
        </span>
        <span
          data-context-ring=""
          attr:role="meter"
          attr:aria-label="Context used"
          attr:aria-valuemin="0"
          attr:aria-valuemax={() => String(quote().contextLength)}
          attr:aria-valuenow={() =>
            String(Math.min(quote().inputTokens, quote().contextLength))
          }
          attr:aria-valuetext={() => quote().contextLabel}
          data-empty={() => (quote().fill <= 0 ? 'true' : 'false')}
          css={`
            display: inline-grid;
            flex: none;
            place-items: center;
            width: 1rem;
            height: 1rem;
            color: var(--fill);

            & svg {
              display: block;
              width: 100%;
              height: 100%;
            }

            & circle {
              fill: none;
              stroke-width: 2;
              stroke-linecap: round;
            }

            & [data-track] {
              stroke: var(--line-strong);
            }

            & [data-context-fill] {
              stroke: currentColor;
            }

            &[data-empty='true'] [data-context-fill] {
              stroke: none;
            }
          `}
        >
          <svg:svg viewBox="0 0 16 16" aria-hidden="true">
            <svg:circle data-track="" cx="8" cy="8" r="6" />
            <svg:circle
              data-context-fill=""
              cx="8"
              cy="8"
              r="6"
              pathLength="100"
              stroke-dasharray="100"
              attr:stroke-dashoffset={() => String(100 - quote().fill)}
              transform="rotate(-90 8 8)"
            />
          </svg:svg>
        </span>
      </div>
    </div>
  )
}
