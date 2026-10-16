import type {
  AttachmentBlob,
  ChatRecord,
  MessageRecord,
  PresetRecord,
} from '../storage/types'

export interface ExportBundle {
  format: 'atelier-chats'
  version: 1
  exportedAt: string
  chats: Array<{
    chat: ChatRecord
    messages: MessageRecord[]
    attachments: AttachmentBlob[]
  }>
  presets: PresetRecord[]
}
export type ImportResult =
  { ok: true; count: number } | { ok: false; reason: 'invalid' | 'too-large' }
