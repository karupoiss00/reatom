import { action, computed, reatomRoute } from '@reatom/core'

import type { ChatId } from './storage/types'

const basePath = import.meta.env.BASE_URL.replace(/^\/|\/$/g, '')

const rootRoute = basePath ? reatomRoute(basePath) : null

export const homeRoute = rootRoute
  ? rootRoute.reatomRoute('', 'routes.home')
  : reatomRoute('', 'routes.home')

export const chatRoute = rootRoute
  ? rootRoute.reatomRoute('c/:chatId', 'routes.chat')
  : reatomRoute('c/:chatId', 'routes.chat')

export const activeChatId = computed(
  (): ChatId | 'new' => chatRoute()?.chatId ?? 'new',
  'routes.activeChatId',
)

export const openChat = action((chatId: ChatId): void => {
  if (activeChatId() === chatId) return
  chatRoute.go({ chatId })
}, 'routes.openChat')

export const currentChatReturnTo = (): string | null => {
  if (!chatRoute()?.chatId) return null
  return `${location.pathname}${location.search}${location.hash}`
}

export const chatIdFromReturnTo = (returnTo: string): string | null => {
  let url: URL
  try {
    url = new URL(returnTo, location.origin)
  } catch {
    return null
  }
  const home = homeRoute.path().replace(/\/$/, '')
  const pathname =
    home.length > 0 &&
    (url.pathname === home || url.pathname.startsWith(`${home}/`))
      ? url.pathname.slice(home.length) || '/'
      : url.pathname
  const chatId = /^\/c\/([^/]+)$/.exec(pathname)?.[1]
  return chatId ? decodeURIComponent(chatId) : null
}
