import { type ChatSettingsSection, ui } from '../../app/ui'
import { Dialog, type TabItem, Tabs } from '../../ui'
import type { ChatSlotProps } from '../slots'
import { AdvancedSection } from './chat/AdvancedSection'
import { PrivacySection } from './chat/PrivacySection'
import { PromptSection } from './chat/PromptSection'
import { RoutingSection } from './chat/RoutingSection'
import { reatomSectionDialog } from './sectionDialog'

const chatSettingsDialog = reatomSectionDialog(
  ui.chatSettings,
  'prompt',
  'features.settings.chatSettings',
)

export const ChatSettings = ({ chat }: ChatSlotProps) => {
  const sections: ReadonlyArray<TabItem<ChatSettingsSection>> = [
    {
      id: 'prompt',
      label: 'System prompt',
      panel: () => <PromptSection chat={chat} />,
    },
    {
      id: 'advanced',
      label: 'Advanced',
      panel: () => <AdvancedSection chat={chat} />,
    },
    {
      id: 'privacy',
      label: 'Privacy',
      panel: () => <PrivacySection chat={chat} />,
    },
    {
      id: 'routing',
      label: 'Routing',
      panel: () => <RoutingSection chat={chat} />,
    },
  ]

  return (
    <div data-slot="ChatSettings" css="display: contents;">
      <Dialog
        open={chatSettingsDialog.isOpen}
        onClose={chatSettingsDialog.close}
        title="Chat settings"
        size="lg"
      >
        <Tabs
          label="Chat settings sections"
          orientation="vertical"
          items={sections}
          selected={chatSettingsDialog.selected}
        />
      </Dialog>
    </div>
  )
}
