import { urlAtom } from '@reatom/core'

import { focusVisible, interactive } from '../design-system/mixins'
import { size, tokens, type } from '../design-system/tokens'

export type WorkspaceId = 'activity' | 'state' | 'timeline' | 'graph' | 'filters'

const WORKSPACES: Array<{ id: WorkspaceId; path: string; label: string }> = [
  { id: 'activity', path: '/', label: 'Activity' },
  { id: 'state', path: '/state', label: 'State' },
  { id: 'timeline', path: '/timeline', label: 'Timeline' },
  { id: 'graph', path: '/graph', label: 'Graph' },
  { id: 'filters', path: '/filters', label: 'Filters' },
]

function workspaceFromPath(pathname: string): WorkspaceId {
  if (pathname === '/state') return 'state'
  if (pathname === '/timeline') return 'timeline'
  if (pathname === '/graph') return 'graph'
  if (pathname === '/filters') return 'filters'
  return 'activity'
}

export const WorkspaceTabs = () => {
  const currentId = () => workspaceFromPath(urlAtom().pathname)
  const selectByOffset = (offset: number): number => {
    const currentIndex = WORKSPACES.findIndex(
      (workspace) => workspace.id === currentId(),
    )
    const nextIndex =
      (currentIndex + offset + WORKSPACES.length) % WORKSPACES.length
    const next = WORKSPACES[nextIndex]
    if (next) urlAtom.go(next.path)
    return nextIndex
  }

  const focusTab = (target: EventTarget | null, index: number) => {
    if (!(target instanceof HTMLElement)) return
    const tab = target.children.item(index)
    if (tab instanceof HTMLElement) tab.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Admin workspaces"
      css={`
        display: flex;
        align-items: stretch;
        min-height: ${size.tabs};
        height: ${size.tabs};
        gap: var(--admin-space-2);
        border-bottom: 1px solid ${tokens.border1};
        background: ${tokens.surface1};
      `}
      on:keydown={(event: KeyboardEvent) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          focusTab(event.currentTarget, selectByOffset(1))
          return
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          focusTab(event.currentTarget, selectByOffset(-1))
        }
      }}
    >
      {WORKSPACES.map((workspace) => (
        <button
          type="button"
          role="tab"
          aria-label={workspace.label}
          aria-current={() =>
            currentId() === workspace.id ? 'page' : undefined
          }
          aria-selected={() => currentId() === workspace.id}
          tabindex={() => (currentId() === workspace.id ? 0 : -1)}
          css={`
            ${type.ui}
            ${interactive}
            ${focusVisible}
            appearance: none;
            border: 0;
            background: transparent;
            color: ${tokens.text2};
            padding-inline: var(--admin-space-12);
            &[aria-selected='true'] {
              color: ${tokens.text1};
              box-shadow: inset 0 -2px 0 ${tokens.accent};
            }
          `}
          on:click={() => urlAtom.go(workspace.path)}
        >
          {workspace.label}
        </button>
      ))}
    </div>
  )
}
