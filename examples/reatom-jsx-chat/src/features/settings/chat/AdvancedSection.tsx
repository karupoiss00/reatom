import { action, atom, effect, peek, type Atom } from '@reatom/core'

import { catalogById, modelName } from '../../../catalog'
import type { CatalogModel } from '../../../catalog/types'
import type { ChatModel } from '../../../chat/types'
import type { ChatParams, ReasoningEffort } from '../../../storage/types'
import { Button, toast } from '../../../ui'
import type { ChatSlotProps } from '../../slots'

const temperatureDefault = 1
const topPDefault = 1
const fallbackEfforts: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
]

const supports = (model: CatalogModel | null, parameter: string) =>
  model?.supportedParameters.includes(parameter) ?? false

export const supportsReasoning = (model: CatalogModel | null) =>
  supports(model, 'reasoning') || supports(model, 'reasoning_effort')

export const effortsFor = (model: CatalogModel | null): ReasoningEffort[] => {
  if (!supportsReasoning(model)) return []
  if (model?.supportedEfforts && model.supportedEfforts.length > 0) {
    return [...model.supportedEfforts]
  }
  return [...fallbackEfforts]
}

export const defaultEffort = (
  efforts: readonly ReasoningEffort[],
): ReasoningEffort => {
  if (efforts.includes('medium')) return 'medium'
  return efforts[Math.floor(efforts.length / 2)] ?? 'medium'
}

export const shownEffort = (
  params: ChatParams,
  efforts: readonly ReasoningEffort[],
): ReasoningEffort => {
  const stored = params.reasoningEffort
  if (stored && efforts.includes(stored)) return stored
  return defaultEffort(efforts)
}

export const hasParamOverride = (params: ChatParams) =>
  params.temperature !== undefined ||
  params.topP !== undefined ||
  params.maxTokens !== undefined ||
  params.reasoningEffort !== undefined

export const unsupportedParameterNames = (
  model: CatalogModel | null,
): string[] => {
  const missing: string[] = []
  if (!supports(model, 'temperature')) missing.push('temperature')
  if (!supports(model, 'top_p')) missing.push('top_p')
  if (!supports(model, 'max_tokens')) missing.push('max_tokens')
  if (!supportsReasoning(model)) missing.push('reasoning')
  return missing
}

export const unsupportedSentence = (
  modelId: string,
  model: CatalogModel | null,
) =>
  `Not supported by ${modelName(modelId)}: ${unsupportedParameterNames(model).join(', ')}`

const roundTo = (value: number, places: number) => Number(value.toFixed(places))

const modelOf = (chat: ChatModel): CatalogModel | null =>
  catalogById().get(chat.model() ?? '') ?? null

const replaceParams = (chat: ChatModel, params: ChatParams) => {
  chat.updateSettings({ params })
}

const writeTemperature = (chat: ChatModel, raw: number) => {
  const params = { ...chat.settings().params }
  const value = roundTo(raw, 2)
  if (value === temperatureDefault) delete params.temperature
  else params.temperature = value
  replaceParams(chat, params)
}

const writeTopP = (chat: ChatModel, raw: number) => {
  const params = { ...chat.settings().params }
  const value = roundTo(raw, 2)
  if (value === topPDefault) delete params.topP
  else params.topP = value
  replaceParams(chat, params)
}

export const writeReasoningEffort = (
  chat: ChatModel,
  effort: ReasoningEffort,
  efforts: readonly ReasoningEffort[],
) => {
  const params = { ...chat.settings().params }
  if (effort === defaultEffort(efforts)) delete params.reasoningEffort
  else params.reasoningEffort = effort
  replaceParams(chat, params)
}

const keptParams = (params: ChatParams, model: CatalogModel | null): ChatParams => {
  const kept: ChatParams = {}
  if (params.temperature !== undefined && supports(model, 'temperature')) {
    kept.temperature = params.temperature
  }
  if (params.topP !== undefined && supports(model, 'top_p')) kept.topP = params.topP
  if (params.maxTokens !== undefined && supports(model, 'max_tokens')) {
    kept.maxTokens = params.maxTokens
  }
  if (
    params.reasoningEffort !== undefined &&
    supportsReasoning(model) &&
    effortsFor(model).includes(params.reasoningEffort)
  ) {
    kept.reasoningEffort = params.reasoningEffort
  }
  return kept
}

