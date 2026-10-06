import { computed } from '@reatom/core'

import { oauthOutcome } from './auth/oauth'
import { sessionMode } from './auth/session'
import { activeChat } from './chat/chatModel'
import { ChatScreen } from './features/chat/ChatScreen'
import { UnlimitedKeyDialog } from './features/keychip/UnlimitedKeyDialog'
import { Shell } from './features/layout/Shell'
import { ModelPicker } from './features/picker/ModelPicker'
import { SearchDialog } from './features/search/SearchDialog'
import { AppSettings } from './features/settings/AppSettings'
import { ChatSettings } from './features/settings/ChatSettings'
import { ShortcutsDialog } from './features/shortcuts/ShortcutsDialog'
import { Sidebar } from './features/sidebar/Sidebar'
import { OAuthCallback } from './features/welcome/OAuthCallback'
import { Welcome } from './features/welcome/Welcome'
import { globalStyles } from './styles/tokens'
import { LiveRegion, Toaster } from './ui'

type MainView = 'booting' | 'oauth' | 'welcome' | 'chat'

const mainView = computed((): MainView => {
  const oauthStatus = oauthOutcome().status
  if (oauthStatus === 'connecting' || oauthStatus === 'error') return 'oauth'
  const mode = sessionMode()
  if (mode === 'booting') return 'booting'
  if (mode === 'welcome') return 'welcome'
  return 'chat'
}, 'app.mainView')

const Booting = () => (
  <div data-slot="Booting" aria-busy="true" css="flex: 1;" />
)

const MainRegion = () => (
  <div
    css={`
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    `}
  >
    {() => {
      const view = mainView()
      if (view === 'oauth') return <OAuthCallback />
      if (view === 'welcome') return <Welcome />
      if (view === 'chat') return <ChatScreen chat={activeChat()} />
      return <Booting />
    }}
  </div>
)

export const App = () => (
  <div data-testid="app" css="display: contents;">
    <style>{globalStyles}</style>
    <Shell sidebar={() => <Sidebar />} main={() => <MainRegion />} />
    <AppSettings />
    {() => <ChatSettings chat={activeChat()} />}
    <ModelPicker />
    <SearchDialog />
    <ShortcutsDialog />
    <UnlimitedKeyDialog />
    <Toaster />
    <LiveRegion />
  </div>
)
