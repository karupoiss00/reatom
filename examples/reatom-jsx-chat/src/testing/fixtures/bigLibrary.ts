import { repo } from '../../storage/repo'
import { createChatRecord, createDefaultChatSettings } from '../../storage/records'
import type { ChatRecord, UserMessage } from '../../storage/types'

export const bigLibraryChats = 500
export const bigLibraryMessages = 10_000
export const bigLibraryNeedle = 'vitest-needle'

const messagesPerChat = bigLibraryMessages / bigLibraryChats

const userMessage = (
  chatId: string,
  id: string,
  content: string,
  at: number,
): UserMessage => ({
  id,
  chatId,
  parentId: null,
  createdAt: at,
  rev: 1,
  role: 'user',
  content,
  attachments: [],
})

export const seedBigLibrary = async (): Promise<{
  chats: number
  messages: number
}> => {
  const settings = createDefaultChatSettings()
  const chats: ChatRecord[] = []
  const messages: UserMessage[] = []
  const needleChat = 250
  const needleMessage = 7

  for (let chatIndex = 0; chatIndex < bigLibraryChats; chatIndex += 1) {
    const chatId = `big-${chatIndex}`
    const at = 1_700_000_000_000 + chatIndex
    chats.push(
      createChatRecord({
        id: chatId,
        at,
        title: `Chat ${chatIndex}`,
        model: 'openai/gpt-4o-mini',
        settings,
      }),
    )
    for (let messageIndex = 0; messageIndex < messagesPerChat; messageIndex += 1) {
      const needle = chatIndex === needleChat && messageIndex === needleMessage
      messages.push(
        userMessage(
          chatId,
          `${chatId}-m${messageIndex}`,
          needle ? `Keep ${bigLibraryNeedle} in the archive.` : `Filler ${chatIndex}-${messageIndex}`,
          at + messageIndex + 1,
        ),
      )
    }
  }

  await repo.bulkImport({
    chats,
    messages,
    presets: [],
    attachments: [],
  })
  return { chats: chats.length, messages: messages.length }
}
