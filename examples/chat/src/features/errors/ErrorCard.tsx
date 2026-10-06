import { atom, computed, peek, wrap } from '@reatom/core'
import type { Atom } from '@reatom/core'

import { inFlightSentence, rateLimitedTitle } from '../../errors/copy'
import type { ErrorAction, ErrorInfo, ErrorKind } from '../../errors/types'
import { formatContextLength } from '../../money'
import { isOnline } from '../../platform/env'
import { Button, Icon, type IconName } from '../../ui'
import type { AssistantSlotProps } from '../slots'
import { addCreditsUrl, keyPageUrl } from '../keychip/model'
import { runErrorAction } from './actions'

export interface ErrorCardProps extends AssistantSlotProps {
  error: ErrorInfo
}

const iconFor = (
  kind: ErrorKind,
): { name: IconName; label: string } => {
  switch (kind) {
    case 'auth-rejected':
      return { name: 'key', label: 'Key rejected' }
    case 'out-of-credits':
    case 'key-limit':
    case 'payment-required':
    case 'in-flight-budget':
      return { name: 'warning', label: 'Payment required' }
    case 'moderation':
    case 'refused-403':
    case 'refusal':
      return { name: 'danger', label: 'Request blocked' }
    case 'timeout':
      return { name: 'warning', label: 'Timed out' }
    case 'rate-limited':
      return { name: 'warning', label: 'Rate limited' }
    case 'unavailable':
    case 'provider-disconnected':
      return { name: 'warning', label: 'Model unavailable' }
    case 'context-too-long':
      return { name: 'warning', label: 'Conversation too long' }
    case 'unknown-model':
      return { name: 'warning', label: 'Unknown model' }
    case 'bad-request':
    case 'param-rejected':
    case 'too-large':
      return { name: 'warning', label: 'Request rejected' }
    case 'web-search-zdr':
      return { name: 'globe', label: 'Web search unavailable' }
    case 'unknown':
      return { name: 'danger', label: 'Something went wrong' }
    case 'connection-lost':
      return { name: 'offline', label: 'Connection lost' }
    case 'empty-reasoning':
    case 'empty-reply':
    case 'cut-off':
      return { name: 'info', label: 'Incomplete reply' }
  }
}

const linkHref = (id: ErrorAction['id']) =>
  id === 'add-credits' ? addCreditsUrl : keyPageUrl()

const isExternalLink = (id: ErrorAction['id']) =>
  id === 'add-credits' || id === 'raise-limit'

const startCountdown = (remaining: Atom<number | null>, initial: number | null) => {
  if (initial === null || initial <= 0) return
  const timer = setInterval(
    wrap(() => {
      const left = remaining()
      if (left === null || left <= 1) {
        remaining.set(0)
        clearInterval(timer)
        return
      }
      remaining.set(left - 1)
    }),
    1000,
  )
  return () => clearInterval(timer)
}

const shownWait = (left: number | null) =>
  left !== null && left > 0 ? left : null

