import { sessionMode } from '../../auth/session'
import { commands } from '../../app/commands'
import { generatingChats } from '../../chat/engine'
import { chatGroups, deleteChats, library, togglePin } from '../../chat/library'
import { exportChatJson, exportChatMarkdown } from '../../data'
import { copyVisibleMarkdown } from '../data/model'
import { activeChatId, openChat } from '../../routes'
import type { ChatId } from '../../storage/types'
import { Button, Icon, IconButton, Menu, Skeleton, Spinner } from '../../ui'
import type { MenuItem } from '../../ui'
import { focusRing, resetButton, transition } from '../../ui/mixins'
import {
  cancelRename,
  commitRename,
  renameDraft,
  renamingId,
  startRename,
  undoToastConnection,
} from './model'

const skeletonWidths = ['92%', '78%', '84%', '64%', '88%', '70%']

const sidebarStyles = `
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  padding: var(--space-3) var(--space-3) var(--space-4);
  overflow: hidden;
`

const headerStyles = `
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: none;
  min-height: var(--hit);
  padding-inline-end: calc(var(--hit) + var(--space-2));
`

const brandStyles = `
  font-family: var(--font-display);
  font-size: var(--text-lg);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
`

const sectionLabelStyles = `
  margin: 0;
  padding-inline: var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-faint);
`

const libraryStyles = `
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-bottom: var(--space-2);
`

const groupStyles = `
  display: flex;
  flex-direction: column;
  gap: var(--space-1);

  & h2 {
    margin: var(--space-3) 0 0;
    padding-inline: var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    letter-spacing: 0.01em;
    line-height: var(--leading-snug);
    color: var(--text-faint);
  }

  & ul {
    display: grid;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
`

const rowStyles = `
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: var(--hit);
  padding-inline: var(--space-1) 0;
  border-radius: var(--radius-sm);
  ${transition('background-color, box-shadow')}

  &:hover {
    background: var(--surface-hover);
  }

  &[data-current='true'] {
    background: var(--surface-selected);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  &[data-current='true']:hover {
    background: var(--accent-soft-hover);
  }
`

const titleButtonStyles = `
  ${resetButton}
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: var(--hit);
  padding-inline: var(--space-2);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-align: start;
  cursor: pointer;

  & span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:focus-visible {
    ${focusRing}
    border-radius: var(--radius-sm);
  }
`

const titleInputStyles = `
  width: 100%;
  min-width: 0;
  min-height: 2rem;
  margin-inline: var(--space-1);
  padding: 0 var(--space-2);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: var(--focus-ring);
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

const quietStyles = `
  margin: var(--space-2) 0 0;
  padding-inline: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

