import { action, withAsync, wrap } from '@reatom/core'

import { buildPath } from '../chat/tree'
import { copyText } from '../platform/clipboard'
import { now } from '../platform/env'
import { repo } from '../storage/repo'
import type {
  AttachmentBlob,
  ChatId,
  ChatRecord,
  PresetRecord,
} from '../storage/types'
import { downloadTextFile } from './download'
import { chatToMarkdown } from './markdown'
import { redactSecrets } from './redact'
import type { ExportBundle } from './types'

const dateStamp = (at: number) => {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const fileSlug = (title: string) => {
  const slug = redactSecrets(title)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'chat'
}

const liveChats = async () =>
  (await wrap(repo.listChats())).filter((chat) => chat.deletedAt === null)

const livePresets = async () =>
  (await wrap(repo.listPresets())).filter((preset) => preset.deletedAt === null)

const chatEntry = async (
  chat: ChatRecord,
): Promise<ExportBundle['chats'][number]> => {
  const messages = await wrap(repo.listMessages(chat.id))
  const attachmentIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const attachment of message.attachments)
      attachmentIds.add(attachment.id)
  }
  const attachments: AttachmentBlob[] = []
  for (const id of attachmentIds) {
    const blob = await wrap(repo.getAttachment(id))
    if (blob) attachments.push(blob)
  }
  return { chat, messages, attachments }
}

const bundleOf = (
  chats: ExportBundle['chats'],
  presets: PresetRecord[],
): ExportBundle => ({
  format: 'atelier-chats',
  version: 1,
  exportedAt: new Date(now()).toISOString(),
  chats,
  presets,
})

const bundleJson = (bundle: ExportBundle) =>
  redactSecrets(JSON.stringify(bundle, null, 2))

const markdownFor = async (chatId: ChatId): Promise<string | null> => {
  const chat = await wrap(repo.getChat(chatId))
  if (!chat || chat.deletedAt !== null) return null
  const messages = await wrap(repo.listMessages(chatId))
  const visiblePath = buildPath(messages, chat.selection).map(
    (node) => node.message,
  )
  return chatToMarkdown(chat, visiblePath)
}

export const exportAll = action(async (): Promise<number> => {
  const chats = await wrap(liveChats())
  const entries: ExportBundle['chats'] = []
  for (const chat of chats) entries.push(await wrap(chatEntry(chat)))
  const presets = await wrap(livePresets())
  downloadTextFile(
    `chats-${dateStamp(now())}.json`,
    bundleJson(bundleOf(entries, presets)),
    'application/json',
  )
  return chats.length
}, 'data.exportAll').extend(withAsync())

export const exportChatJson = action(async (chatId: ChatId): Promise<void> => {
  const chat = await wrap(repo.getChat(chatId))
  if (!chat || chat.deletedAt !== null) return
  const entry = await wrap(chatEntry(chat))
  const presets = await wrap(livePresets())
  downloadTextFile(
    `${fileSlug(chat.title)}.json`,
    bundleJson(bundleOf([entry], presets)),
    'application/json',
  )
}, 'data.exportChatJson').extend(withAsync())

export const exportChatMarkdown = action(
  async (chatId: ChatId): Promise<void> => {
    const markdown = await wrap(markdownFor(chatId))
    if (markdown === null) return
    const chat = await wrap(repo.getChat(chatId))
    downloadTextFile(
      `${fileSlug(chat?.title ?? 'chat')}.md`,
      markdown,
      'text/markdown',
    )
  },
  'data.exportChatMarkdown',
).extend(withAsync())

export const copyChatMarkdown = action(
  async (chatId: ChatId): Promise<boolean> => {
    const markdown = await wrap(markdownFor(chatId))
    if (markdown === null) return false
    return wrap(copyText(markdown))
  },
  'data.copyChatMarkdown',
).extend(withAsync())
