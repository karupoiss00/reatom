import { action, atom, withConnectHook } from '@reatom/core'

import { pendingUndo, renameChat, undoDelete } from '../../chat/library'
import type { ChatId } from '../../storage/types'
import { toast } from '../../ui'

export const renamingId = atom<ChatId | null>(null, 'sidebar.renamingId')

export const renameDraft = atom('', 'sidebar.renameDraft')

const deletedToastKey = 'chat-deleted'

const deletedPhrase = (count: number) =>
  count === 1 ? 'Chat deleted · ' : `${count} chats deleted · `

export const startRename = action((id: ChatId, title: string) => {
  renameDraft.set(title)
  renamingId.set(id)
}, 'sidebar.startRename')

export const cancelRename = action(() => {
  renamingId.set(null)
}, 'sidebar.cancelRename')

export const commitRename = action(() => {
  const id = renamingId()
  if (id === null) return
  const draft = renameDraft()
  renamingId.set(null)
  renameChat(id, draft)
}, 'sidebar.commitRename')

export const undoToastConnection = atom(null, 'sidebar.undoToast').extend(
  withConnectHook(() =>
    pendingUndo.subscribe((pending) => {
      if (!pending || pending.ids.length === 0) {
        toast.dismiss(deletedToastKey)
        return
      }
      const remaining = pending.expiresAt - Date.now()
      toast.show({
        key: deletedToastKey,
        text: deletedPhrase(pending.ids.length),
        durationMs: Math.max(0, remaining),
        action: {
          label: 'Undo',
          onClick: () => undoDelete(),
        },
      })
    }),
  ),
)
