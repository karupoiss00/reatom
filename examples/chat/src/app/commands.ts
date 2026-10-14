import { action } from '@reatom/core'

import { activeChat } from '../chat/chatModel'
import { stop } from '../chat/engine'
import { newChat as startNewChat } from '../chat/library'
import { sidebarCollapsed } from '../storage/prefs'
import { ui } from './ui'

const closeTopLayer = (): boolean => {
  if (ui.picker() !== null) {
    ui.picker.set(null)
    return true
  }
  if (ui.search()) {
    ui.search.set(false)
    return true
  }
  if (ui.shortcuts()) {
    ui.shortcuts.set(false)
    return true
  }
  if (ui.chatSettings() !== null) {
    ui.chatSettings.set(null)
    return true
  }
  if (ui.appSettings() !== null) {
    ui.appSettings.set(null)
    return true
  }
  if (ui.editing() !== null) {
    ui.editing.set(null)
    return true
  }
  if (ui.drawer()) {
    ui.drawer.set(false)
    return true
  }
  return false
}

export const commands = {
  newChat: action(() => {
    startNewChat()
  }, 'app.commands.newChat'),
  openPicker: action(() => {
    ui.picker.set({ purpose: 'chat' })
  }, 'app.commands.openPicker'),
  openSearch: action(() => {
    ui.search.set(true)
  }, 'app.commands.openSearch'),
  toggleSidebar: action(() => {
    sidebarCollapsed.set((collapsed) => !collapsed)
  }, 'app.commands.toggleSidebar'),
  escape: action(() => {
    if (closeTopLayer()) return
    if (ui.openLayerCount() !== 0) return
    const chat = activeChat()
    if (chat.streaming()) stop(chat.id)
  }, 'app.commands.escape'),
  editLastUserMessage: action(() => {
    const lastUserNode = activeChat()
      .path()
      .findLast((node) => node.message.role === 'user')
    if (lastUserNode) ui.editing.set(lastUserNode.message.id)
  }, 'app.commands.editLastUserMessage'),
  openShortcuts: action(() => {
    ui.shortcuts.set(true)
  }, 'app.commands.openShortcuts'),
  openSettings: action(() => {
    ui.appSettings.set('account')
  }, 'app.commands.openSettings'),
}
