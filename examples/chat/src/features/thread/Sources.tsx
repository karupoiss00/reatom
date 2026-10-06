import { computed, peek } from '@reatom/core'

import { getChatModel } from '../../chat'
import type { Citation } from '../../storage/types'
import { Icon } from '../../ui'
import type { MessageSlotProps } from '../slots'

const httpCitation = (candidate: Citation | null | undefined): Citation | null => {
  const url = candidate?.url
  if (typeof url !== 'string' || url.trim().length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  const hostname = parsed.hostname.replace(/^www\./, '')
  const domain =
    typeof candidate?.domain === 'string' && candidate.domain.trim().length > 0
      ? candidate.domain.trim()
      : hostname
  if (domain.length === 0) return null
  const title =
    typeof candidate?.title === 'string' && candidate.title.trim().length > 0
      ? candidate.title.trim()
      : null
  return { url, title, domain }
}

const listedCitations = (citations: Citation[] | null | undefined): Citation[] => {
  if (!Array.isArray(citations)) return []
  const kept: Citation[] = []
  for (const citation of citations) {
    const safe = httpCitation(citation)
    if (safe) kept.push(safe)
  }
  return kept
}

export const Sources = ({ message }: MessageSlotProps) => {
  const messageId = peek(message).id
  const view = computed(() => {
    const current = message()
    const citations = listedCitations(current.citations)
    const searching =
      citations.length === 0 &&
      current.content.length === 0 &&
      (current.status === 'waiting' || current.status === 'streaming') &&
      getChatModel(current.chatId).settings().webSearch
    return { citations, searching }
  }, `features.thread.sources#${messageId}`)

  return (
    <div data-slot="Sources" css="display: contents;">
      {() =>
        view().searching ? (
          <p
            data-web-search-status=""
            css={`
              display: flex;
              align-items: center;
              gap: var(--space-2);
              margin: 0;
              color: var(--text-muted);
              font-size: var(--text-sm);
              line-height: var(--leading-snug);
            `}
          >
            <Icon name="globe" size="1rem" />
            Searching the web…
          </p>
        ) : null
      }
      {() => {
        const citations = view().citations
        if (citations.length === 0) return null
        return (
          <section
            data-sources=""
            css={`
              display: grid;
              gap: var(--space-2);
              min-width: 0;
              margin-top: var(--space-1);
              padding-top: var(--space-3);
              border-top: 1px solid var(--line);
            `}
          >
            <h3
              css={`
                margin: 0;
                color: var(--text);
                font-family: var(--font-display);
                font-size: var(--text-sm);
                font-weight: var(--weight-medium);
                letter-spacing: -0.01em;
                line-height: var(--leading-snug);
              `}
            >
              Sources
            </h3>
            <ol
              css={`
                display: grid;
                gap: var(--space-2);
                margin: 0;
                padding: 0;
                list-style: none;
              `}
            >
              {citations.map((citation, index) => (
                <li
                  css={`
                    display: grid;
                    grid-template-columns: auto minmax(0, 1fr);
                    gap: var(--space-2);
                    align-items: start;
                    min-width: 0;
                  `}
                >
                  <sup
                    css={`
                      color: var(--accent-text);
                      font-size: var(--text-xs);
                      font-weight: var(--weight-semibold);
                      line-height: 1.4;
                    `}
                  >
                    {index + 1}
                  </sup>
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    css={`
                      display: grid;
                      gap: 0.1rem;
                      min-width: 0;
                      color: inherit;
                      text-decoration: none;

                      &:hover {
                        text-decoration: underline;
                        text-underline-offset: 0.15em;
                      }

                      &:focus-visible {
                        outline: var(--focus-width) solid var(--focus);
                        outline-offset: 2px;
                        border-radius: var(--radius-sm);
                      }
                    `}
                  >
                    <span
                      data-source-domain=""
                      css={`
                        color: var(--text-muted);
                        font-size: var(--text-xs);
                        line-height: var(--leading-snug);
                      `}
                    >
                      {citation.domain}
                    </span>
                    {citation.title ? (
                      <span
                        data-source-title=""
                        css={`
                          color: var(--text);
                          font-size: var(--text-sm);
                          line-height: var(--leading-snug);
                        `}
                      >
                        {citation.title}
                      </span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )
      }}
    </div>
  )
}
