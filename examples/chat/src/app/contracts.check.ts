import type { OpenRouter } from '@openrouter/sdk'
import type { ChatRequest } from '@openrouter/sdk/models'
import type { Action, Atom, Computed } from '@reatom/core'

import type {
  KeyMeta,
  KeyStatus,
  OAuthOutcome,
  SessionMode,
  ValidateResult,
} from '../auth'
import * as api from '../api/openrouter'
import * as auth from '../auth'
import type {
  CatalogModel,
  CatalogStatus,
  PickerSections,
  ProviderInfo,
} from '../catalog'
import * as catalog from '../catalog'
import type {
  ChatModel,
  RequestOverrides,
  SendBlock,
  SendBlockContributor,
  SendInput,
  StreamEvent,
  StreamLifecycle,
  ThreadNode,
  WireMessage,
} from '../chat'
import * as chat from '../chat'
import * as data from '../data'
import type { NodeSlotProps } from '../features/slots'
import type { TabId } from '../platform'
import * as platform from '../platform'
import * as routes from '../routes'
import type {
  AssistantMessage,
  AttachmentBlob,
  ChatId,
  ChatRecord,
  ChatSettings,
  DbHealth,
  McpServerPref,
  MessageId,
  MessageRecord,
  PresetId,
  PrivacySettings,
  Repo,
  WriteFailure,
} from '../storage'
import * as storage from '../storage'
import * as prefs from '../storage/prefs'
import type { StreamLock, SyncBus, SyncEvent } from '../sync'
import * as sync from '../sync'
import * as app from '.'
import type { Timings } from './timings'
import type { AppSettingsSection, ChatSettingsSection } from './ui'

/**
 * Two-way check: the constraint pins export → contract with a precise error,
 * and the result is `false` when the contract does not fit the export, which
 * `Contract<...>` rejects.
 */
type Is<Actual extends Expected, Expected> = [Expected] extends [Actual]
  ? true
  : false
/**
 * One-way check for async-extended units (`withAsync`, `withAsyncData`): the
 * contract names the minimum callable/atom shape and implementers may add
 * extension members (`ready`, `data`, `abort`, …).
 */
type Has<Actual extends Expected, Expected> = Actual extends Expected
  ? true
  : false
type Contract<Checks extends readonly true[]> = Checks

export type PlatformContract = Contract<
  [
    Is<typeof platform.tabId, TabId>,
    Is<typeof platform.isOnline, Atom<boolean>>,
    Is<typeof platform.isVisible, Atom<boolean>>,
    Is<typeof platform.pageRestored, Action<[{ persisted: boolean }]>>,
    Is<typeof platform.prefersReducedMotion, Atom<boolean>>,
    Is<typeof platform.systemDark, Atom<boolean>>,
    Is<typeof platform.now, () => number>,
    Is<typeof platform.navigateExternal, (url: string) => void>,
    Is<
      typeof platform.setExternalNavigator,
      (fn: (url: string) => void) => void
    >,
    Is<typeof platform.openExternal, (url: string) => void>,
    Is<typeof platform.copyText, (text: string) => Promise<boolean>>,
    Is<
      typeof platform.downloadText,
      (filename: string, text: string, mime: string) => void
    >,
    Is<typeof platform.requestPersistOnce, () => Promise<boolean>>,
    Is<
      typeof platform.storageEstimate,
      () => Promise<{ usage: number } | null>
    >,
    Is<typeof platform.storagePersisted, () => Promise<boolean>>,
    Is<typeof platform.sha256Hex, (input: string) => Promise<string>>,
    Is<typeof platform.claimTabId, () => Promise<TabId>>,
    Is<typeof platform.onRuntimeReset, (cleanup: () => void) => void>,
    Is<typeof platform.resetRuntime, () => void>,
  ]
>

