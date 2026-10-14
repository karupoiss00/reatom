import { ui } from '../../app/ui'
import { Button } from '../../ui'
import { KeyChip } from '../keychip/KeyChip'
import { ThemeSwitch } from '../layout/ThemeSwitch'
import type { ChatSlotProps } from '../slots'
import { ChatHeaderChips } from './ChatHeaderChips'
import { ChatMenu } from './ChatMenu'

export const ChatHeader = ({ chat }: ChatSlotProps) => (
  <header
    data-slot="ChatHeader"
    css={`
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      align-content: center;
      column-gap: var(--space-3);
      row-gap: var(--space-3);
      min-height: 3.5rem;
      padding: 0 var(--space-6);
      border-bottom: 1px solid var(--line);

      @media (min-width: 761px) {
        padding-inline-end: calc(var(--space-6) + var(--space-8));
      }
    `}
  >
    <h1
      css={`
        flex: 1;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        font-family: var(--font-display);
        font-size: var(--text-md);
        font-weight: 500;
        line-height: var(--leading-tight);
        text-overflow: ellipsis;
        white-space: nowrap;
      `}
    >
      {() => chat.record()?.title ?? 'New chat'}
    </h1>
    <div
      data-slot="ChatHeaderTools"
      css={`
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        gap: var(--space-3);
        min-width: 0;
        max-width: 100%;
        margin-inline-start: auto;

        @media (min-width: 761px) {
          flex-wrap: nowrap;
        }
      `}
    >
      <ChatHeaderChips chat={chat} />
      <KeyChip />
      <Button
        data-slot="AppSettingsOpen"
        aria-label="Settings"
        icon="settings"
        size="sm"
        on:click={() => ui.appSettings.set('mcp')}
      >
        Settings
      </Button>
      <ChatMenu />
      <ThemeSwitch />
    </div>
  </header>
)
