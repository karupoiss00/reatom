import type { MockChatScript } from '../openrouter-mock'

export const harnessTag = 'atelier-tab-harness'

export type TabCommand =
  | {
      type: 'boot'
      key?: string
      remember?: boolean
      keyMeta?: object
      models?: readonly object[]
    }
  | { type: 'mock-streams'; scripts: readonly MockChatScript[] }
  | { type: 'open'; chatId: string }
  | { type: 'send'; chatId: string; text: string }
  | { type: 'stop'; chatId: string }
  | { type: 'rename'; chatId: string; title: string }
  | { type: 'delete'; chatIds: string[] }
  | { type: 'read'; selector: string }
  | { type: 'state' }
  | { type: 'acquire-lock'; chatId: string }
  | { type: 'release-lock'; chatId: string }
  | { type: 'held-elsewhere'; chatId: string }

export interface TabState {
  tabId: string
  path: string
  sessionMode: string
  chats: Array<{ id: string; title: string; deletedAt: number | null }>
  chatRequests: number
  /** Types of every sync event this tab received, oldest first. */
  received: string[]
}

export interface TabResults {
  boot: { tabId: string }
  'mock-streams': null
  open: null
  send: null
  stop: null
  rename: null
  delete: null
  read: string | null
  state: TabState
  'acquire-lock': boolean
  'release-lock': null
  'held-elsewhere': boolean
}

export type TabRequest = {
  tag: typeof harnessTag
  id: number
  command: TabCommand
}

export type TabMessage =
  | { tag: typeof harnessTag; type: 'ready' }
  | { tag: typeof harnessTag; type: 'reply'; id: number; ok: true; value: unknown }
  | { tag: typeof harnessTag; type: 'reply'; id: number; ok: false; error: string }
