import {
  action,
  atom,
  computed,
  isAbort,
  sleep,
  withAbort,
  wrap,
} from '@reatom/core'

import { ui } from '../app/ui'
import { library } from '../chat/library'
import { repo } from '../storage/repo'
import type { ChatRecord } from '../storage/types'
import {
  isCombiningOnlyQuery,
  matchGroups,
  normalizeForSearch,
  type IndexedMessage,
  type SearchResultGroup,
} from './query'

export type { IndexedMessage, SearchHit, SearchResultGroup, SearchSnippet } from './query'
export { isCombiningOnlyQuery, normalizeForSearch }

const searchDebounceMs = 32
const recentLimit = 8

export const searchQuery = atom('', 'search.query')
export const searchError = atom<string | null>(null, 'search.error')
export const searchGroups = atom<SearchResultGroup[]>([], 'search.groups')
export const searchPhase = atom<'idle' | 'pending' | 'results' | 'none' | 'error'>(
  'idle',
  'search.phase',
)
export const activeHit = atom(-1, 'search.activeHit')

const searchIndex = atom<{ docs: IndexedMessage[]; generation: number } | null>(
  null,
  'search.index',
)

let corpusGeneration = 0
let corpusWritesWatched = false

const noteCorpusWrite = () => {
  corpusGeneration += 1
}

const watchCorpusWrites = () => {
  if (corpusWritesWatched) return
  corpusWritesWatched = true
  const putMessage = repo.putMessage.bind(repo)
  const deleteMessage = repo.deleteMessage.bind(repo)
  const bulkImport = repo.bulkImport.bind(repo)
  const purgeChat = repo.purgeChat.bind(repo)
  const deleteAllChatsAndPresets = repo.deleteAllChatsAndPresets.bind(repo)
  repo.putMessage = async (message) => {
    await putMessage(message)
    noteCorpusWrite()
  }
  repo.deleteMessage = async (id) => {
    await deleteMessage(id)
    noteCorpusWrite()
  }
  repo.bulkImport = async (input) => {
    await bulkImport(input)
    noteCorpusWrite()
  }
  repo.purgeChat = async (id) => {
    await purgeChat(id)
    noteCorpusWrite()
  }
  repo.deleteAllChatsAndPresets = async () => {
    await deleteAllChatsAndPresets()
    noteCorpusWrite()
  }
}

watchCorpusWrites()

export const indexedCount = computed(
  () => searchIndex()?.docs.length ?? null,
  'search.indexedCount',
)

export const recentChats = computed(() => {
  return [...library.chats()]
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt)
    .slice(0, recentLimit)
}, 'search.recentChats')

const searchableChats = (chats: readonly ChatRecord[]) =>
  chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    lastActivityAt: chat.lastActivityAt,
  }))

const collectMessages = async (): Promise<IndexedMessage[]> => {
  const docs: IndexedMessage[] = []
  await repo.scanMessages((message) => {
    if (message.content.length === 0) return
    docs.push({
      chatId: message.chatId,
      messageId: message.id,
      text: message.content,
      folded: normalizeForSearch(message.content),
    })
  })
  return docs
}

const loadIndex = async () => {
  for (;;) {
    const generation = corpusGeneration
    const cached = searchIndex()
    if (cached && cached.generation === generation) return cached
    const docs = await wrap(collectMessages())
    if (corpusGeneration !== generation) continue
    const built = { docs, generation }
    searchIndex.set(built)
    return built
  }
}

const publishSearch = (docs: readonly IndexedMessage[], trimmed: string) => {
  searchError.set(null)
  if (trimmed.length === 0 || normalizeForSearch(trimmed).length === 0) {
    searchGroups.set([])
    searchPhase.set('idle')
    return
  }
  if (isCombiningOnlyQuery(trimmed)) {
    searchGroups.set([])
    searchPhase.set('none')
    return
  }
  const groups = matchGroups(docs, trimmed, searchableChats(library.chats()))
  searchGroups.set(groups)
  searchPhase.set(groups.length === 0 ? 'none' : 'results')
}

export const runSearch = action(async () => {
  if (!ui.search()) return
  const trimmed = searchQuery().trim()
  const cached = searchIndex()
  if (cached && cached.generation === corpusGeneration) publishSearch(cached.docs, trimmed)
  else searchPhase.set('pending')
  await wrap(sleep(searchDebounceMs))
  if (!ui.search()) return
  try {
    const { docs } = await wrap(loadIndex())
    if (!ui.search()) return
    publishSearch(docs, searchQuery().trim())
  } catch (error) {
    if (isAbort(error)) throw error
    searchGroups.set([])
    searchError.set("Couldn't search saved chats.")
    searchPhase.set('error')
  }
}, 'search.run').extend(withAbort())

export const bindSearch = () => {
  const unsubOpen = ui.search.subscribe((open) => {
    if (!open) {
      if (searchQuery()) searchQuery.set('')
      searchError.set(null)
      searchGroups.set([])
      searchPhase.set('idle')
      activeHit.set(-1)
      return
    }
    runSearch().catch(() => {})
  })
  const unsubQuery = searchQuery.subscribe(() => {
    activeHit.set(-1)
    if (!ui.search()) return
    runSearch().catch(() => {})
  })
  return () => {
    unsubOpen()
    unsubQuery()
  }
}