const errorStyles = `
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  margin-top: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--danger-line);
  border-radius: var(--radius-md);
  background: var(--danger-soft);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

const focusTitle = (input: HTMLInputElement) => {
  if (!input.isConnected) return
  input.focus()
  input.select()
}

const ChatTitleField = () => (
  <input
    attr:aria-label="Chat title"
    model:value={renameDraft}
    autocomplete="off"
    spellcheck={false}
    on:keydown={(event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return
      event.preventDefault()
      if (event.key === 'Enter') commitRename()
      else cancelRename()
    }}
    ref={(input: HTMLInputElement) => {
      focusTitle(input)
      const frame = requestAnimationFrame(() => focusTitle(input))
      return () => cancelAnimationFrame(frame)
    }}
    css={titleInputStyles}
  />
)

const listedChat = (id: ChatId) =>
  id !== 'new' && library.chats().some((chat) => chat.id === id)

const runListedExport = (
  id: ChatId,
  run: (chatId: ChatId) => Promise<unknown>,
) => {
  if (!listedChat(id)) return
  void run(id).catch(() => {})
}

const chatActions = (id: ChatId): MenuItem[] => {
  const pinned = library.chats().find((chat) => chat.id === id)?.pinnedAt != null
  return [
    {
      label: 'Rename',
      icon: 'edit',
      onSelect: () => {
        const title = library.chats().find((chat) => chat.id === id)?.title
        if (title !== undefined) startRename(id, title)
      },
    },
    {
      label: pinned ? 'Unpin' : 'Pin',
      icon: 'pin',
      onSelect: () => togglePin(id),
    },
    {
      label: 'Export',
      icon: 'download',
      onSelect: () => {
        exportChatJson(id).catch(() => {})
      },
    },
    {
      label: 'Export Markdown',
      icon: 'file',
      onSelect: () => {
        runListedExport(id, exportChatMarkdown)
      },
    },
    {
      label: 'Copy as Markdown',
      icon: 'copy',
      onSelect: () => {
        runListedExport(id, copyVisibleMarkdown)
      },
    },
    { separator: true },
    {
      label: 'Delete',
      icon: 'trash',
      tone: 'danger',
      onSelect: () => deleteChats([id]),
    },
  ]
}

const ChatRow = ({ id }: { id: ChatId }) => (
  <li
    attr:aria-label={() =>
      library.chats().find((chat) => chat.id === id)?.title ?? 'Chat'
    }
  >
    {() => {
      const chat = library.chats().find((item) => item.id === id)
      if (!chat) return null
      const current = activeChatId() === id
      const renaming = renamingId() === id
      const generating = generatingChats().has(id)
      return (
        <div data-current={current ? 'true' : null} css={rowStyles}>
          {renaming ? (
            <ChatTitleField />
          ) : (
            <button
              type="button"
              attr:aria-current={current ? 'page' : null}
              on:click={() => openChat(id)}
              on:dblclick={(event: MouseEvent) => {
                event.preventDefault()
                startRename(id, chat.title)
              }}
              css={titleButtonStyles}
            >
              {chat.pinnedAt !== null ? (
                <Icon name="pin" size="0.875rem" />
              ) : null}
              <span dir="auto">{chat.title}</span>
            </button>
          )}
          <span
            css={`
              display: flex;
              align-items: center;
              color: var(--accent);
            `}
          >
            {generating ? <Spinner label="Generating" size="0.875rem" /> : null}
            <Menu
              label={`Actions for ${chat.title}`}
              items={() => chatActions(id)}
              placement="bottom-end"
              trigger={(props) => (
                <IconButton {...props} icon="more" label="⋯" size="sm" />
              )}
            />
          </span>
        </div>
      )
    }}
  </li>
)

const SkeletonList = () => (
  <div
    attr:role="status"
    attr:aria-label="Loading chats"
    attr:aria-busy="true"
    css={`
      display: grid;
      gap: var(--space-2);
      padding-inline: var(--space-1);
    `}
  >
    {skeletonWidths.map((width) => (
      <Skeleton width={width} height="2.25rem" radius="var(--radius-sm)" />
    ))}
  </div>
)

const EmptyLibrary = () => (
  <div css={quietStyles}>
    <p
      css={`
        margin: 0;
        color: var(--text);
        font-family: var(--font-display);
        font-size: var(--text-md);
        letter-spacing: -0.02em;
      `}
    >
      No chats yet
    </p>
    <p
      css={`
        margin: var(--space-1) 0 0;
        color: var(--text-muted);
        font-size: var(--text-sm);
      `}
    >
      Send a message and it will be kept on this device.
    </p>
  </div>
)

const OpenError = () => (
  <div css={errorStyles}>
    <p css="margin: 0;">Couldn't open saved chats.</p>
    <Button
      size="sm"
      variant="secondary"
      on:click={() => {
        library.reload().catch(() => {})
      }}
    >
      Retry
    </Button>
  </div>
)

const LibraryBody = () => (
  <div css={libraryStyles}>
    {() => {
      undoToastConnection()
      const status = library.status()
      if (status === 'loading') return <SkeletonList />
      if (status === 'error') return <OpenError />
      const groups = chatGroups()
      if (groups.length === 0) return <EmptyLibrary />
      return groups.map((group) => (
        <section attr:aria-label={group.label} css={groupStyles}>
          <h2>{group.label}</h2>
          <ul>
            {group.chats.map((chat) => (
              <ChatRow id={chat.id} />
            ))}
          </ul>
        </section>
      ))
    }}
  </div>
)

export const Sidebar = () => (
  <div data-slot="Sidebar" css={sidebarStyles}>
    <div css={headerStyles}>
      <span
        aria-hidden="true"
        css={`
          width: 0.7rem;
          height: 0.7rem;
          border-radius: var(--radius-pill);
          background: var(--accent);
          box-shadow: 0 0 0 4px var(--accent-soft);
        `}
      />
      <span css={brandStyles}>Atelier</span>
    </div>
    <Button
      fullWidth
      icon="plus"
      variant="secondary"
      on:click={() => commands.newChat()}
    >
      New chat
    </Button>
    {() =>
      sessionMode() === 'archive' ? (
        <p
          css={`
            margin: 0;
            padding-inline: var(--space-2);
            color: var(--text-muted);
            font-size: var(--text-xs);
            line-height: var(--leading-snug);
          `}
        >
          Read-only
        </p>
      ) : null
    }
    <p css={sectionLabelStyles}>Conversations</p>
    <LibraryBody />
  </div>
)
