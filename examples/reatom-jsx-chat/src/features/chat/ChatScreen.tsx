import { atom, computed, withConnectHook } from '@reatom/core'

import { sessionMode } from '../../auth/session'
import { writeFailure } from '../../storage'
import { toast } from '../../ui'
import { Composer } from '../composer/Composer'
import { KeyBanner } from '../keychip/KeyBanner'
import type { ChatSlotProps } from '../slots'
import { OfflineBanner } from '../system/OfflineBanner'
import { StorageBanner } from '../system/StorageBanner'
import { Thread } from '../thread/Thread'
import { ConnectBar } from '../welcome/ConnectBar'
import { PasteKey } from '../welcome/PasteKey'
import { ChatHeader } from './ChatHeader'
import { RemoteBanners } from './RemoteBanners'
import { RoutePanels } from './RoutePanels'

const storageFullNotice = atom(null, 'features.chat.storageFullNotice').extend(
  withConnectHook(() =>
    writeFailure.subscribe((failure) => {
      if (!failure) return
      toast.show({
        key: 'storage-full',
        text: 'Browser storage is full. Export and delete old chats.',
        tone: 'warning',
        durationMs: null,
      })
    }),
  ),
)

const composableLoadStates = new Set(['ready', 'loading', 'error'])

export const ChatScreen = ({ chat }: ChatSlotProps) => {
  const canCompose = computed(
    () => composableLoadStates.has(chat.loadState()),
    `features.chat#${chat.id}.canCompose`,
  )
  const view = computed(() => {
    const loadState = chat.loadState()
    return loadState === 'deleted' || loadState === 'missing'
      ? loadState
      : 'thread'
  }, `features.chat#${chat.id}.view`)

  return (
    <section
      data-slot="ChatScreen"
      aria-label="Chat"
      css={`
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
      `}
    >
      <ChatHeader chat={chat} />
      <KeyBanner />
      <RemoteBanners chat={chat} />
      <OfflineBanner />
      <StorageBanner />
      <div
        data-empty={() =>
          view() === 'thread' && chat.path().length === 0 ? 'true' : null
        }
        css={`
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;

          &[data-empty='true'] {
            justify-content: center;
          }

          & > [data-slot='Composer'] {
            flex: none;
          }
        `}
      >
        {() => {
          const current = view()
          if (current === 'deleted') return <RoutePanels state="deleted" />
          if (current === 'missing') return <RoutePanels state="unknown" />
          return <Thread chat={chat} />
        }}
        {() => {
          if (!canCompose()) return null
          return sessionMode() === 'archive' ? (
            <ConnectBar />
          ) : (
            <Composer chat={chat} />
          )
        }}
      </div>
      {() =>
        canCompose() && sessionMode() !== 'archive' ? <PasteKey /> : null
      }
      {() => {
        storageFullNotice()
        return null
      }}
    </section>
  )
}