const droppedLabels = (params: ChatParams, model: CatalogModel | null): string[] => {
  const dropped: string[] = []
  if (params.temperature !== undefined && !supports(model, 'temperature')) {
    dropped.push('Temperature')
  }
  if (params.topP !== undefined && !supports(model, 'top_p')) dropped.push('Top P')
  if (params.maxTokens !== undefined && !supports(model, 'max_tokens')) {
    dropped.push('Max output tokens')
  }
  if (params.reasoningEffort !== undefined && !supportsReasoning(model)) {
    dropped.push('Reasoning effort')
  }
  return dropped
}

const seenByChat = new Map<string, Atom<string | null | undefined>>()

const seenModel = (chatId: string) => {
  let seen = seenByChat.get(chatId)
  if (!seen) {
    seen = atom<string | null | undefined>(
      undefined,
      `features.params.seen.${chatId}`,
    )
    seenByChat.set(chatId, seen)
  }
  return seen
}

export const watchUnsupportedSwitch = (chat: ChatModel) => {
  const seen = seenModel(chat.id)
  let previous = peek(seen)
  const sync = () => {
    const modelId = chat.model()
    const params = chat.settings().params
    if (previous === undefined) {
      previous = modelId
      seen.set(modelId)
      return
    }
    if (previous === modelId) return
    previous = modelId
    seen.set(modelId)
    const model = modelId ? (catalogById().get(modelId) ?? null) : null
    const dropped = droppedLabels(params, model)
    if (dropped.length === 0) return
    for (const label of dropped) {
      toast.show({
        key: `params-unsupported-${label}`,
        text: `${label} isn't supported by ${modelId ? modelName(modelId) : 'this model'}; it won't be sent.`,
        tone: 'warning',
      })
    }
    replaceParams(chat, keptParams(params, model))
  }
  const unsubscribeModel = chat.model.subscribe(sync)
  const unsubscribeSettings = chat.settings.subscribe(sync)
  sync()
  return () => {
    unsubscribeModel()
    unsubscribeSettings()
  }
}

type MaxState = {
  draft: Atom<string>
  error: Atom<string | null>
}

const maxStates = new Map<string, MaxState>()
const maxSyncStops = new Map<string, () => void>()

const maxState = (chat: ChatModel): MaxState => {
  let state = maxStates.get(chat.id)
  if (!state) {
    const stored = peek(chat.settings).params.maxTokens
    state = {
      draft: atom(
        stored === undefined ? '' : String(stored),
        `features.settings.advanced.max.${chat.id}.draft`,
      ),
      error: atom<string | null>(
        null,
        `features.settings.advanced.max.${chat.id}.error`,
      ),
    }
    maxStates.set(chat.id, state)
  }
  return state
}

const limitRejection = (limit: number) =>
  `Can't exceed ${limit.toLocaleString('en-US')} tokens for this model.`

const bindMaxSync = (chat: ChatModel) => {
  maxSyncStops.get(chat.id)?.()
  const state = maxState(chat)
  const subscription = effect(() => {
    if (state.error()) return
    const stored = chat.settings().params.maxTokens
    const text = stored === undefined ? '' : String(stored)
    if (state.draft() !== text) state.draft.set(text)
  }, `features.settings.advanced.max.${chat.id}.sync`)
  maxSyncStops.set(chat.id, () => subscription.unsubscribe())
}

export const resetAdvancedParams = (chat: ChatModel) => {
  const state = maxStates.get(chat.id)
  state?.error.set(null)
  state?.draft.set('')
  replaceParams(chat, {})
}

const sectionStyles = `
  display: grid;
  align-content: start;
  gap: var(--space-5);
  min-width: 0;
`

const controlStyles = `
  display: grid;
  gap: var(--space-2);
  min-width: 0;
`

const labelRowStyles = `
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  color: var(--text);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
`

const readoutStyles = `
  color: var(--text-muted);
  font-weight: var(--weight-regular);
  font-variant-numeric: tabular-nums;
`

