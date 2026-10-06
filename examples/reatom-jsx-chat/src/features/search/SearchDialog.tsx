import type { JSX } from '@reatom/jsx'

import { ui } from '../../app/ui'
import {
  activeHit,
  bindSearch,
  indexedCount,
  isCombiningOnlyQuery,
  recentChats,
  searchError,
  searchGroups,
  searchPhase,
  searchQuery,
  type SearchHit,
} from '../../search'
import type { ChatId, MessageId } from '../../storage/types'
import { Dialog, TextField } from '../../ui'
import { resetButton } from '../../ui/mixins'
import { openSearchHit } from './openHit'

interface SearchRow {
  key: string
  chatId: ChatId
  messageId: MessageId | null
  hit: SearchHit | null
}

const optionId = (key: string) => `search-opt-${key}`

const rows = (): SearchRow[] => {
  const query = searchQuery().trim()
  if (query.length === 0) {
    return recentChats().map((chat) => ({
      key: `recent-${chat.id}`,
      chatId: chat.id,
      messageId: null,
      hit: null,
    }))
  }
  return searchGroups().flatMap((group) =>
    group.hits.map((hit) => ({
      key: `${hit.chatId}-${hit.messageId ?? 'title'}`,
      chatId: hit.chatId,
      messageId: hit.messageId,
      hit,
    })),
  )
}

const moveHit = (delta: number) => {
  const list = rows()
  if (list.length === 0) return
  const current = activeHit()
  const next =
    current < 0
      ? delta > 0
        ? 0
        : list.length - 1
      : Math.min(list.length - 1, Math.max(0, current + delta))
  activeHit.set(next)
  const key = list[next]?.key
  if (!key) return
  queueMicrotask(() => {
    document.getElementById(optionId(key))?.scrollIntoView({ block: 'nearest' })
  })
}

const openRow = (row: SearchRow | undefined) => {
  if (!row) return
  openSearchHit({
    chatId: row.chatId,
    messageId: row.hit?.messageId ?? row.messageId,
  })
}

const onSearchKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveHit(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key !== 'Enter') return
  const row = rows()[activeHit()]
  if (!row) return
  event.preventDefault()
  openRow(row)
}

const focusSearchInput = () => {
  if (!ui.search()) return
  const input = document.querySelector<HTMLInputElement>('dialog[open] input[type="search"]')
  if (!input || document.activeElement === input) return
  input.focus()
}

const quote = (query: string) => `No chats match "${query.trim()}"`

const SnippetText = ({ hit }: { hit: SearchHit }) => (
  <span dir="auto">{hit.snippet.before}<mark>{hit.snippet.match}</mark>{hit.snippet.after}</span>
)

const OptionButton = ({
  row,
  index,
  kind,
  children,
}: {
  row: SearchRow
  index: number
  kind: 'recent' | 'title' | 'message'
  children?: JSX.ElementChildren
}) => (
  <button
    id={optionId(row.key)}
    type="button"
    role="option"
    data-search-option=""
    data-hit-kind={kind === 'recent' ? null : kind}
    data-message-id={row.messageId}
    attr:aria-selected={() => (activeHit() === index ? 'true' : 'false')}
    data-active={() => (activeHit() === index ? 'true' : 'false')}
    on:click={() => openRow(row)}
    css={`
      ${resetButton}
      display: block;
      width: 100%;
      min-height: var(--hit);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-size: var(--text-sm);
      line-height: var(--leading-snug);
      text-align: start;
      cursor: pointer;

      &[data-active='true'] {
        background: var(--surface-selected);
        box-shadow: inset 2px 0 0 var(--accent);
      }

      &:hover {
        background: var(--surface-hover);
      }
    `}
  >
    {children}
  </button>
)

const RecentList = () => {
  const chats = recentChats()
  return (
    <div css="display: grid; gap: var(--space-1);">
      <p
        css={`
          margin: 0;
          padding-inline: var(--space-2);
          color: var(--text-faint);
          font-size: var(--text-xs);
          font-weight: var(--weight-medium);
          letter-spacing: var(--tracking-caps);
          text-transform: uppercase;
        `}
      >
        Recent
      </p>
      <div role="listbox" aria-label="Recent chats" css="display: grid; gap: 1px;">
        {chats.map((chat, index) => (
          <OptionButton
            row={{
              key: `recent-${chat.id}`,
              chatId: chat.id,
              messageId: null,
              hit: null,
            }}
            index={index}
            kind="recent"
          >
            <span dir="auto">{chat.title}</span>
          </OptionButton>
        ))}
      </div>
    </div>
  )
}

