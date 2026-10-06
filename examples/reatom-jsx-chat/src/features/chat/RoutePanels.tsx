import { action, addCallHook, atom, computed, wrap } from '@reatom/core'

import { commands } from '../../app/commands'
import { activeChat } from '../../chat/chatModel'
import { chatPurged, pendingUndo, undoDelete } from '../../chat/library'
import { now } from '../../platform/env'
import { onRuntimeReset } from '../../platform/runtime'
import { activeChatId } from '../../routes'
import { Button, Icon, toast, type IconName } from '../../ui'
import { Thread } from '../thread/Thread'

export interface RoutePanelsProps {
  state: 'deleted' | 'unknown'
}

const deletedLinksKey = 'atelier.deletedLinks'
const deletedToastKey = 'chat-deleted'

const deletedLinkRevision = atom(0, 'features.chat.routePanels.deletedRevision')
const undoSeconds = atom(0, 'features.chat.routePanels.undoSeconds')

let undoTimer: ReturnType<typeof setInterval> | null = null

const stopUndoClock = () => {
  if (!undoTimer) return
  clearInterval(undoTimer)
  undoTimer = null
}

const bindClockReset = () => {
  onRuntimeReset(() => {
    stopUndoClock()
    bindClockReset()
  })
}

bindClockReset()

const readDeletedLinks = (): string[] => {
  try {
    const raw = sessionStorage.getItem(deletedLinksKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

const deletedLinks = computed(() => {
  deletedLinkRevision()
  return readDeletedLinks()
}, 'features.chat.routePanels.deletedLinks')

const rememberDeletedLink = action((id: string) => {
  const current = readDeletedLinks()
  if (current.includes(id)) return
  try {
    sessionStorage.setItem(deletedLinksKey, JSON.stringify([...current, id]))
  } catch {
    return
  }
  deletedLinkRevision.set((value) => value + 1)
}, 'features.chat.routePanels.rememberDeleted')

addCallHook(chatPurged, (id) => {
  rememberDeletedLink(id)
})

const undoWindowOpen = (id: string) => {
  const pending = pendingUndo()
  return Boolean(pending && pending.ids.includes(id) && pending.expiresAt > now())
}

const undoLabel = () => {
  const count = pendingUndo()?.ids.length ?? 1
  const phrase = count === 1 ? 'Chat deleted' : `${count} chats deleted`
  return `${phrase} · ${undoSeconds()}s left`
}

const showUndoCountdown = action((expiresAt: number) => {
  if (undoTimer) {
    clearInterval(undoTimer)
    undoTimer = null
  }
  const publish = () => {
    const left = Math.max(0, Math.ceil((expiresAt - now()) / 1000))
    undoSeconds.set(left)
    if (left === 0) stopUndoClock()
  }
  publish()
  toast.show({
    key: deletedToastKey,
    text: undoLabel,
    durationMs: Math.max(0, expiresAt - now()),
    action: {
      label: 'Undo',
      onClick: () => undoDelete(),
    },
  })
  undoTimer = setInterval(wrap(publish), 250)
}, 'features.chat.routePanels.showUndoCountdown')

const panelCopy: Record<
  'deleted' | 'unknown',
  { title: string; detail: string; icon: IconName }
> = {
  deleted: {
    title: 'This chat was deleted.',
    detail: 'It is gone from this browser. This address stays put.',
    icon: 'trash',
  },
  unknown: {
    title: 'No chat with this link.',
    detail: 'Nothing on this device matches this address.',
    icon: 'search',
  },
}

const DeadLink = ({ state }: { state: 'deleted' | 'unknown' }) => {
  const copy = panelCopy[state]
  return (
    <div role="status" css="display: grid; justify-items: center; gap: var(--space-3); max-width: 24rem;">
      <span
        aria-hidden="true"
        css={`
          display: grid;
          place-items: center;
          width: 2.75rem;
          height: 2.75rem;
          border-radius: var(--radius-pill);
          background: var(--accent-soft);
          color: var(--accent-text);
        `}
      >
        <Icon name={copy.icon} size="1.25rem" />
      </span>
      <h2
        css={`
          margin: 0;
          font-family: var(--font-display);
          font-size: var(--text-xl);
          font-weight: 500;
          line-height: var(--leading-tight);
          letter-spacing: -0.03em;
        `}
      >
        {copy.title}
      </h2>
      <p
        css={`
          margin: 0;
          color: var(--text-muted);
          font-size: var(--text-sm);
          line-height: var(--leading-body);
        `}
      >
        {copy.detail}
      </p>
      <Button variant="primary" icon="plus" on:click={() => commands.newChat()}>
        New chat
      </Button>
    </div>
  )
}

const panelStyles = `
  &[data-state='restoring'] {
    display: contents;
  }

  &[data-state='deleted'],
  &[data-state='unknown'] {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    min-height: 0;
    padding: var(--space-8) var(--space-6);
    text-align: center;
  }
`

export const RoutePanels = ({ state }: RoutePanelsProps) => {
  const kind = computed((): 'restoring' | 'deleted' | 'unknown' => {
    const id = activeChatId()
    const remembered = id !== 'new' && deletedLinks().includes(id)
    if (state === 'deleted' && id !== 'new' && undoWindowOpen(id)) return 'restoring'
    if (state === 'deleted' || remembered) return 'deleted'
    return 'unknown'
  }, 'features.chat.routePanels.kind')

  return (
    <div
      data-slot="RoutePanels"
      data-state={kind}
      ref={() => {
        const id = activeChatId()
        if (state === 'deleted' && id !== 'new') {
          rememberDeletedLink(id)
          const pending = pendingUndo()
          if (pending && pending.ids.includes(id) && pending.expiresAt > now()) {
            showUndoCountdown(pending.expiresAt)
          }
        }
        return () => stopUndoClock()
      }}
      css={panelStyles}
    >
      {() =>
        kind() === 'restoring' ? (
          <Thread chat={activeChat()} />
        ) : (
          <DeadLink state={kind() === 'deleted' ? 'deleted' : 'unknown'} />
        )
      }
    </div>
  )
}
