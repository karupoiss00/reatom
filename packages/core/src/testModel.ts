import { withAsync, withAsyncData } from './async'
import { action, atom, computed } from './core'
import { peek, wrap } from './methods'
import { sleep } from './utils'

export type Item = {
  id: number
  title: string
}

const defaultItems: Item[] = [
  { id: 0, title: 'Alpha' },
  { id: 1, title: 'Beta' },
  { id: 2, title: 'Gamma' },
  { id: 3, title: 'Delta' },
]

const pageSize = 1

/**
 * Typical catalog: page, derived pagination, selected row, async list, save.
 *
 * Atom identity is process-global (`.extend`, hooks). State is per
 * `context.start()` — `test()` already starts a fresh store. Do not `.extend()`
 * these atoms in a test, and do not pass them to helpers that lazily extend the
 * target (`suspense`); observe with `subscribe` / `getCalls`.
 *
 * Use {@link reatomCatalog} when a case must own identity.
 *
 * `latency` and `fail` simulate the server, so `list` reads them untracked:
 * flipping them never refetches, only `retry` or an input change does. Inputs
 * are read before the first `await`, so `list.onFulfill` params are always
 * `[visible, offset, rangeEnd]`.
 */
export const reatomCatalog = (name = 'catalog') => {
  const page = atom(0, `${name}.page`).extend((target) => ({
    go: action((value = 0) => target.set(value), `${target.name}.go`),
    next: action(() => target.set((value) => value + 1), `${target.name}.next`),
    prev: action(
      () => target.set((value) => Math.max(0, value - 1)),
      `${target.name}.prev`,
    ),
  }))
  const filter = atom('', `${name}.filter`)
  const items = atom(defaultItems, `${name}.items`)
  const selectedId = atom<null | number>(null, `${name}.selectedId`)
  const latency = atom(0, `${name}.latency`)
  const fail = atom(false, `${name}.fail`)

  const offset = computed(() => page() * pageSize, `${name}.offset`)
  const rangeEnd = computed(() => offset() + pageSize, `${name}.rangeEnd`)
  const pageLabel = computed(() => `Page ${page()}`, `${name}.pageLabel`)
  const filterLabel = computed(() => filter() || 'All', `${name}.filterLabel`)
  const heading = computed(
    () => `${pageLabel()} — ${filterLabel()}`,
    `${name}.heading`,
  )
  const visible = computed(() => {
    const query = filter()
    return items().filter((item) => item.title.includes(query))
  }, `${name}.visible`)
  const selected = computed(() => {
    const id = selectedId()
    return items().find((item) => item.id === id) ?? null
  }, `${name}.selected`)
  const preview = computed(
    () => selected() ?? visible()[0] ?? null,
    `${name}.preview`,
  )

  const initList: Item[] = []
  const list = computed(async () => {
    const rows = visible()
    const start = offset()
    const end = rangeEnd()
    const ms = peek(latency)
    const shouldFail = peek(fail)
    if (ms > 0) await wrap(sleep(ms))
    if (shouldFail) throw new Error('TEST')
    return rows.slice(start, end)
  }, `${name}.list`).extend(withAsyncData({ initState: initList }))

  const save = action(async (item: Item) => {
    const ms = latency()
    const shouldFail = fail()
    if (ms > 0) await wrap(sleep(ms))
    if (shouldFail) throw new Error('TEST')
    items.set((current) =>
      current.map((row) => (row.id === item.id ? item : row)),
    )
    return item
  }, `${name}.save`).extend(withAsync())

  return {
    page,
    filter,
    items,
    selectedId,
    latency,
    fail,
    offset,
    rangeEnd,
    pageLabel,
    filterLabel,
    heading,
    visible,
    selected,
    preview,
    list,
    save,
  }
}

export const catalog = reatomCatalog()
