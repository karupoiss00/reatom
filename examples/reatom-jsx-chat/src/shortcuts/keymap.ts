import { action, wrap } from '@reatom/core'

import { commands } from '../app/commands'
import { activeChat } from '../chat/chatModel'
import { send } from '../chat/engine'
import { requestPersistOnce } from '../platform/storage-api'
import { onRuntimeReset } from '../platform/runtime'
import { sendKey } from '../storage/prefs'
import { globalBindings, matchesBinding } from './bindings'

const isComposerField = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement &&
  target.closest('[data-slot="Composer"]') !== null

const isImeEnter = (event: KeyboardEvent) =>
  event.isComposing || event.keyCode === 229

const sendComposer = () => {
  const chat = activeChat()
  requestPersistOnce()
  if (chat.streaming()?.local || chat.sendBlock()) return
  send(chat.id, {
    text: chat.draft.text(),
    attachments: chat.draft.attachments(),
  })
}

const handleSwappedEnter = (event: KeyboardEvent) => {
  if (event.key !== 'Enter' || !isComposerField(event.target) || isImeEnter(event))
    return false
  if (event.altKey || sendKey() !== 'mod-enter') return false
  const mod = event.metaKey || event.ctrlKey
  if (mod && !event.shiftKey) {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) sendComposer()
    return true
  }
  if (!mod && !event.shiftKey) {
    event.stopPropagation()
    return true
  }
  return false
}

let keymapListeners: AbortController | null = null

export const installKeymap = action(() => {
  if (keymapListeners) return
  keymapListeners = new AbortController()
  window.addEventListener(
    'keydown',
    wrap((event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      if (handleSwappedEnter(event)) return
      const binding = globalBindings.find((candidate) =>
        matchesBinding(event, candidate),
      )
      if (!binding) return
      if (binding.id === 'escape') {
        if (!event.repeat) commands.escape()
        return
      }
      event.preventDefault()
      if (event.repeat) return
      commands[binding.id]()
    }),
    { capture: true, signal: keymapListeners.signal },
  )
  onRuntimeReset(() => {
    keymapListeners?.abort()
    keymapListeners = null
  })
}, 'shortcuts.installKeymap')
