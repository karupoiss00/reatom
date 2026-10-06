import { action, isAbort, wrap } from '@reatom/core'

import { ui } from '../../app/ui'
import { library, patchChat } from '../../chat/library'
import { ancestorChain, selectionKeyOf } from '../../chat/tree'
import { openChat } from '../../routes'
import { repo } from '../../storage/repo'
import type { ChatId, MessageId } from '../../storage/types'

let highlightToken = 0
let highlightTimer = 0

const applyMatchHighlight = (messageId: MessageId) => {
  const row = document.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(messageId)}"]`,
  )
  if (!row) return false
  const scroller = row.closest<HTMLElement>('[data-slot="Thread"]')
  if (scroller) {
    const top =
      row.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3)
  }
  row.setAttribute('data-highlight', 'match')
  return true
}

export const armMatchHighlight = (messageId: MessageId) => {
  window.clearTimeout(highlightTimer)
  const token = ++highlightToken
  const started = performance.now()
  let removalArmed = false
  const watch = () => {
    if (token !== highlightToken) return
    if (applyMatchHighlight(messageId) && !removalArmed) {
      removalArmed = true
      highlightTimer = window.setTimeout(() => {
        if (token !== highlightToken) return
        document
          .querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
          ?.removeAttribute('data-highlight')
      }, 2_000)
    }
    if (performance.now() - started < 1_600) requestAnimationFrame(watch)
  }
  requestAnimationFrame(watch)
}

const alignSelection = async (chatId: ChatId, messageId: MessageId) => {
  const messages = await wrap(repo.listMessages(chatId))
  const byId = new Map(messages.map((message) => [message.id, message]))
  const chain = ancestorChain(byId, messageId)
  if (chain.length === 0) return
  const current = library.chats().find((chat) => chat.id === chatId)
  if (!current) return
  const selection = { ...current.selection }
  for (const message of chain) selection[selectionKeyOf(message)] = message.id
  await wrap(patchChat(chatId, { selection }))
}

export const openSearchHit = action(
  async (target: { chatId: ChatId; messageId: MessageId | null }) => {
    ui.search.set(false)
    if (target.messageId) {
      try {
        await wrap(alignSelection(target.chatId, target.messageId))
      } catch (error) {
        if (isAbort(error)) throw error
      }
    }
    openChat(target.chatId)
    if (target.messageId) armMatchHighlight(target.messageId)
  },
  'search.openHit',
)
