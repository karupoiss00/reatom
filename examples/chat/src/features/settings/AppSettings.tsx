import { type AppSettingsSection, ui } from '../../app/ui'
import { Dialog, type TabItem, Tabs } from '../../ui'
import { AccountSection } from './app/AccountSection'
import { AppearanceSection } from './app/AppearanceSection'
import { DataSection } from './app/DataSection'
import { KeyboardSection } from './app/KeyboardSection'
import { McpSection } from './app/McpSection'
import { PrivacySection } from './app/PrivacySection'
import { reatomSectionDialog } from './sectionDialog'

const appSettingsSections: ReadonlyArray<TabItem<AppSettingsSection>> = [
  { id: 'account', label: 'Account & usage', panel: () => <AccountSection /> },
  { id: 'appearance', label: 'Appearance', panel: () => <AppearanceSection /> },
  { id: 'data', label: 'Data', panel: () => <DataSection /> },
  { id: 'privacy', label: 'Privacy', panel: () => <PrivacySection /> },
  { id: 'keyboard', label: 'Keyboard', panel: () => <KeyboardSection /> },
  { id: 'mcp', label: 'MCP', panel: () => <McpSection /> },
]

const appSettingsDialog = reatomSectionDialog(
  ui.appSettings,
  'account',
  'features.settings.appSettings',
)

export const AppSettings = () => (
  <div data-slot="AppSettings" css="display: contents;">
    <Dialog
      open={appSettingsDialog.isOpen}
      onClose={appSettingsDialog.close}
      title="Settings"
      size="lg"
    >
      <Tabs
        label="Settings sections"
        orientation="vertical"
        items={appSettingsSections}
        selected={appSettingsDialog.selected}
      />
    </Dialog>
  </div>
)
