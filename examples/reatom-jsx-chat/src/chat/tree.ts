import type { MessageId, MessageRecord } from '../storage/types'
import type { ThreadNode } from './types'

export const rootSelectionKey = 'root'

export const selectionKeyOf = (message: Pick<MessageRecord, 'parentId'>) =>
  message.parentId ?? rootSelectionKey

export const ancestorChain = (
  messages: ReadonlyMap<MessageId, MessageRecord>,
  lastId: MessageId,
): MessageRecord[] => {
  const chain: MessageRecord[] = []
  const visited = new Set<MessageId>()
  let current = messages.get(lastId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.push(current)
    current = current.parentId ? messages.get(current.parentId) : undefined
  }
  return chain.reverse()
}

export const siblingsOf = (
  messages: Iterable<MessageRecord>,
  parentId: MessageId | null,
): MessageRecord[] =>
  [...messages]
    .filter((message) => message.parentId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

const byCreation = (a: MessageRecord, b: MessageRecord) =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id)

export const buildPath = (
  messages: Iterable<MessageRecord>,
  selection: Record<string, MessageId>,
): ThreadNode[] => {
  const childrenByParent = new Map<string, MessageRecord[]>()
  for (const message of messages) {
    const parentKey = message.parentId ?? rootSelectionKey
    const siblings = childrenByParent.get(parentKey)
    if (siblings) siblings.push(message)
    else childrenByParent.set(parentKey, [message])
  }

  const path: ThreadNode[] = []
  const visited = new Set<MessageId>()
  let parentKey: string = rootSelectionKey
  while (true) {
    const siblings = childrenByParent.get(parentKey)?.sort(byCreation)
    if (!siblings || siblings.length === 0) break
    const selectedId = selection[parentKey]
    const selectedIndex = siblings.findIndex(
      (message) => message.id === selectedId,
    )
    const versionIndex =
      selectedIndex >= 0 ? selectedIndex : siblings.length - 1
    const message = siblings[versionIndex]!
    if (visited.has(message.id)) break
    visited.add(message.id)
    path.push({
      message,
      versions: siblings.map((sibling) => sibling.id),
      versionIndex,
    })
    parentKey = message.id
  }
  return path
}
