import { action, computed, reatomRoute } from '@reatom/core'

import type { ChatId } from './storage/types'

export const homeRoute = reatomRoute('', 'routes.home')

export const chatRoute = reatomRoute('c/:chatId', 'routes.chat')

export const activeChatId = computed(
  (): ChatId | 'new' => chatRoute()?.chatId ?? 'new',
  'routes.activeChatId',
)

export const openChat = action((chatId: ChatId): void => {
  if (activeChatId() === chatId) return
  chatRoute.go({ chatId })
}, 'routes.openChat')
