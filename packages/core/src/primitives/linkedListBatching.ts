const batchingLinkedLists = new WeakSet<object>()

export const startLinkedListBatching = (list: object) => {
  batchingLinkedLists.add(list)
}

export const endLinkedListBatching = (list: object) => {
  batchingLinkedLists.delete(list)
}

export const isLinkedListBatching = (list: object): boolean =>
  batchingLinkedLists.has(list)
