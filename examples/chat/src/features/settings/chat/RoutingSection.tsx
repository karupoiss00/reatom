import { atom, computed, peek, withChangeHook, withComputed } from '@reatom/core'

import { providers } from '../../../catalog/providers'
import type { RoutingSettings } from '../../../storage/types'
import { Banner, Button, IconButton, Skeleton, Switch } from '../../../ui'
import { byokSettingsUrl } from '../../keychip/model'
import type { ChatSlotProps } from '../../slots'

const byokTitle = 'Using your own provider key (BYOK)'
const byokLines = [
  'Add provider keys on OpenRouter. They never touch this app.',
  "This app can't see whether a provider key is installed; the BYOK chip on a reply tells you it was used.",
  'OpenRouter charges 5% of list price after $25k/month.',
] as const
const emptyProviders = 'OpenRouter returned no providers.'
const providersError = "Couldn't load providers."

const routingModes = [
  { id: 'auto', label: 'Auto' },
  { id: 'order', label: 'Prefer order' },
  { id: 'only', label: 'Only these' },
] as const

type RoutingMode = (typeof routingModes)[number]['id']

const sectionStyles = `
  display: grid;
  align-content: start;
  gap: var(--space-4);
  min-width: 0;
`

const noteStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-wrap: pretty;
`

const choiceStyles = `
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: 2.75rem;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  cursor: pointer;

  &:has(input:checked) {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  &:has(input:disabled) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  &:focus-within {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: 2px;
  }

  & input {
    margin: 0;
    accent-color: var(--accent);
  }

  & span {
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-snug);
  }
