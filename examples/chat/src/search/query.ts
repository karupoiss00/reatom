import type { ChatId, MessageId } from '../storage/types'

export interface SearchSnippet {
  before: string
  match: string
  after: string
}

export interface SearchHit {
  chatId: ChatId
  messageId: MessageId | null
  snippet: SearchSnippet
}

export interface SearchResultGroup {
  chatId: ChatId
  title: string
  hits: SearchHit[]
}

export interface IndexedMessage {
  chatId: ChatId
  messageId: MessageId
  text: string
  folded: string
}

export interface SearchableChat {
  id: ChatId
  title: string
  lastActivityAt: number
}

const snippetRadius = 48
const hitsPerChat = 4
const groupLimit = 30

export const normalizeForSearch = (text: string): string =>
  text.normalize('NFKC').toLocaleLowerCase('en-US')

export const isCombiningOnlyQuery = (query: string): boolean => {
  const folded = normalizeForSearch(query).trim()
  return folded.length > 0 && /^[\p{M}]+$/u.test(folded)
}

const mapFoldedOffset = (text: string, foldedIndex: number) => {
  if (foldedIndex <= 0) return 0
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (normalizeForSearch(text.slice(0, mid)).length < foldedIndex)
      low = mid + 1
    else high = mid
  }
  return low
}

export const snippetAround = (
  text: string,
  foldedQuery: string,
): SearchSnippet | null => {
  if (foldedQuery.length === 0) return null
  const folded = normalizeForSearch(text)
  const at = folded.indexOf(foldedQuery)
  if (at < 0) return null
  const start = mapFoldedOffset(text, at)
  const end = mapFoldedOffset(text, at + foldedQuery.length)
  if (end <= start) return null
  const from = Math.max(0, start - snippetRadius)
  const to = Math.min(text.length, end + snippetRadius)
  return {
    before: `${from > 0 ? '…' : ''}${text.slice(from, start)}`,
    match: text.slice(start, end),
    after: `${text.slice(end, to)}${to < text.length ? '…' : ''}`,
  }
}

const pushHit = (groups: Map<ChatId, SearchHit[]>, hit: SearchHit) => {
  const hits = groups.get(hit.chatId)
  if (!hits) {
    groups.set(hit.chatId, [hit])
    return
  }
  if (hits.length >= hitsPerChat) return
  hits.push(hit)
}

export const matchGroups = (
  docs: readonly IndexedMessage[],
  query: string,
  chats: readonly SearchableChat[],
): SearchResultGroup[] => {
  const foldedQuery = normalizeForSearch(query).trim()
  if (foldedQuery.length === 0 || isCombiningOnlyQuery(query)) return []
  const live = new Map(chats.map((chat) => [chat.id, chat]))
  const hitsByChat = new Map<ChatId, SearchHit[]>()

  for (const chat of live.values()) {
    const snippet = snippetAround(chat.title, foldedQuery)
    if (!snippet) continue
    pushHit(hitsByChat, { chatId: chat.id, messageId: null, snippet })
  }

  for (const doc of docs) {
    if (!live.has(doc.chatId)) continue
    const existing = hitsByChat.get(doc.chatId)
    if (existing && existing.length >= hitsPerChat) continue
    if (!doc.folded.includes(foldedQuery)) continue
    const snippet = snippetAround(doc.text, foldedQuery)
    if (!snippet) continue
    pushHit(hitsByChat, {
      chatId: doc.chatId,
      messageId: doc.messageId,
      snippet,
    })
  }

  return [...hitsByChat.entries()]
    .map(([chatId, hits]) => ({
      chatId,
      title: live.get(chatId)?.title ?? 'Chat',
      hits,
    }))
    .sort(
      (a, b) =>
        (live.get(b.chatId)?.lastActivityAt ?? 0) -
        (live.get(a.chatId)?.lastActivityAt ?? 0),
    )
    .slice(0, groupLimit)
}