const rangeStyles = `
  width: 100%;
  height: 1.25rem;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;

  &:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 2px;
  }
`

const hintStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: var(--leading-snug);
`

const alertStyles = `
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
`

const unsupportedStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-wrap: pretty;
`

const effortRowStyles = `
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
`

const effortButtonStyles = `
  appearance: none;
  flex: 1 1 auto;
  min-height: 2rem;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: calc(var(--radius-md) - 2px);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--leading-none);
  cursor: pointer;

  &:hover {
    color: var(--text);
  }

  &:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 1px;
  }

  &[aria-checked='true'] {
    background: var(--bg-elevated);
    box-shadow: var(--shadow-1);
    color: var(--text);
    font-weight: var(--weight-medium);
  }
`

const numberStyles = `
  width: 8.5rem;
  height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--line-input);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text);
  font: inherit;
  font-size: var(--text-base);
  font-variant-numeric: tabular-nums;

  &:focus-visible {
    border-color: var(--focus);
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 0;
  }

  &[aria-invalid='true'] {
    border-color: var(--danger);
  }
`

const dotStyle = [
  'width:0.5rem',
  'height:0.5rem',
  'flex:none',
  'border-radius:999px',
  'background:var(--accent)',
  'box-shadow:0 0 0 3px var(--accent-soft)',
  'pointer-events:none',
].join(';')

const paintOverriddenDot = (root: HTMLElement, chat: ChatModel) => {
  const panel = root.closest('[role="tabpanel"]')
  const tabId = panel?.getAttribute('aria-labelledby')
  const tab = tabId ? document.getElementById(tabId) : null
  if (!tab) return
  const existing = tab.querySelector<HTMLElement>(':scope > [data-overridden]')
  if (!hasParamOverride(chat.settings().params)) {
    existing?.remove()
    return
  }
  if (existing) return
  const dot = document.createElement('span')
  dot.dataset.overridden = ''
  dot.setAttribute('aria-hidden', 'true')
  dot.style.cssText = dotStyle
  tab.append(dot)
}

const TemperatureControl = ({ chat }: ChatSlotProps) => (
  <div css={controlStyles}>
    <div css={labelRowStyles}>
      <span>Temperature</span>
      <span css={readoutStyles}>
        {() => {
          const value = chat.settings().params.temperature
          return value === undefined ? 'Default' : value.toFixed(1)
        }}
      </span>
    </div>
    <input
      type="range"
      aria-label="Temperature"
      min="0"
      max="2"
      step="0.1"
      prop:value={() =>
        String(chat.settings().params.temperature ?? temperatureDefault)
      }
      on:input={(event) =>
        writeTemperature(chat, Number(event.currentTarget.value))
      }
      css={rangeStyles}
    />
  </div>
)

const TopPControl = ({ chat }: ChatSlotProps) => (
  <div css={controlStyles}>
    <div css={labelRowStyles}>
      <span>Top P</span>
      <span css={readoutStyles}>
        {() => {
          const value = chat.settings().params.topP
          return value === undefined ? 'Default' : value.toFixed(2)
        }}
      </span>
    </div>
    <input
      type="range"
      aria-label="Top P"
      min="0"
      max="1"
      step="0.05"
      prop:value={() => String(chat.settings().params.topP ?? topPDefault)}
      on:input={(event) => writeTopP(chat, Number(event.currentTarget.value))}
      css={rangeStyles}
    />
  </div>
)