`

const selectedProviders = (routing: RoutingSettings) =>
  routing.mode === 'auto' ? [] : routing.providers

const setProvider = (
  chat: ChatSlotProps['chat'],
  slug: string,
  included: boolean,
) => {
  const current = chat.settings().routing
  if (current.mode === 'auto') return
  const next = current.providers.filter((item) => item !== slug)
  if (included) next.push(slug)
  chat.updateSettings({ routing: { ...current, providers: next } })
}

const moveProvider = (
  chat: ChatSlotProps['chat'],
  slug: string,
  direction: -1 | 1,
) => {
  const current = chat.settings().routing
  if (current.mode !== 'order') return
  const next = [...current.providers]
  const index = next.indexOf(slug)
  const target = index + direction
  if (index < 0 || target < 0 || target >= next.length) return
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  chat.updateSettings({ routing: { ...current, providers: next } })
}

const ProviderRow = ({
  chat,
  provider,
  catalogIndex,
}: {
  chat: ChatSlotProps['chat']
  provider: { slug: string; name: string }
  catalogIndex: number
}) => (
  <div
    data-provider={provider.slug}
    style:order={() => {
      const selected = selectedProviders(chat.settings().routing)
      const index = selected.indexOf(provider.slug)
      return index < 0 ? 100 + catalogIndex : index
    }}
    css={`
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
      min-height: 2.25rem;
    `}
  >
    {() => {
      const routing = chat.settings().routing
      const selected = selectedProviders(routing)
      const index = selected.indexOf(provider.slug)
      if (routing.mode !== 'order' || index < 0) return null
      return (
        <span
          aria-hidden="true"
          css={`
            flex: none;
            width: 1.25rem;
            color: var(--text-muted);
            font-size: var(--text-xs);
            font-variant-numeric: tabular-nums;
            text-align: center;
          `}
        >
          {index + 1}
        </span>
      )
    }}
    <label
      css={`
        display: flex;
        align-items: center;
        gap: var(--space-3);
        flex: 1;
        min-width: 0;
        min-height: 2.25rem;
        cursor: pointer;

        &:has(input:disabled) {
          cursor: not-allowed;
        }

        & input {
          margin: 0;
          accent-color: var(--accent);
        }

        & span {
          min-width: 0;
          font-size: var(--text-sm);
          line-height: var(--leading-snug);
        }
      `}
    >
      <input
        type="checkbox"
        prop:checked={() =>
          selectedProviders(chat.settings().routing).includes(provider.slug)
        }
        disabled={() => chat.settings().routing.mode === 'auto'}
        on:change={(event) => {
          const input = event.currentTarget
          if (!(input instanceof HTMLInputElement)) return
          setProvider(chat, provider.slug, input.checked)
        }}
      />
      <span>{provider.name}</span>
    </label>
    {() => {
      const routing = chat.settings().routing
      if (routing.mode !== 'order') return null
      const selected = selectedProviders(routing)
      const index = selected.indexOf(provider.slug)
      if (index < 0) return null
      return (
        <span css="display: flex; flex: none; gap: var(--space-1);">
          <IconButton
            icon="chevron-up"
            label={`Move ${provider.name} up`}
            size="sm"
            disabled={index === 0}
            on:click={() => moveProvider(chat, provider.slug, -1)}
          />
          <IconButton
            icon="chevron-down"
            label={`Move ${provider.name} down`}
            size="sm"
            disabled={index === selected.length - 1}
            on:click={() => moveProvider(chat, provider.slug, 1)}
          />
        </span>
      )
    }}
  </div>
)

export const RoutingSection = ({ chat }: ChatSlotProps) => {
  const name = `features.settings.routing.${chat.id}`
  const catalog = computed(() => {
    const error = providers.error()
    return {
      error,
      pending: providers.pending(),
      list: providers.data(),
    }
  }, `${name}.catalog`)
  const listReady = () => {
    const snap = catalog()
    return snap.error == null && snap.list.length > 0
  }
  const allowFallbacks = atom(
    peek(() => chat.settings().routing.allowFallbacks),
    `${name}.fallbacks`,
  ).extend(
    withComputed(() => chat.settings().routing.allowFallbacks),
    withChangeHook((next) => {
      const current = chat.settings().routing
      if (current.allowFallbacks === next) return
      if (current.mode === 'auto') {
        chat.updateSettings({
          routing: { mode: 'auto', allowFallbacks: next },
        })
        return
      }
      chat.updateSettings({ routing: { ...current, allowFallbacks: next } })
    }),
  )

  const selectMode = (mode: RoutingMode) => {
    const current = chat.settings().routing
    if (current.mode === mode) return
    if (mode === 'auto') {
      chat.updateSettings({
        routing: { mode: 'auto', allowFallbacks: current.allowFallbacks },
      })
      return
    }
    chat.updateSettings({
      routing: {
        mode,
        providers: current.mode === 'auto' ? [] : [...current.providers],
        allowFallbacks: current.allowFallbacks,
      },
    })
  }

  const retryProviders = () => {
    providers.retry().catch(() => {})
  }

  return (
    <section
      data-slot="RoutingSection"
      aria-label="Routing"
      css={sectionStyles}
    >
      <div css="display: grid; gap: var(--space-2); min-width: 0;">
        <div
          role="radiogroup"
          aria-label="Routing mode"
          css={`
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: var(--space-2);
          `}
        >
          {routingModes.map((option) => (
            <label css={choiceStyles}>
              <input
                type="radio"
                name={`routing-mode-${chat.id}`}
                value={option.id}
                prop:checked={() => chat.settings().routing.mode === option.id}
                disabled={() => option.id !== 'auto' && !listReady()}
                on:change={() => selectMode(option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <p css={noteStyles}>
          Auto lets OpenRouter choose. Prefer order and Only these need the
          provider list.
        </p>
      </div>
      <Switch label="Allow fallbacks" checked={allowFallbacks} />
      {() => {
        const snap = catalog()
        const view =
          snap.error != null
            ? 'error'
            : snap.list.length > 0
              ? 'ready'
              : snap.pending > 0
                ? 'loading'
                : 'empty'
        return (
          <div data-providers-state={view} css="display: grid; gap: var(--space-2); min-width: 0;">
            {view === 'loading' ? (
              <div aria-busy="true" css="display: grid; gap: var(--space-2);">
                <p css={noteStyles}>Loading providers</p>
                <Skeleton lines={3} height="2.25rem" radius="var(--radius-md)" />
              </div>
            ) : null}
            {view === 'empty' ? <p css={noteStyles}>{emptyProviders}</p> : null}
            {view === 'error' ? (
              <Banner
                tone="danger"
                title={providersError}
                actions={
                  <Button size="sm" on:click={retryProviders}>
                    Retry
                  </Button>
                }
              />
            ) : null}
            {view === 'ready' ? (
              <div
                css={`
                  display: grid;
                  gap: var(--space-1);
                  min-width: 0;
                `}
              >
                {snap.list.map((provider, catalogIndex) => (
                  <ProviderRow
                    chat={chat}
                    provider={provider}
                    catalogIndex={catalogIndex}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      }}
      <div
        css={`
          display: grid;
          gap: var(--space-2);
          min-width: 0;
          padding: var(--space-3) var(--space-4);
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          background: var(--bg-sunken);
        `}
      >
        <h3
          css={`
            margin: 0;
            font-family: var(--font-display);
            font-size: var(--text-md);
            font-weight: var(--weight-medium);
            line-height: var(--leading-tight);
            letter-spacing: var(--tracking-display);
          `}
        >
          {byokTitle}
        </h3>
        {byokLines.map((line) => (
          <p css={noteStyles}>{line}</p>
        ))}
        <a
          href={byokSettingsUrl}
          target="_blank"
          rel="noopener noreferrer"
          css={`
            width: fit-content;
            max-width: 100%;
            color: var(--accent-text);
            font-size: var(--text-sm);
            line-height: var(--leading-snug);
            text-decoration: underline;
            text-underline-offset: 0.15em;
            overflow-wrap: anywhere;

            &:focus-visible {
              outline: var(--focus-width) solid var(--focus);
              outline-offset: 2px;
              border-radius: var(--radius-xs);
            }
          `}
        >
          openrouter.ai/settings/integrations
        </a>
      </div>
    </section>
  )
}
