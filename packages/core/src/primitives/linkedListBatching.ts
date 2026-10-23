const batchingLinkedLists = new WeakSet<object>()
const linkedListSources = new WeakMap<object, object>()

export const registerLinkedListSource = (list: object, source: object) => {
  linkedListSources.set(list, source)
}

export const startLinkedListBatching = (list: object) => {
  batchingLinkedLists.add(list)
}

export const endLinkedListBatching = (list: object) => {
  batchingLinkedLists.delete(list)
}

export const isLinkedListBatching = (list: object): boolean => {
  const source = linkedListSources.get(list)
  return (
    batchingLinkedLists.has(list) || !!(source && isLinkedListBatching(source))
  )
}