export type StorageContract = Contract<
  [
    Is<typeof storage.repo, Repo>,
    Is<typeof storage.dbHealth, Atom<DbHealth>>,
    Is<typeof storage.writeFailure, Atom<WriteFailure | null>>,
    Has<typeof storage.initStorage, Action<[], Promise<void>>>,
    Has<typeof storage.retryOpenStorage, Action<[], Promise<void>>>,
    Has<
      typeof storage.storageInfo,
      Computed<Promise<{ usageBytes: number | null; persisted: boolean }>>
    >,
    Has<typeof storage.requestPersistence, Action<[], Promise<boolean>>>,
    Is<typeof prefs.themePref, Atom<'light' | 'dark' | 'system'>>,
    Is<typeof prefs.sidebarCollapsed, Atom<boolean>>,
    Is<typeof prefs.sendKey, Atom<'enter' | 'mod-enter'>>,
    Is<typeof prefs.globalPrivacy, Atom<PrivacySettings>>,
    Is<typeof prefs.favoriteModels, Atom<string[]>>,
    Is<typeof prefs.recentModels, Atom<string[]>>,
    Is<typeof prefs.lastPickedModel, Atom<string | null>>,
    Is<typeof prefs.webSearchNoticeSeen, Atom<boolean>>,
    Is<typeof prefs.unlimitedAckHashes, Atom<string[]>>,
    Is<typeof prefs.persistDenied, Atom<boolean>>,
    Is<typeof prefs.mcpServers, Atom<McpServerPref[]>>,
    Is<typeof prefs.rewriteMcpLoopbackUrl, (url: string) => string>,
  ]
>

export type SyncContract = Contract<
  [
    Is<typeof sync.syncBus, SyncBus>,
    Is<typeof sync.syncReceived, Action<[SyncEvent]>>,
    Is<typeof sync.initSync, Action<[], void>>,
    Is<typeof sync.reloadFromStorage, Action<[]>>,
    Is<
      typeof sync.acquireStreamLock,
      (chatId: ChatId) => Promise<StreamLock | null>
    >,
    Is<typeof sync.streamHeldElsewhere, (chatId: ChatId) => Computed<boolean>>,
    Is<
      typeof sync.holdTombstone,
      (id: string, ms: number) => { release(): void }
    >,
    Is<typeof sync.isTombstoneHeld, (id: string) => Promise<boolean>>,
  ]
>

export type AuthContract = Contract<
  [
    Is<typeof auth.apiKey, Atom<string | null>>,
    Is<typeof auth.rememberKey, Atom<boolean>>,
    Is<typeof auth.keyStorageFailed, Atom<boolean>>,
    Has<
      typeof auth.connectWithKey,
      Action<
        [key: string, opts: { remember: boolean }],
        Promise<ValidateResult>
      >
    >,
    Is<typeof auth.forgetKey, Action<[], void>>,
    Has<
      typeof auth.startOAuth,
      Action<
        [
          opts: {
            limit: number | null
            remember: boolean
            returnTo: string | null
          },
        ],
        Promise<void>
      >
    >,
    Is<typeof auth.oauthOutcome, Atom<OAuthOutcome>>,
    Has<
      typeof auth.completeOAuthFromUrl,
      Action<[url: URL], Promise<OAuthOutcome>>
    >,
    Has<typeof auth.keyMeta, Computed<Promise<KeyMeta | null>>>,
    Is<typeof auth.refreshKeyMeta, Action<[opts?: { force?: boolean }], void>>,
    Is<typeof auth.keyStatus, Computed<KeyStatus>>,
    Is<typeof auth.revokedDuringStream, Atom<boolean>>,
    Is<typeof auth.unlimitedAckNeeded, Computed<boolean>>,
    Has<typeof auth.acknowledgeUnlimited, Action<[], Promise<void>>>,
    Is<typeof auth.sessionMode, Computed<SessionMode>>,
    Has<typeof auth.initAuth, Action<[], Promise<void>>>,
  ]
>

