import type { TabId } from '../platform/types'
import type {
  ChatId,
  ChatRecord,
  MessageId,
  MessageRecord,
  PresetId,
  PresetRecord,
} from '../storage/types'

export type SyncEvent =
  | { type: 'chat'; chat: ChatRecord } // receivers merge per-field LWW
  | { type: 'message'; message: MessageRecord } // receivers merge by id/rev; sent after each flush
  | { type: 'message-deleted'; chatId: ChatId; messageId: MessageId }
  | { type: 'chat-purged'; chatId: ChatId }
  | { type: 'preset'; preset: PresetRecord }
  | { type: 'preset-purged'; presetId: PresetId }
  | { type: 'stream'; chatId: ChatId; tabId: TabId; active: boolean }
  | { type: 'all-deleted' }
export interface SyncBus {
  readonly supported: boolean
  publish(event: SyncEvent): void
}
export interface StreamLock {
  release(): Promise<void>
}
