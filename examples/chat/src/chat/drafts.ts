import {
  action,
  atom,
  sleep,
  withAbort,
  withAsync,
  withChangeHook,
  withConnectHook,
  wrap,
  type Atom,
} from '@reatom/core'

import { now, tabId } from '../platform/env'
import type { TabId } from '../platform/types'
import { repo } from '../storage/repo'
import type { AttachmentRef, ChatId, DraftRecord } from '../storage/types'

export const draftSaveDelayMs = 300

export const createDraftRecord = (input: {
  chatId: ChatId | 'new'
  tabId: TabId
  text: string
  attachments: AttachmentRef[]
  at: number
}): DraftRecord => ({
  chatId: input.chatId,
  tabId: input.tabId,
  text: input.text,
  attachments: input.attachments,
  updatedAt: input.at,
})

export interface ChatDraft {
  text: Atom<string>
  attachments: Atom<AttachmentRef[]>
  load: () => Promise<void>
  clear: () => void
}

export const reatomDraft = (
  chatId: ChatId | 'new',
  name: string,
): ChatDraft => {
  const loadState = atom<'idle' | 'loading' | 'done'>(
    'idle',
    `${name}.loadState`,
  )
  const touched = atom(false, `${name}.touched`)

  const save = action(async () => {
    await wrap(sleep(draftSaveDelayMs))
    const value = text()
    const files = attachments()
    if (value.length === 0 && files.length === 0) {
      await wrap(repo.deleteDraft(chatId, tabId))
      return
    }
    await wrap(
      repo.putDraft(
        createDraftRecord({
          chatId,
          tabId,
          text: value,
          attachments: files,
          at: now(),
        }),
      ),
    )
  }, `${name}.save`).extend(withAsync(), withAbort())

  const onEdit = () => {
    if (loadState() === 'loading') touched.set(true)
    save().catch(() => {})
  }

  const load = action(async () => {
    if (loadState() !== 'idle') return
    loadState.set('loading')
    try {
      const own = await wrap(repo.getDraft(chatId, tabId))
      const fallback =
        own ??
        (chatId === 'new' ? undefined : await wrap(repo.latestDraft(chatId)))
      if (
        fallback &&
        !touched() &&
        text() === '' &&
        attachments().length === 0
      ) {
        text.set(fallback.text)
        attachments.set(fallback.attachments)
      }
    } catch {
    } finally {
      loadState.set('done')
    }
  }, `${name}.load`).extend(withAsync())

  const text: Atom<string> = atom('', `${name}.text`).extend(
    withChangeHook(onEdit),
    withConnectHook(() => {
      load().catch(() => {})
    }),
  )
  const attachments: Atom<AttachmentRef[]> = atom<AttachmentRef[]>(
    [],
    `${name}.attachments`,
  ).extend(withChangeHook(onEdit))

  const clear = action(() => {
    text.set('')
    attachments.set([])
  }, `${name}.clear`)

  return { text, attachments, load, clear }
}