export const ErrorCard = ({ chat, message, error }: ErrorCardProps) => {
  const messageId = peek(message).id
  const name = `features.errors.card#${messageId}`
  const icon = iconFor(error.kind)
  const remainingSec = atom<number | null>(error.retryAfterSec, `${name}.remaining`)
  const retryReleased = atom(false, `${name}.retryReleased`)
  const detailsOpen = atom(false, `${name}.details`)
  const retryBlocked = computed(() => {
    if (!isOnline()) return true
    if (retryReleased()) return false
    const left = remainingSec()
    return left !== null && left > 0
  }, `${name}.retryBlocked`)
  const titleText = computed(() => {
    const left = shownWait(remainingSec())
    if (error.kind === 'rate-limited' && error.retryAfterSec !== null) {
      return rateLimitedTitle(left)
    }
    if (error.kind === 'in-flight-budget' && error.retryAfterSec !== null) {
      return inFlightSentence(left)
    }
    return error.title
  }, `${name}.title`)
  const detailsId = `${name}.panel`

  const onAction = (item: ErrorAction) => {
    if (item.id === 'retry' && retryBlocked()) return
    const current = message()
    runErrorAction({
      chat,
      assistantId: current.id,
      parentId: current.parentId,
      action: item,
      suggestions: error.suggestions,
      releaseRetry: () => retryReleased.set(true),
    })
  }

  const actions = [error.primary, ...error.secondary].flatMap((item) =>
    item ? [item] : [],
  )
  const suggestions =
    error.kind === 'context-too-long' ? (error.suggestions ?? []) : []
  const titleEchoedByStatus =
    error.kind === 'connection-lost' && error.title === 'Connection lost'

  return (
    <div
      data-slot="ErrorCard"
      data-kind={error.kind}
      data-notice={error.notice ? 'true' : 'false'}
      role="alert"
      ref={() => startCountdown(remainingSec, error.retryAfterSec)}
      css={`
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: start;
        gap: var(--space-2) var(--space-3);
        min-width: 0;
        max-width: 100%;
        padding: var(--space-3) var(--space-4);
        border: 1px solid var(--danger-line);
        border-radius: var(--radius-md);
        background: var(--bg-elevated);
        color: var(--text);
        overflow-wrap: anywhere;

        &[data-notice='true'] {
          padding: var(--space-2) 0 var(--space-2) var(--space-3);
          border: 0;
          border-left: 2px solid var(--warning-line);
          border-radius: 0;
          background: transparent;
        }

        & [data-error-icon] {
          display: grid;
          place-items: center;
          width: 1.75rem;
          height: 1.75rem;
          color: var(--danger);
        }

        &[data-notice='true'] [data-error-icon] {
          color: var(--warning);
        }

        & [data-error-copy] {
          display: grid;
          gap: var(--space-2);
          min-width: 0;
        }

        & [data-error-title] {
          margin: 0;
          color: var(--text);
          font-family: var(--font-display);
          font-size: var(--text-md);
          font-weight: var(--weight-medium);
          line-height: var(--leading-snug);
          letter-spacing: -0.01em;
        }

        & [data-error-sentence] {
          margin: 0;
          color: var(--text);
          font-size: var(--text-sm);
          line-height: var(--leading-body);
        }

        & [data-error-flagged] {
          margin: 0;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          background: var(--bg-sunken);
          color: var(--text);
          font-size: var(--text-sm);
          line-height: var(--leading-snug);
        }

        & [data-error-suggestions],
        & [data-error-actions] {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-2);
          min-width: 0;
        }

        & [data-error-actions] button,
        & [data-error-actions] a,
        & [data-error-suggestions] button {
          max-width: 100%;
          height: auto;
          white-space: normal;
        }

        & [data-error-link] {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: var(--control-height);
          padding: 0 var(--space-4);
          border-radius: var(--radius-pill);
          background: var(--bg-elevated);
          box-shadow: var(--shadow-1);
          color: var(--text);
          font-size: var(--text-sm);
          font-weight: var(--weight-medium);
          line-height: var(--leading-snug);
          text-align: center;
          text-decoration: none;
          border: 1px solid var(--line-strong);

          &[data-primary='true'] {
            border-color: transparent;
            background: var(--accent);
            color: var(--accent-ink);
          }

          &:focus-visible {
            outline: var(--focus-width) solid var(--focus);
            outline-offset: 2px;
          }
        }

        & [data-error-details] {
          display: grid;
          gap: var(--space-1);
          margin: 0;
          color: var(--text);
          font-size: var(--text-xs);
          line-height: var(--leading-snug);
        }

        & [data-error-details] div {
          display: grid;
          gap: 0.1rem;
        }

        & [data-error-details] dt {
          color: var(--text-muted);
        }

        & [data-error-details] dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
      `}
    >
      <span data-error-icon="">
        <Icon name={icon.name} label={icon.label} size="1.25rem" />
      </span>
      <div data-error-copy="">
        {titleEchoedByStatus ? null : (
          <strong data-error-title="">{() => titleText()}</strong>
        )}
        {error.sentence ? (
          <p data-error-sentence="">{error.sentence}</p>
        ) : null}
        {error.flaggedInput ? (
          <blockquote data-error-flagged="">{error.flaggedInput}</blockquote>
        ) : null}
        {suggestions.length > 0 ? (
          <div data-error-suggestions="">
            {suggestions.map((suggestion) => (
              <Button
                size="sm"
                variant="secondary"
                data-action="switch-longer-context"
                data-model={suggestion.id}
                on:click={() =>
                  onAction({
                    id: 'switch-longer-context',
                    label: suggestion.name,
                    modelId: suggestion.id,
                  })
                }
              >
                {suggestion.name} · {formatContextLength(suggestion.contextLength)}
              </Button>
            ))}
          </div>
        ) : null}
        {actions.length > 0 ? (
          <div data-error-actions="">
            {actions.map((item) =>
              isExternalLink(item.id) ? (
                <a
                  data-error-link=""
                  data-action={item.id}
                  data-primary={item === error.primary ? 'true' : 'false'}
                  href={() => linkHref(item.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.label}
                </a>
              ) : (
                <Button
                  size="sm"
                  variant={item === error.primary ? 'primary' : 'secondary'}
                  data-action={item.id}
                  data-primary={item === error.primary ? 'true' : 'false'}
                  disabled={
                    item.id === 'retry' ? retryBlocked : item.disabled === true
                  }
                  on:click={() => onAction(item)}
                >
                  {item.label}
                </Button>
              ),
            )}
          </div>
        ) : null}
        {error.notice ? null : (
          <div>
            <Button
              size="sm"
              variant="ghost"
              data-action="details"
              attr:aria-expanded={() => (detailsOpen() ? 'true' : 'false')}
              attr:aria-controls={detailsId}
              on:click={() => detailsOpen.set((open) => !open)}
            >
              Details
            </Button>
            {() =>
              detailsOpen() ? (
                <dl id={detailsId} data-error-details="">
                  <div>
                    <dt>Code</dt>
                    <dd>{error.details.code ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Message</dt>
                    <dd>{error.details.message ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Request id</dt>
                    <dd>{error.details.requestId ?? '—'}</dd>
                  </div>
                </dl>
              ) : null
            }
          </div>
        )}
      </div>
    </div>
  )
}