const MaxTokensControl = ({ chat }: ChatSlotProps) => {
  const state = maxState(chat)
  const commit = action((raw: string) => {
    state.draft.set(raw)
    const limit = modelOf(chat)?.maxCompletionTokens ?? null
    const params = { ...chat.settings().params }
    if (raw.trim() === '') {
      state.error.set(null)
      if (params.maxTokens === undefined) return
      delete params.maxTokens
      replaceParams(chat, params)
      return
    }
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1) {
      state.error.set('Enter a whole number of tokens.')
      return
    }
    if (limit !== null && value > limit) {
      state.error.set(limitRejection(limit))
      return
    }
    state.error.set(null)
    if (params.maxTokens === value) return
    params.maxTokens = value
    replaceParams(chat, params)
  }, `features.settings.advanced.max.${chat.id}.commit`)

  return (
    <div css={controlStyles}>
      <div css={labelRowStyles}>
        <span>Max output tokens</span>
        <span css={readoutStyles}>
          {() => {
            const limit = modelOf(chat)?.maxCompletionTokens
            return limit === null || limit === undefined
              ? 'Model default'
              : `Up to ${limit.toLocaleString('en-US')}`
          }}
        </span>
      </div>
      <input
        type="number"
        aria-label="Max output tokens"
        min="1"
        step="1"
        prop:placeholder="Default"
        prop:max={() => {
          const limit = modelOf(chat)?.maxCompletionTokens
          return limit === null || limit === undefined ? '' : String(limit)
        }}
        prop:value={() => state.draft()}
        attr:aria-invalid={() => (state.error() ? 'true' : 'false')}
        on:input={(event) => commit(event.currentTarget.value)}
        css={numberStyles}
      />
      {() => {
        const message = state.error()
        if (!message) {
          return <p css={hintStyles}>Leave blank to use the model default.</p>
        }
        return (
          <p role="alert" css={alertStyles}>
            {message}
          </p>
        )
      }}
    </div>
  )
}

const ReasoningControl = ({ chat }: ChatSlotProps) => (
  <div css={controlStyles}>
    <div css={labelRowStyles}>
      <span>Reasoning effort</span>
      <span css={readoutStyles}>
        {() => {
          const list = effortsFor(modelOf(chat))
          const stored = chat.settings().params.reasoningEffort
          return stored && list.includes(stored) ? stored : 'Default'
        }}
      </span>
    </div>
    <div role="radiogroup" aria-label="Reasoning effort" css={effortRowStyles}>
      {() =>
        effortsFor(modelOf(chat)).map((effort) => (
          <button
            type="button"
            role="radio"
            data-effort={effort}
            attr:aria-checked={() =>
              shownEffort(chat.settings().params, effortsFor(modelOf(chat))) ===
              effort
                ? 'true'
                : 'false'
            }
            on:click={() =>
              writeReasoningEffort(chat, effort, effortsFor(modelOf(chat)))
            }
            css={effortButtonStyles}
          >
            {effort}
          </button>
        ))
      }
    </div>
  </div>
)

export const AdvancedSection = ({ chat }: ChatSlotProps) => {
  bindMaxSync(chat)
  return (
    <section
      data-slot="AdvancedSection"
      aria-label="Advanced"
      css={sectionStyles}
      ref={(root: HTMLElement) => {
        const sync = () => paintOverriddenDot(root, chat)
        sync()
        const frame = requestAnimationFrame(sync)
        const unsubscribe = chat.settings.subscribe(sync)
        return () => {
          cancelAnimationFrame(frame)
          unsubscribe()
        }
      }}
    >
      {() =>
        supports(modelOf(chat), 'temperature') ? (
          <TemperatureControl chat={chat} />
        ) : null
      }
      {() =>
        supports(modelOf(chat), 'top_p') ? <TopPControl chat={chat} /> : null
      }
      {() =>
        supports(modelOf(chat), 'max_tokens') ? (
          <MaxTokensControl chat={chat} />
        ) : null
      }
      {() =>
        effortsFor(modelOf(chat)).length > 0 ? (
          <ReasoningControl chat={chat} />
        ) : null
      }
      {() => {
        const modelId = chat.model()
        if (!modelId || unsupportedParameterNames(modelOf(chat)).length === 0) {
          return null
        }
        return (
          <p data-unsupported="" css={unsupportedStyles}>{unsupportedSentence(modelId, modelOf(chat))}</p>
        )
      }}
      {() => {
        if (unsupportedParameterNames(modelOf(chat)).length === 4) return null
        return (
          <Button
            variant="ghost"
            size="sm"
            data-reset-params=""
            disabled={() => !hasParamOverride(chat.settings().params)}
            on:click={() => resetAdvancedParams(chat)}
          >
            Reset to model defaults
          </Button>
        )
      }}
    </section>
  )
}
