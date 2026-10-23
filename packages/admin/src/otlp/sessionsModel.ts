import { atom, computed, withChangeHook, withMemo } from '@reatom/core'
import type { AdminRecord } from './ingest.ts'
import {
  investigationSessions,
  journeySignal,
  sessionSearchText,
} from './sessions.ts'

export function reatomInvestigationSessions(
  records: () => readonly AdminRecord[],
  name: string,
  contentChanges?: () => {
    revisionOf: (record: AdminRecord) => number
  },
) {
  const tab = atom<'sessions' | 'overview'>('sessions', `${name}.tab`)
  const search = atom('', `${name}.search`)
  const errorsOnly = atom(false, `${name}.errorsOnly`)
  const sort = atom<'newest' | 'oldest' | 'errors' | 'pages' | 'duration'>(
    'newest',
    `${name}.sort`,
  )
  const selectedId = atom<string | null>(null, `${name}.selectedId`)
  const journeySearch = atom('', `${name}.journeySearch`)
  const signal = atom<'all' | 'errors' | 'spans' | 'logs' | 'measurements'>(
    'all',
    `${name}.signal`,
  )
  const scrollTop = atom(0, `${name}.scrollTop`)
  const scopeSessionId = atom<string | null>(null, `${name}.scopeSessionId`)
  const journeyScrollTop = atom(0, `${name}.journeyScrollTop`)
  const sessions = computed(
    () => investigationSessions(records()),
    `${name}.sessions`,
  )
  const scopeIds = computed(() => {
    const id = scopeSessionId()
    return id === null
      ? null
      : new Set(
          sessions()
            .find((session) => session.id === id)
            ?.records.map((record) => record.id) ?? [],
        )
  }, `${name}.scopeIds`)
  const selected = computed(
    () => sessions().find((session) => session.id === selectedId()) ?? null,
    `${name}.selected`,
  )
  const rows = computed(() => {
    const query = search().toLowerCase()
    const currentSort = sort()
    return sessions()
      .filter(
        (session) =>
          (!errorsOnly() || session.errors > 0) &&
          [
            session.label,
            session.entry,
            session.last,
            ...session.records.map(sessionSearchText),
          ]
            .join(' ')
            .toLowerCase()
            .includes(query),
      )
      .sort((a, b) => {
        const difference =
          currentSort === 'newest'
            ? b.start - a.start
            : currentSort === 'oldest'
              ? a.start - b.start
              : currentSort === 'duration'
                ? b.end - b.start - (a.end - a.start)
                : b[currentSort] - a[currentSort]
        return difference || a.id.localeCompare(b.id)
      })
  }, `${name}.rows`)
  // Store enrichment may mutate a captured record in place. Membership alone
  // cannot distinguish that change from an unrelated capture append.
  const journeyEntries = computed(() => {
    const changes = contentChanges?.()
    const query = journeySearch().toLowerCase()
    const filter = signal()
    return (selected()?.records ?? [])
      .filter(
        (record) =>
          (filter === 'all' || journeySignal(record) === filter) &&
          sessionSearchText(record).includes(query),
      )
      .map((record) => ({ record, revision: changes?.revisionOf(record) ?? 0 }))
  }, `${name}.journeyEntries`).extend(
    withMemo(
      (previous, next) =>
        previous?.length === next.length &&
        previous.every(
          (entry, index) =>
            entry.record === next[index]!.record &&
            entry.revision === next[index]!.revision,
        ),
    ),
  )
  const journey = computed(
    () => journeyEntries().map((entry) => entry.record),
    `${name}.journey`,
  )
  const listPageChoice = atom(0, `${name}.listPageChoice`)
  const journeyPageChoice = atom(0, `${name}.journeyPageChoice`)
  const listPage = computed(
    () =>
      Math.min(
        listPageChoice(),
        Math.max(0, Math.ceil(rows().length / 100) - 1),
      ),
    `${name}.listPage`,
  )
  const journeyPage = computed(
    () =>
      Math.min(
        journeyPageChoice(),
        Math.max(0, Math.ceil(journey().length / 100) - 1),
      ),
    `${name}.journeyPage`,
  )
  for (const field of [search, errorsOnly, sort])
    field.extend(withChangeHook(() => listPageChoice.set(0)))
  for (const field of [journeySearch, signal, selectedId])
    field.extend(withChangeHook(() => journeyPageChoice.set(0)))
  return {
    scopeSessionId,
    journeyScrollTop,
    listPageChoice,
    journeyPageChoice,
    listPage,
    journeyPage,
    tab,
    search,
    errorsOnly,
    sort,
    selectedId,
    journeySearch,
    signal,
    scrollTop,
    scopeIds,
    sessions,
    selected,
    rows,
    journey,
  }
}
