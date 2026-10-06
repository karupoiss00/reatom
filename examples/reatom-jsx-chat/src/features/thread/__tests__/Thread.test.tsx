import { atom, computed } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { afterEach, expect, test } from 'vitest'

import { ui } from '../../../app/ui'
import type { ChatModel, ThreadNode } from '../../../chat/types'
import type {
  AssistantMessage,
  MessageId,
  MessageRecord,
  UserMessage,
} from '../../../storage/types'
import { Thread } from '../Thread'

const chatId = 'chat-thread-test'

const userMessage = (
  id: MessageId,
  parentId: MessageId | null,
  content: string,
): UserMessage => ({
  id,
  chatId,
  parentId,
  createdAt: Date.now(),
  rev: 1,
  role: 'user',
  content,
  attachments: [],
})

const assistantMessage = (
  id: MessageId,
  parentId: MessageId,
  content: string,
  compareGroup: string | null = null,
): AssistantMessage => ({
  id,
  chatId,
  parentId,
  createdAt: Date.now(),
  rev: 1,
  role: 'assistant',
  model: 'openai/gpt-4o-mini',
  content,
  status: 'streaming',
  reasoning: null,
  refusal: null,
  finishReason: null,
  error: null,
  usage: null,
  extraUsage: [],
  estimateCost: 0,
  generationId: null,
  provider: null,
  timing: { requestAt: Date.now(), firstTokenAt: null, endAt: null },
  citations: [],
  ownerTab: 'tab-thread-test',
  compareGroup,
})

const createFakeChat = (initial: MessageRecord[]) => {
  const pathMessages = atom<MessageRecord[]>(initial, 'test.thread.path')
  const path = computed(
    (): ThreadNode[] =>
      pathMessages().map((message) => ({
        message,
        versions: [message.id],
        versionIndex: 0,
      })),
    'test.thread.pathNodes',
  )
  const chat = { id: chatId, path } as Partial<ChatModel> as ChatModel
  const appendChunk = (id: MessageId, chunk: string) =>
    pathMessages.set((messages) =>
      messages.map((message) =>
        message.id === id
          ? {
              ...message,
              content: message.content + chunk,
              rev: message.rev + 1,
            }
          : message,
      ),
    )
  const append = (message: MessageRecord) =>
    pathMessages.set((messages) => [...messages, message])
  return { chat, appendChunk, append }
}

const paint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const row = (id: MessageId) =>
  document.querySelector<HTMLElement>(`[data-message-id="${id}"]`)

let unmountThread: (() => void) | null = null

const mountThread = (chat: ChatModel) => {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  unmountThread = mount(root, <Thread chat={chat} />).unmount
}

afterEach(() => {
  unmountThread?.()
  unmountThread = null
  document.body.replaceChildren()
})

test('keeps message rows mounted across streamed chunks and new messages', async () => {
  const thread = createFakeChat([
    userMessage('u1', null, 'Explain atoms'),
    assistantMessage('a1', 'u1', 'Atoms'),
  ])
  mountThread(thread.chat)
  await paint()

  const firstRow = row('u1')
  const replyRow = row('a1')
  const replyContent = replyRow?.querySelector('[data-message-content]')
  expect(firstRow).toBeInstanceOf(HTMLElement)
  expect(replyContent?.textContent).toBe('Atoms')

  thread.appendChunk('a1', ' hold state')
  await paint()
  expect(row('u1')).toBe(firstRow)
  expect(row('a1')).toBe(replyRow)
  expect(replyRow?.querySelector('[data-message-content]')).toBe(replyContent)
  expect(replyContent?.textContent).toBe('Atoms hold state')

  thread.append(userMessage('u2', 'a1', 'And computeds?'))
  thread.append(assistantMessage('a2', 'u2', ''))
  await paint()
  expect(row('u1')).toBe(firstRow)
  expect(row('a1')).toBe(replyRow)
  expect(
    [...document.querySelectorAll('[data-message-id]')].map((element) =>
      element.getAttribute('data-message-id'),
    ),
  ).toEqual(['u1', 'a1', 'u2', 'a2'])
})

test('edits a user message inside its bubble without remounting the row', async () => {
  const thread = createFakeChat([
    userMessage('u1', null, 'Draft question'),
    assistantMessage('a1', 'u1', 'Reply'),
  ])
  mountThread(thread.chat)
  await paint()

  const firstRow = row('u1')
  const bubble = firstRow?.querySelector('[data-slot="UserMessageBubble"]')
  const replyRow = row('a1')
  expect(firstRow?.querySelector('[data-slot="UserMessageEditor"]')).toBeNull()

  ui.editing.set('u1')
  await paint()
  const editor = firstRow?.querySelector('[data-slot="UserMessageEditor"]')
  expect(row('u1')).toBe(firstRow)
  expect(firstRow?.querySelector('[data-slot="UserMessageBubble"]')).toBe(bubble)
  expect(editor).toBeInstanceOf(HTMLElement)
  expect(bubble?.contains(editor)).toBe(true)
  expect(row('a1')).toBe(replyRow)

  ui.editing.set(null)
  await paint()
  expect(row('u1')).toBe(firstRow)
  expect(firstRow?.querySelector('[data-slot="UserMessageEditor"]')).toBeNull()
  expect(firstRow?.textContent).toContain('Draft question')
})

test('renders compare columns instead of a normal reply for a compare group', async () => {
  const thread = createFakeChat([
    userMessage('u1', null, 'Compare these'),
    assistantMessage('a1', 'u1', 'Left reply', 'group-1'),
  ])
  mountThread(thread.chat)
  await paint()

  const compareRow = row('a1')
  expect(
    compareRow?.querySelector('[data-slot="CompareColumns"]'),
  ).toBeInstanceOf(HTMLElement)
  expect(compareRow?.querySelector('[data-slot="AssistantMessage"]')).toBeNull()
})

test('shows the empty state only while the path is empty', async () => {
  const thread = createFakeChat([])
  mountThread(thread.chat)
  await paint()
  expect(document.body.textContent).toContain('What should we think about?')

  thread.append(userMessage('u1', null, 'Hello'))
  await paint()
  expect(document.body.textContent).not.toContain('What should we think about?')
  expect(row('u1')).toBeInstanceOf(HTMLElement)
})