const ResultList = () => {
  let index = 0
  return (
    <div css="display: grid; gap: var(--space-3);">
      {searchGroups().map((group) => (
        <section data-search-group={group.chatId} aria-label={group.title}>
          <h3
            dir="auto"
            css={`
              margin: 0;
              padding-inline: var(--space-2);
              color: var(--text-faint);
              font-size: var(--text-xs);
              font-weight: var(--weight-medium);
              letter-spacing: 0.01em;
            `}
          >
            {group.title}
          </h3>
          <div role="listbox" aria-label={group.title} css="display: grid; gap: 1px;">
            {group.hits.map((hit) => {
              const optionIndex = index
              index += 1
              const row: SearchRow = {
                key: `${hit.chatId}-${hit.messageId ?? 'title'}`,
                chatId: hit.chatId,
                messageId: hit.messageId,
                hit,
              }
              return (
                <OptionButton
                  row={row}
                  index={optionIndex}
                  kind={hit.messageId ? 'message' : 'title'}
                >
                  {hit.messageId ? null : (
                    <span
                      css={`
                        display: block;
                        margin-bottom: 0.15rem;
                        color: var(--text-faint);
                        font-size: var(--text-xs);
                        letter-spacing: var(--tracking-caps);
                        text-transform: uppercase;
                      `}
                    >
                      Title
                    </span>
                  )}
                  <SnippetText hit={hit} />
                </OptionButton>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

const SearchBody = () => {
  const failed = searchError()
  const query = searchQuery().trim()
  if (failed && query.length > 0) {
    return (
      <p role="alert" data-search-copy="">
        {failed}
      </p>
    )
  }
  if (query.length === 0) {
    const chats = recentChats()
    if (chats.length === 0) return <p data-search-copy="">No chats yet</p>
    return <RecentList />
  }
  if (isCombiningOnlyQuery(query) || searchPhase() === 'none') {
    return <p data-search-copy="">{quote(query)}</p>
  }
  if (searchPhase() === 'results') return <ResultList />
  return null
}

const copyStyles = `
  & [data-search-copy] {
    margin: 0;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: -0.02em;
  }

  & mark {
    padding: 0 0.12em;
    border-radius: 0.2rem;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
`

export const SearchDialog = () => (
  <div data-slot="SearchDialog" css="display: contents;">
    <style>{`
      [data-highlight='match'] {
        border-radius: var(--radius-md);
        background: var(--accent-soft);
        box-shadow: inset 3px 0 0 var(--accent);
      }
    `}</style>
    <Dialog open={ui.search} title="Search chats">
      <div
        data-search-root=""
        attr:data-indexed={() => {
          const count = indexedCount()
          return count === null ? null : String(count)
        }}
        on:keydown={onSearchKeyDown}
        ref={() => {
          const stop = bindSearch()
          const focus = () => {
            queueMicrotask(focusSearchInput)
            requestAnimationFrame(focusSearchInput)
          }
          const unsub = ui.search.subscribe((open) => {
            if (open) focus()
          })
          return () => {
            stop()
            unsub()
          }
        }}
        css={`
          ${copyStyles}
          display: grid;
          gap: var(--space-3);
        `}
      >
        <TextField
          label="Search chats"
          labelHidden
          type="search"
          leadingIcon="search"
          placeholder="Search chats"
          value={searchQuery}
          autofocus
          attr:role="searchbox"
          attr:aria-controls="search-results"
          attr:aria-activedescendant={() => {
            const row = rows()[activeHit()]
            return row ? optionId(row.key) : null
          }}
          attr:aria-autocomplete="list"
        />
        <div id="search-results">{() => (ui.search() ? <SearchBody /> : null)}</div>
      </div>
    </Dialog>
  </div>
)
