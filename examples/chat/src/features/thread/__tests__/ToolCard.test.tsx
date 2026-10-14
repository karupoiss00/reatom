import { atom } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { afterEach, expect, test } from 'vitest'

import type { ChatModel } from '../../../chat/types'
import { serializeToolResult } from '../../../mcp/intent'
import type { AssistantMessage } from '../../../storage/types'
import { ToolCard } from '../ToolCard'

const chatId = 'chat-tool-card-test'

const completedCall = {
  id: 'call_img',
  name: 'docs_mcp_preview',
  arguments: '{}',
  status: 'completed' as const,
  result: serializeToolResult({
    text: 'preview',
    images: [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://example.com/ok.png',
    ],
  }),
}

const assistant: AssistantMessage = {
  id: 'a1',
  chatId,
  parentId: 'u1',
  createdAt: 2,
  rev: 1,
  role: 'assistant',
  model: 'openai/gpt-4o-mini',
  content: '',
  status: 'done',
  reasoning: null,
  refusal: null,
  finishReason: 'tool_calls',
  error: null,
  usage: null,
  extraUsage: [],
  estimateCost: 0,
  generationId: null,
  provider: null,
  timing: { requestAt: 1, firstTokenAt: 2, endAt: 3 },
  citations: [],
  ownerTab: 'tab-tool-card-test',
  compareGroup: null,
  toolCalls: [completedCall],
}

const paint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

let unmountCard: (() => void) | null = null

afterEach(() => {
  unmountCard?.()
  unmountCard = null
  document.body.replaceChildren()
})

test('unsafe MCP image URLs are not applied as img src', async () => {
  const root = document.createElement('div')
  document.body.replaceChildren(root)
  const message = atom(assistant, 'test.toolCard.message')
  const chat = { id: chatId } as ChatModel
  unmountCard = mount(
    root,
    <ToolCard chat={chat} message={message} callId={completedCall.id} />,
  ).unmount
  await paint()

  const imgs = [
    ...document.querySelectorAll<HTMLImageElement>('[data-mcp-tool-result] img'),
  ]
  expect(imgs.map((img) => img.getAttribute('src'))).toEqual([
    'https://example.com/ok.png',
  ])
  expect(document.querySelector('img[src^="javascript:"]')).toBeNull()
  expect(document.querySelector('img[src^="data:"]')).toBeNull()
})
