import { commands } from '../../app/commands'
import { sidebarCollapsed } from '../../storage/prefs'
import { IconButton } from '../../ui'
import type { LayoutSlotProps } from '../slots'
import { Drawer } from './Drawer'
import { compactLayout } from './media'
import { syncThemeToDocument } from './theme'

const isMacLike = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const toggleShortcutHint = () => (isMacLike() ? '⌘⇧S' : 'Ctrl+Shift+S')

const trackVisualViewport = (shell: HTMLElement) => {
  const viewport = window.visualViewport
  if (!viewport) return () => {}
  let lastViewportHeight = viewport.height
  const update = () => {
    const nextHeight = viewport.height
    const shrunk = nextHeight < lastViewportHeight - 1
    lastViewportHeight = nextHeight
    shell.style.setProperty('--shell-height', `${nextHeight}px`)
    shell.style.setProperty('--shell-top', `${viewport.offsetTop}px`)
    if (!shrunk) return
    shell.querySelectorAll<HTMLElement>('[data-slot="Thread"]').forEach((thread) => {
      thread.scrollTop = thread.scrollHeight
    })
  }
  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
  }
}

const sidebarState = () => (sidebarCollapsed() ? 'collapsed' : 'expanded')

const SidebarRail = () => (
  <nav
    data-testid="sidebar-rail"
    aria-label="Sidebar shortcuts"
    prop:inert={() => !sidebarCollapsed()}
    data-state={sidebarState}
    css={`
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--rail-width);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-3) 0;
      opacity: 0;
      transition: opacity var(--duration-fast) var(--ease-standard);

      &[data-state='collapsed'] {
        opacity: 1;
        transition-delay: var(--duration-fast);
      }
    `}
  >
    <IconButton
      icon="sidebar"
      label="Show sidebar"
      title={`Show sidebar (${toggleShortcutHint()})`}
      on:click={() => commands.toggleSidebar()}
    />
    <IconButton
      icon="compose"
      label="New chat"
      title="New chat"
      on:click={() => commands.newChat()}
    />
    <IconButton
      icon="search"
      label="Search chats"
      title="Search chats"
      on:click={() => commands.openSearch()}
    />
  </nav>
)

export const Shell = ({ sidebar, main }: LayoutSlotProps) => (
  <div
    data-slot="Shell"
    data-testid="shell"
    data-sidebar={sidebarState}
    ref={(shell: HTMLDivElement) => {
      const stopTheme = syncThemeToDocument()
      const stopViewport = trackVisualViewport(shell)
      return () => {
        stopTheme()
        stopViewport()
      }
    }}
    css={`
      --rail-width: 3.5rem;
      --sidebar-column: var(--sidebar-width);
      position: fixed;
      inset-inline: 0;
      top: var(--shell-top, 0px);
      height: var(--shell-height, 100dvh);
      display: grid;
      grid-template-columns: var(--sidebar-column) minmax(0, 1fr);
      padding: env(safe-area-inset-top) env(safe-area-inset-right) 0
        env(safe-area-inset-left);
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      transition: grid-template-columns var(--duration-base) var(--ease-standard);

      &[data-sidebar='collapsed'] {
        --sidebar-column: var(--rail-width);
      }

      @media (max-width: 760px) {
        grid-template-columns: minmax(0, 1fr);

        & > [data-shell-nav] {
          display: none;
        }

        & [data-slot='ChatHeader'] {
          padding-inline-start: calc(var(--hit) + var(--space-2));
        }
      }
    `}
  >
    <div
      data-shell-nav=""
      css={`
        position: relative;
        min-width: 0;
        overflow: hidden;
        background: var(--sidebar);
        border-right: 1px solid var(--line);
      `}
    >
      <aside
        data-testid="sidebar-inline"
        aria-label="Chats"
        prop:inert={() => sidebarCollapsed()}
        data-state={sidebarState}
        css={`
          position: absolute;
          inset: 0 auto 0 0;
          width: var(--sidebar-width);
          display: flex;
          flex-direction: column;
          min-height: 0;
          padding-bottom: env(safe-area-inset-bottom);
          overflow: auto;
          transition:
            opacity var(--duration-fast) var(--ease-standard) var(--duration-instant),
            transform var(--duration-base) var(--ease-standard);

          &[data-state='collapsed'] {
            opacity: 0;
            transform: translateX(-0.75rem);
            transition:
              opacity var(--duration-fast) var(--ease-standard),
              transform var(--duration-base) var(--ease-standard);
          }

          & > [data-sidebar-toggle] {
            position: absolute;
            top: var(--space-3);
            right: var(--space-2);
          }
        `}
      >
        {() => (compactLayout() ? null : sidebar())}
        <span data-sidebar-toggle="">
          <IconButton
            icon="sidebar"
            label="Hide sidebar"
            title={`Hide sidebar (${toggleShortcutHint()})`}
            on:click={() => commands.toggleSidebar()}
          />
        </span>
      </aside>
      <SidebarRail />
    </div>
    <main
      css={`
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: var(--thread);
        color: var(--text);
      `}
    >
      {main()}
    </main>
    <Drawer sidebar={sidebar} main={main} />
  </div>
)