export type CatalogContract = Contract<
  [
    Is<typeof catalog.catalogModels, Atom<CatalogModel[]>>,
    Is<typeof catalog.catalogById, Computed<Map<string, CatalogModel>>>,
    Is<typeof catalog.catalogFetchedAt, Atom<number | null>>,
    Is<typeof catalog.catalogNewIds, Atom<string[]>>,
    Is<typeof catalog.catalogStatus, Computed<CatalogStatus>>,
    Has<typeof catalog.refreshCatalog, Action<[], Promise<void>>>,
    Is<typeof catalog.initCatalog, Action<[], void>>,
    Is<
      typeof catalog.curatedDefaults,
      readonly [
        'openrouter/auto',
        'openai/gpt-4o-mini',
        'anthropic/claude-sonnet-4.5',
        'google/gemini-2.5-flash',
      ]
    >,
    Is<
      typeof catalog.resolveNewChatModel,
      (opts: { presetModel: string | null }) => string | null
    >,
    Is<typeof catalog.modelName, (id: string) => string>,
    Is<typeof catalog.toggleFavorite, Action<[modelId: string], void>>,
    Is<typeof catalog.recordPick, Action<[modelId: string], void>>,
    Is<
      typeof catalog.reatomPicker,
      (name: string) => {
        query: Atom<string>
        chips: {
          free: Atom<boolean>
          reasoning: Atom<boolean>
          images: Atom<boolean>
          longContext: Atom<boolean>
        }
        sort: Atom<'match' | 'price' | 'context'>
        sections: Computed<PickerSections>
        allExpanded: Atom<boolean>
      }
    >,
    Has<typeof catalog.providers, Computed<Promise<ProviderInfo[]>>>,
  ]
>

export type ChatContract = Contract<
  [
    Is<
      typeof chat.buildPath,
      (
        messages: Iterable<MessageRecord>,
        selection: Record<string, MessageId>,
      ) => ThreadNode[]
    >,
    Is<
      typeof chat.assembleContext,
      (args: {
        path: MessageRecord[]
        systemPrompt: string
        requestModel: string
        endAtUserId?: MessageId
        attachment: (id: string) => AttachmentBlob | undefined
      }) => WireMessage[]
    >,
    Is<
      typeof chat.buildChatRequest,
      (args: {
        modelId: string
        model: CatalogModel | null
        messages: WireMessage[]
        settings: ChatSettings
        globalPrivacy: PrivacySettings
        overrides?: RequestOverrides
      }) => ChatRequest
    >,
    Is<typeof chat.chunkToEvents, (chunk: unknown) => StreamEvent[]>,
    Is<typeof chat.chatTitle, (firstUserText: string) => string>,
    Is<
      typeof chat.groupLabel,
      (activityAt: number, nowAt: number, timeZone: string) => string
    >,
    Is<typeof chat.getChatModel, (id: ChatId | 'new') => ChatModel>,
    Is<typeof chat.activeChat, Computed<ChatModel>>,
    Has<
      typeof chat.send,
      Action<[chatId: ChatId | 'new', input: SendInput], Promise<void>>
    >,
    Has<
      typeof chat.retry,
      Action<[chatId: ChatId, assistantId: MessageId], Promise<void>>
    >,
    Has<
      typeof chat.regenerate,
      Action<
        [chatId: ChatId, assistantId: MessageId, overrides?: RequestOverrides],
        Promise<void>
      >
    >,
    Has<
      typeof chat.editAndSend,
      Action<
        [chatId: ChatId, userId: MessageId, input: SendInput],
        Promise<void>
      >
    >,
    Is<typeof chat.stop, Action<[chatId: ChatId], void>>,
    Is<typeof chat.streamLifecycle, Action<[StreamLifecycle]>>,
    Is<typeof chat.generatingChats, Computed<Set<ChatId>>>,
    Has<typeof chat.recoverInterrupted, Action<[], Promise<void>>>,
    Has<
      typeof chat.continueReply,
      Action<[chatId: ChatId, assistantId: MessageId], Promise<void>>
    >,
    Has<
      typeof chat.compareSend,
      Action<
        [chatId: ChatId | 'new', input: SendInput, models: [string, string]],
        Promise<void>
      >
    >,
    Has<
      typeof chat.library,
      {
        status: Atom<'loading' | 'ready' | 'error'>
        chats: Computed<ChatRecord[]>
        hasChats: Computed<boolean>
        reload: Action<[], Promise<void>>
      }
    >,
    Is<
      typeof chat.chatGroups,
      Computed<Array<{ label: string; chats: ChatRecord[] }>>
    >,
    Is<typeof chat.newChat, Action<[], void>>,
    Is<typeof chat.renameChat, Action<[id: ChatId, title: string], void>>,
    Is<typeof chat.togglePin, Action<[id: ChatId], void>>,
    Is<typeof chat.deleteChats, Action<[ids: ChatId[]], void>>,
    Is<typeof chat.undoDelete, Action<[], void>>,
    Is<
      typeof chat.pendingUndo,
      Atom<{ ids: ChatId[]; expiresAt: number } | null>
    >,
    Is<
      typeof chat.deletedElsewhere,
      Atom<{ chatId: ChatId; expiresAt: number } | null>
    >,
    Is<typeof chat.sendBlockContributors, { register(contributor: SendBlockContributor): () => void; list(): readonly SendBlockContributor[] }>,
  ]
