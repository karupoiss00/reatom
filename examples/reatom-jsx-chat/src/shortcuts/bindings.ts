import { computed } from '@reatom/core'

import { commands } from '../app/commands'
import { sendKey } from '../storage/prefs'

export interface ShortcutBinding {
  id: keyof typeof commands
  key: string
  code: string
  mod: boolean
  shift: boolean
  label: string
}

export interface ListedShortcut {
  id: string
  chord: string
  label: string
}

const isMacLike = () =>
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

const modPrefix = () => (isMacLike() ? '⌘' : 'Ctrl+')

const shiftModPrefix = () => (isMacLike() ? '⌘⇧' : 'Ctrl+Shift+')

export const modEnterChord = () => `${modPrefix()}Enter`

export const globalBindings: readonly ShortcutBinding[] = [
  {
    id: 'openSearch',
    key: 'k',
    code: 'KeyK',
    mod: true,
    shift: false,
    label: 'Search chats',
  },
  {
    id: 'newChat',
    key: 'o',
    code: 'KeyO',
    mod: true,
    shift: true,
    label: 'New chat',
  },
  {
    id: 'openPicker',
    key: 'l',
    code: 'KeyL',
    mod: true,
    shift: true,
    label: 'Choose a model',
  },
  {
    id: 'toggleSidebar',
    key: 's',
    code: 'KeyS',
    mod: true,
    shift: true,
    label: 'Toggle sidebar',
  },
  {
    id: 'openShortcuts',
    key: '/',
    code: 'Slash',
    mod: true,
    shift: false,
    label: 'Keyboard shortcuts',
  },
  {
    id: 'escape',
    key: 'escape',
    code: 'Escape',
    mod: false,
    shift: false,
    label: 'Stop generating or close a dialog',
  },
]

export const matchesBinding = (
  event: KeyboardEvent,
  binding: ShortcutBinding,
) => {
  if (event.altKey) return false
  const isMod = event.metaKey || event.ctrlKey
  if (isMod !== binding.mod || event.shiftKey !== binding.shift) return false
  return event.key.toLowerCase() === binding.key || event.code === binding.code
}

export const listedBindings = computed((): readonly ListedShortcut[] => {
  const swapped = sendKey() === 'mod-enter'
  const modKey = modPrefix()
  const shiftKey = shiftModPrefix()
  return [
    {
      id: 'send',
      chord: swapped ? modEnterChord() : 'Enter',
      label: 'Send',
    },
    {
      id: 'newline',
      chord: swapped ? 'Enter' : 'Shift+Enter',
      label: 'Insert a newline',
    },
    {
      id: 'escape',
      chord: 'Esc',
      label: 'Stop generating or close a dialog',
    },
    { id: 'openSearch', chord: `${modKey}K`, label: 'Search chats' },
    { id: 'newChat', chord: `${shiftKey}O`, label: 'New chat' },
    { id: 'openPicker', chord: `${shiftKey}L`, label: 'Choose a model' },
    { id: 'toggleSidebar', chord: `${shiftKey}S`, label: 'Toggle sidebar' },
    {
      id: 'editLastUserMessage',
      chord: '↑',
      label: 'Edit the last message',
    },
    {
      id: 'openShortcuts',
      chord: `${modKey}/`,
      label: 'Keyboard shortcuts',
    },
  ]
}, 'shortcuts.listedBindings')
