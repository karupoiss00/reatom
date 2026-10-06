import { atom, computed, peek } from '@reatom/core'

import { timings } from '../../app/timings'
import { catalogById, type CatalogModel } from '../../catalog'
import { formatEstimate, formatUsd } from '../../money/format'
import { now } from '../../platform/env'
import type { AssistantMessage } from '../../storage/types'
import { Badge, InfoButton } from '../../ui'
import type { AssistantSlotProps } from '../slots'

const byokExplanation =
  "Billed by the provider on your own key. OpenRouter's fee is not shown per message (5% of list price after a $25k/month allowance), and the provider's bill is not in this response."

const ended = new Set<AssistantMessage['status']>([
  'done',
  'stopped',
  'interrupted',
  'connection-lost',
  'error',
  'cut-off',
  'refused',
])

type StoppedCost = 'exact' | 'settling' | 'estimate'

type CostView = {
  phase: 'hidden' | 'live' | 'exact' | 'unavailable'
  line: string
  byok: boolean
  stopped: StoppedCost | null
}

const tokensArrived = (message: AssistantMessage) =>
  message.content.length > 0 || (message.reasoning?.text.length ?? 0) > 0

const stoppedCost = (
  message: AssistantMessage,
  gaveUp: boolean,
): StoppedCost | null => {
  if (message.status !== 'stopped') return null
  if (message.usage) return 'exact'
  if (message.generationId && !gaveUp) return 'settling'
  return 'estimate'
}

const stoppedEstimate = (message: AssistantMessage, phase: StoppedCost) => {
  const estimate = `${formatEstimate(message.estimateCost)} (stopped, estimate)`
  if (phase === 'settling') return `${estimate} · Checking the final cost`
  return estimate
}

const formatSeconds = (ms: number) => {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

const amountLabel = (
  message: AssistantMessage,
  model: CatalogModel | undefined,
) => {
  const usage = message.usage
  if (!usage) return formatEstimate(message.estimateCost)
  const extras = message.extraUsage
  if (
    !Number.isFinite(usage.cost) ||
    extras.some((item) => !Number.isFinite(item.cost))
  ) {
    return formatUsd(Number.NaN)
  }
  const extra = extras.reduce((sum, item) => sum + item.cost, 0)
  if (model?.isFree && usage.cost === 0 && extra === 0) return 'Free'
  return formatUsd(usage.cost + extra)
}

const exactLine = (
  message: AssistantMessage,
  model: CatalogModel | undefined,
) => {
  const usage = message.usage!
  const reasoning =
    usage.reasoningTokens > 0 ? ` (${usage.reasoningTokens} reasoning)` : ''
  const parts = [
    amountLabel(message, model),
    `${usage.promptTokens} in`,
    `${usage.completionTokens} out${reasoning}`,
  ]
  const { requestAt, firstTokenAt, endAt } = message.timing
  if (firstTokenAt !== null) {
    parts.push(`${formatSeconds(firstTokenAt - requestAt)} to first token`)
  }
  if (endAt !== null) parts.push(formatSeconds(endAt - requestAt))
  if (message.provider) parts.push(`via ${message.provider}`)
  return parts.join(' · ')
}

const costView = (message: AssistantMessage, gaveUp: boolean): CostView => {
  const model = catalogById().get(message.model)
  const stopped = stoppedCost(message, gaveUp)
  if (message.usage) {
    return {
      phase: 'exact',
      line: exactLine(message, model),
      byok: message.usage.isByok,
      stopped,
    }
  }
  if (!tokensArrived(message)) {
    return { phase: 'hidden', line: '', byok: false, stopped }
  }
  if (stopped === 'settling' || stopped === 'estimate') {
    return {
      phase: stopped === 'settling' ? 'live' : 'unavailable',
      line: stoppedEstimate(message, stopped),
      byok: false,
      stopped,
    }
  }
  if (!ended.has(message.status)) {
    return {
      phase: 'live',
      line: formatEstimate(message.estimateCost),
      byok: false,
      stopped,
    }
  }
  return {
    phase: 'unavailable',
    line: `${formatEstimate(message.estimateCost)} estimate`,
    byok: false,
    stopped,
  }
}

export const CostFooter = ({ message }: AssistantSlotProps) => {
  const messageId = peek(message).id
  const gaveUp = atom(false, `features.costFooter.${messageId}.gaveUp`)
  const view = computed(
    () => costView(message(), gaveUp()),
    `features.costFooter.${messageId}.view`,
  )
  return (
    <footer
      data-slot="CostFooter"
      data-cost-phase={() => view().phase}
      ref={() => {
        let timer: ReturnType<typeof setTimeout> | null = null
        const unsub = message.subscribe((current) => {
          if (timer || current.status !== 'stopped' || current.usage) return
          if (!current.generationId) return
          const elapsed = current.timing.endAt ? now() - current.timing.endAt : 0
          const remaining = Math.max(0, timings.generationCapMs - elapsed)
          timer = setTimeout(() => gaveUp.set(true), remaining)
        })
        return () => {
          unsub()
          if (timer) clearTimeout(timer)
        }
      }}
      css={`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--space-2);
        min-width: 0;
        margin: 0;
        color: var(--text-muted);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);
        font-variant-numeric: tabular-nums;

        &[data-cost-phase='hidden'] {
          display: none;
        }

        & [data-cost-line] {
          min-width: 0;
        }

        & [data-cost-note] {
          color: var(--text-faint);
        }
      `}
    >
      {() => {
        const current = view()
        if (current.phase === 'hidden') return null
        return (
          <>
            <span data-cost-line="" data-cost={current.stopped ?? ''}>
              {current.line}
            </span>
            {current.byok ? (
              <Badge tone="accent" data-byok="">
                BYOK
              </Badge>
            ) : null}
            {current.byok ? (
              <InfoButton label="About BYOK" title="BYOK" placement="bottom-start">
                {byokExplanation}
              </InfoButton>
            ) : null}
            {current.phase === 'unavailable' && !current.stopped ? (
              <span data-cost-note="">Exact cost unavailable</span>
            ) : null}
          </>
        )
      }}
    </footer>
  )
}
