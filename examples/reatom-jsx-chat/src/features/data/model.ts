import { action, atom, withAsync, wrap } from '@reatom/core'

import { library } from '../../chat/library'
import {
  copyChatMarkdown,
  exportAll,
  importErrorCopy,
  importFile,
} from '../../data'
import { onRuntimeReset } from '../../platform/runtime'
import { loadPresets } from '../../presets/presets'
import { activeChatId, homeRoute } from '../../routes'
import { repo } from '../../storage/repo'
import type { ChatId } from '../../storage/types'
import { announce, toast } from '../../ui'

export const localChatsSentence =
  'Chats live only in this browser. Export to keep a copy.'

export const privateModeSentence =
  "This browser won't keep chats after you close the tab."

export const persistDeniedSentence =
  "The browser didn't allow permanent storage. Export a copy."

export const copyFailedSentence = "Couldn't copy. Select the text instead."

const chatCountLabel = (count: number) =>
  `${count} ${count === 1 ? 'chat' : 'chats'}`

export type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'success'; count: number }
  | { kind: 'error'; reason: 'invalid' | 'too-large' }

export const importStatus = atom<ImportStatus>(
  { kind: 'idle' },
  'features.data.importStatus',
)

export const copyPhase = atom<'idle' | 'copied' | 'failed'>(
  'idle',
  'features.data.copyPhase',
)

export const deletePhrase = atom('', 'features.data.deletePhrase')

let copyTimer: ReturnType<typeof setTimeout> | null = null

const clearCopyTimer = () => {
  if (copyTimer === null) return
  clearTimeout(copyTimer)
  copyTimer = null
}

const bindCopyReset = () => {
  onRuntimeReset(() => {
    clearCopyTimer()
    bindCopyReset()
  })
}

bindCopyReset()

const showCopied = () => {
  copyPhase.set('copied')
  announce('Copied')
  clearCopyTimer()
  copyTimer = setTimeout(
    wrap(() => {
      copyPhase.set('idle')
      copyTimer = null
    }),
    2_000,
  )
}

const showCopyFailed = () => {
  copyPhase.set('failed')
  toast.show({
    key: 'copy-markdown',
    text: copyFailedSentence,
    tone: 'warning',
    durationMs: 5_000,
  })
  announce(copyFailedSentence)
  clearCopyTimer()
  copyTimer = setTimeout(
    wrap(() => {
      copyPhase.set('idle')
      copyTimer = null
    }),
    2_000,
  )
}

export const formatStorageUsage = (usageBytes: number | null | undefined) => {
  if (
    usageBytes === null ||
    usageBytes === undefined ||
    !Number.isFinite(usageBytes)
  ) {
    return 'Storage size unavailable'
  }
  const megabytes = Math.round((usageBytes / (1024 * 1024)) * 10) / 10
  return `${megabytes.toFixed(1)} MB in this browser`
}

export const exportEveryChat = action(async () => {
  const count = await wrap(exportAll())
  const text = `Exported ${chatCountLabel(count)}.`
  toast.show({ key: 'export-chats', text, tone: 'success' })
  announce(text)
  return count
}, 'features.data.exportEveryChat').extend(withAsync())

export const copyVisibleMarkdown = action(async (chatId: ChatId) => {
  const copied = await wrap(copyChatMarkdown(chatId))
  if (copied) {
    showCopied()
    return true
  }
  showCopyFailed()
  return false
}, 'features.data.copyVisibleMarkdown').extend(withAsync())

export const pickImport = action(async (file: File | null) => {
  if (!file) return
  importStatus.set({ kind: 'importing' })
  try {
    const result = await wrap(importFile(file))
    if (result.ok) {
      importStatus.set({ kind: 'success', count: result.count })
      const text = `Imported ${chatCountLabel(result.count)}`
      toast.show({ key: 'import-chats', text, tone: 'success' })
      announce(text)
      return
    }
    importStatus.set({ kind: 'error', reason: result.reason })
    announce(importErrorCopy[result.reason])
  } catch {
    importStatus.set({ kind: 'error', reason: 'invalid' })
    announce(importErrorCopy.invalid)
  }
}, 'features.data.pickImport').extend(withAsync())

export const deleteAllChats = action(async () => {
  if (deletePhrase() !== 'DELETE') return
  await wrap(repo.deleteAllChatsAndPresets())
  await wrap(library.reload())
  await wrap(loadPresets())
  deletePhrase.set('')
  importStatus.set({ kind: 'idle' })
  if (activeChatId() !== 'new') homeRoute.go()
}, 'features.data.deleteAllChats').extend(withAsync())

export const importStatusText = (status: ImportStatus) => {
  if (status.kind === 'importing') return 'Importing…'
  if (status.kind === 'success') return `Imported ${chatCountLabel(status.count)}`
  if (status.kind === 'error') return importErrorCopy[status.reason]
  return ''
}
