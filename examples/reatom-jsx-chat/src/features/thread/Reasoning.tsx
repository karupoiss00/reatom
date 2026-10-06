import { atom, computed, peek, wrap } from '@reatom/core'

import { now } from '../../platform/env'
import { Icon } from '../../ui'
import { focusRing, resetButton } from '../../ui/mixins'
import type { MessageSlotProps } from '../slots'

const elapsedSeconds = (startedAt: number, endedAt: number | null, clock: number) => {
  const end = endedAt ?? clock
  return Math.max(0, Math.floor((end - startedAt) / 1000))
}

const blockCss = `
  display: grid;
  justify-items: start;
  gap: var(--space-1);
  min-width: 0;
  max-width: 40rem;
`

const toggleCss = `
  ${resetButton}
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--hit);
  max-width: 100%;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-snug);
  text-align: left;
  cursor: pointer;

  & svg {
    transition: transform var(--duration-fast) var(--ease-standard);
  }

  &[aria-expanded='true'] svg {
    transform: rotate(90deg);
  }

  &:hover {
    color: var(--text);
  }

  &:focus-visible {
    ${focusRing}
  }

  @media (prefers-reduced-motion: reduce) {
    & svg {
      transition: none;
    }
  }
`

const quoteCss = `
  margin: 0;
  max-width: 100%;
  padding: 0.15rem 0 0.15rem var(--space-3);
  border-left: 2px solid var(--line-strong);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  white-space: pre-wrap;
  overflow-wrap: anywhere;

  &[data-live='true'] {
    border-left-color: var(--accent);
    color: var(--text-muted);
  }
`

const hiddenCss = `
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--hit);
  margin: 0;
  max-width: 40rem;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-snug);
`

export const Reasoning = ({ message }: MessageSlotProps) => {
  const messageId = peek(message).id
  const name = `features.thread.reasoning#${messageId}`
  const clock = atom(now(), `${name}.clock`)
  const open = atom(false, `${name}.open`)
  const reasoning = computed(() => message().reasoning, `${name}.record`)
  const thinking = computed(() => {
    const current = reasoning()
    return (
      current !== null &&
      current.endedAt === null &&
      !current.stoppedWhileThinking &&
      !current.hiddenByProvider
    )
  }, `${name}.thinking`)
  const seconds = computed(() => {
    const current = reasoning()
    if (!current?.startedAt) return 0
    if (current.endedAt !== null) {
      return elapsedSeconds(current.startedAt, current.endedAt, current.endedAt)
    }
    return elapsedSeconds(current.startedAt, null, clock())
  }, `${name}.seconds`)
  const label = computed(() => {
    const current = reasoning()
    if (!current) return ''
    if (current.stoppedWhileThinking) return 'Stopped while thinking'
    const duration = `${seconds()}s`
    if (current.hiddenByProvider) {
      return `Thought for ${duration} (hidden by provider)`
    }
    if (thinking()) return `Thinking… ${duration}`
    return `Thought for ${duration}`
  }, `${name}.label`)
  const phase = computed(() => {
    const current = reasoning()
    if (!current) return 'idle'
    if (current.stoppedWhileThinking) return 'stopped'
    if (current.hiddenByProvider) return 'hidden'
    if (thinking()) return 'thinking'
    return 'thought'
  }, `${name}.phase`)

  const tick = wrap(() => {
    const current = message().reasoning
    if (!current || current.endedAt !== null || current.stoppedWhileThinking) return
    clock.set(now())
  })

  return (
    <div
      data-slot="Reasoning"
      css="display: contents;"
      ref={() => {
        const timer = setInterval(tick, 1000)
        return () => clearInterval(timer)
      }}
    >
      {() => {
        const current = reasoning()
        if (!current) return null
        const readable = current.text.length > 0 && !current.hiddenByProvider
        if (!readable && !current.hiddenByProvider && !current.stoppedWhileThinking) {
          return null
        }
        if (current.hiddenByProvider && !current.stoppedWhileThinking) {
          return (
            <p data-reasoning="hidden" css={hiddenCss}>
              <Icon name="lock" size="1rem" />
              <span data-reasoning-label="">{label()}</span>
            </p>
          )
        }
        return (
          <div data-reasoning={phase()} css={blockCss}>
            <button
              type="button"
              attr:aria-expanded={() => (open() ? 'true' : 'false')}
              on:click={() => open.set((value) => !value)}
              css={toggleCss}
            >
              <Icon name="chevron-right" size="1rem" />
              <span data-reasoning-label="">{() => label()}</span>
            </button>
            {() => {
              if (!open()) return null
              const shown = reasoning()
              if (!shown || shown.hiddenByProvider || shown.text.length === 0) return null
              return (
                <p
                  data-reasoning-text=""
                  data-live={thinking() ? 'true' : 'false'}
                  css={quoteCss}
                >
                  {shown.text}
                </p>
              )
            }}
          </div>
        )
      }}
    </div>
  )
}