>

export type DataContract = Contract<
  [
    Has<typeof data.exportAll, Action<[], Promise<number>>>,
    Has<typeof data.exportChatJson, Action<[chatId: ChatId], Promise<void>>>,
    Has<
      typeof data.exportChatMarkdown,
      Action<[chatId: ChatId], Promise<void>>
    >,
    Has<
      typeof data.copyChatMarkdown,
      Action<[chatId: ChatId], Promise<boolean>>
    >,
    Has<
      typeof data.importFile,
      Action<
        [file: File],
        Promise<
          | { ok: true; count: number }
          | { ok: false; reason: 'invalid' | 'too-large' }
        >
      >
    >,
  ]
>

export type AppContract = Contract<
  [
    Is<
      AppSettingsSection,
      'account' | 'appearance' | 'data' | 'privacy' | 'keyboard' | 'mcp'
    >,
    Is<
      typeof app.ui,
      {
        appSettings: Atom<AppSettingsSection | null>
        chatSettings: Atom<ChatSettingsSection | null>
        picker: Atom<null | {
          purpose: 'chat' | 'regenerate' | 'compare'
          messageId?: MessageId
        }>
        search: Atom<boolean>
        shortcuts: Atom<boolean>
        drawer: Atom<boolean>
        editing: Atom<MessageId | null>
        openLayerCount: Computed<number>
      }
    >,
    Is<
      typeof app.extraEstimateLines,
      Atom<Array<{ key: string; label: string; amount: number | null }>>
    >,
    Is<
      Timings,
      {
        undoMs: number
        generationCapMs: number
        flushMs: number
        keyMetaThrottleMs: number
      }
    >,
    Is<typeof app.timings, Timings>,
    Is<typeof app.defaultTimings, Readonly<Timings>>,
    Is<typeof app.overrideTimings, (overrides?: Partial<Timings>) => void>,
    Is<
      typeof app.commands,
      {
        newChat: Action<[]>
        openPicker: Action<[]>
        openSearch: Action<[]>
        toggleSidebar: Action<[]>
        escape: Action<[]>
        editLastUserMessage: Action<[]>
        openShortcuts: Action<[]>
        openSettings: Action<[]>
      }
    >,
    Is<typeof routes.activeChatId, Computed<ChatId | 'new'>>,
    Is<typeof routes.openChat, Action<[chatId: ChatId], void>>,
  ]
>

export type ApiContract = Contract<
  [
    Is<typeof api.openRouter, () => OpenRouter>,
    Is<typeof api.openRouterPublic, () => OpenRouter>,
  ]
>

export type SharedTypeContract = Contract<
  [
    Is<ChatModel['settings'], Computed<ChatSettings>>,
    Is<ChatModel['presetId'], Atom<PresetId | null>>,
    Is<SendBlockContributor, (chat: ChatModel) => SendBlock | null>,
    Is<
      Extract<SyncEvent, { type: 'message-deleted' }>,
      { type: 'message-deleted'; chatId: ChatId; messageId: MessageId }
    >,
    Is<NodeSlotProps['node'], Computed<ThreadNode>>,
    Is<ChatSettings['mcpEnabled'], boolean | undefined>,
    Is<WireMessage['role'], 'system' | 'user' | 'assistant' | 'tool'>,
    Is<
      Extract<StreamEvent, { kind: 'tool_calls' }>,
      {
        kind: 'tool_calls'
        calls: Array<{
          id: string
          name: string
          arguments: string
        }>
      }
    >,
    Is<
      NonNullable<AssistantMessage['toolCalls']>[number],
      {
        id: string
        name: string
        arguments: string
        status: 'waiting' | 'calling' | 'completed' | 'denied' | 'error'
      }
    >,
  ]
>
