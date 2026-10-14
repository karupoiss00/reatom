import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { overrideTimings } from '../../app/timings'
import { apiKey } from '../../auth/keyStore'
import { catalogModels } from '../../catalog/catalog'
import { errorAdapters } from '../../errors'
import { isMcpWriteTool, mcpAlwaysAllow } from '../../mcp/busy'
import { connectMcp, mcpReady } from '../../mcp'
import { createMemoryRepo } from '../../storage/memoryRepo'
import { setRepoBackend } from '../../storage/repo'
import type {
  AssistantMessage,
  MessageRecord,
  Repo,
} from '../../storage/types'
import { toolCallIntent } from '../../mcp/intent'
import {
  cubeAsk,
  cubeDeniedFollowUpScript,
  cubeExecuteArguments,
  cubeFollowUpScript,
  cubeToolCallScript,
  exportExecuteArguments,
  fusionMcpTools,
  fusionMcpUrl,
  fusionQuitFollowUpScript,
  fusionToolNames,
  mcpPlainReplyScript,
  undoAsk,
  widthUpdateArguments,
} from '../../testing/fixtures/mcp'
import {
  fusionDocument,
  mcpExecuteCalls,
  simulateMcpCallDelay,
  simulateMcpQuitMidTool,
} from '../../testing/mcp-mock'
import {
  chatBodies,
  mockChatStreams,
} from '../../testing/openrouter-mock'
import { chatModelInternals, getChatModel } from '../chatModel'
import {
  allowToolOnce,
  alwaysAllowTool,
  cancelCostSettlement,
  denyTool,
  send,
} from '../engine'
import { library } from '../library'
import { injectSyncPublisher } from '../syncPublisher'
import { claudeSonnet, gpt4oMini } from './fixtures'

type WireBody = {
  model: string
  messages: Array<Record<string, unknown>>
  tools?: unknown
  [key: string]: unknown
}

const startUrl = location.href
let backend: Repo

const input = (text: string) => ({ text, attachments: [] })

const bodies = () => chatBodies() as WireBody[]

const onlyChatId = () => {
  const chats = library.chats()
  expect(chats).toHaveLength(1)
  return chats[0]!.id
}

const assistants = (chatId: string) =>
  [...getChatModel(chatId).messages().values()]
    .filter((message): message is AssistantMessage => message.role === 'assistant')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

const lastAssistant = (chatId: string) => assistants(chatId).at(-1)!

const encoded = (value: unknown) => JSON.stringify(value)

const enableMcp = async () => {
  await connectMcp(fusionMcpUrl)
  expect(mcpReady()).toBe(true)
  getChatModel('new').updateSettings({ mcpEnabled: true })
}

beforeEach(async () => {
  history.replaceState(null, '', startUrl)
  context.reset()
  overrideTimings()
  backend = createMemoryRepo()
  setRepoBackend(backend)
  injectSyncPublisher({
    supported: true,
    publish: () => {},
  })
  apiKey.set('sk-or-v1-test')
  catalogModels.set([gpt4oMini, claudeSonnet])
  vi.spyOn(errorAdapters, 'fromStreamErrorChunk')
  vi.mocked(errorAdapters.fromStreamErrorChunk).mockClear()
  await library.reload()
})

afterEach(() => {
  cancelCostSettlement()
  vi.mocked(errorAdapters.fromStreamErrorChunk).mockRestore()
  history.replaceState(null, '', startUrl)
})

describe('F-30 Rule Fusion from chat', () => {
  test('Engine passes connected MCP tools only when the server chip is on', async () => {
    await connectMcp(fusionMcpUrl)
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    getChatModel('new').updateSettings({ mcpEnabled: false })
    await send('new', input(cubeAsk))
    expect(encoded(bodies()[0]?.tools ?? [])).not.toContain(fusionToolNames.execute)

    const chatId = onlyChatId()
    getChatModel(chatId).updateSettings({ mcpEnabled: true })
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    await send(chatId, input(cubeAsk))
    expect(encoded(bodies().at(-1)?.tools)).toContain(fusionToolNames.execute)
  })

  test('A Fusion execute arrives as a waiting card and Allow once runs it (F-30)', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    expect(pending.error).toBeNull()
    expect(pending.toolCalls).toEqual([
      expect.objectContaining({
        id: 'call_fusion_cube',
        name: fusionToolNames.execute,
        status: 'waiting',
      }),
    ])
    expect(fusionDocument().cubeMm).toBeNull()
    expect(mcpExecuteCalls()).toHaveLength(0)

    await allowToolOnce(chatId, pending.id, 'call_fusion_cube')
    expect(fusionDocument().cubeMm).toBe(10)
    expect(mcpExecuteCalls()).toHaveLength(1)
    await expect
      .poll(() => lastAssistant(chatId).content)
      .toMatch(/10 mm cube/i)
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('completed')
    expect(lastAssistant(chatId).toolCalls?.[0]?.result).toMatch(
      /Created a 10 mm cube/i,
    )
  })

  test('Persisted completed MCP results are sent as role:tool on the next user send', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript, mcpPlainReplyScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    await allowToolOnce(chatId, pending.id, 'call_fusion_cube')
    await expect
      .poll(() => lastAssistant(chatId).toolCalls?.[0]?.status)
      .toBe('completed')
    const storedResult = lastAssistant(chatId).toolCalls?.[0]?.result
    expect(storedResult).toMatch(/Created a 10 mm cube/i)

    getChatModel(chatId).messages.set(new Map())
    await chatModelInternals(chatId).reloadStoredMessages()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('completed')
    expect(lastAssistant(chatId).toolCalls?.[0]?.result).toBe(storedResult)

    await send(chatId, input(undoAsk))
    const followUp = bodies().at(-1)
    const messages = followUp?.messages as Array<{
      role?: string
      toolCallId?: string
      tool_call_id?: string
      content?: unknown
    }>
    expect(messages?.map((message) => message.role)).toEqual(
      expect.arrayContaining(['user', 'assistant', 'tool', 'user']),
    )
    const toolTurn = messages?.find((message) => message.role === 'tool')
    expect(toolTurn?.content).toBe(storedResult)
    expect(toolTurn?.toolCallId ?? toolTurn?.tool_call_id).toBe('call_fusion_cube')
    expect(messages?.filter((message) => message.role === 'tool')).toHaveLength(1)
  })

  test('Connected MCP function tools keep tools/list inputSchema required properties', async () => {
    await enableMcp()
    mockChatStreams([mcpPlainReplyScript])
    await send('new', input(cubeAsk))
    const tools = bodies()[0]?.tools as Array<{
      function?: {
        name?: string
        parameters?: {
          properties?: Record<string, unknown>
          required?: string[]
        }
      }
    }>
    const execute = tools?.find(
      (tool) => tool.function?.name === fusionToolNames.execute,
    )
    expect(execute?.function?.parameters?.required).toEqual(['code'])
    expect(execute?.function?.parameters?.properties).toMatchObject({
      code: expect.objectContaining({ type: 'string' }),
    })
    const update = tools?.find(
      (tool) => tool.function?.name === fusionToolNames.update,
    )
    expect(update?.function?.parameters?.required).toEqual(['name', 'value'])
  })

  test('Intent summarises this call’s args and matches unprefixed tool names', () => {
    const execute = {
      name: fusionToolNames.execute,
      arguments: cubeExecuteArguments,
    }
    expect(toolCallIntent(execute)).toMatch(/10\s*mm cube/i)
    expect(toolCallIntent(execute)).not.toMatch(/with the arguments below/i)
    expect(
      toolCallIntent(execute, [{ name: 'execute', description: 'unused generic' }]),
    ).toMatch(/10\s*mm cube/i)
    expect(
      toolCallIntent(
        { name: fusionToolNames.update, arguments: widthUpdateArguments },
        fusionMcpTools,
      ),
    ).toMatch(/Width/i)
    expect(
      toolCallIntent({
        name: fusionToolNames.execute,
        arguments: exportExecuteArguments,
      }),
    ).toMatch(/export|STEP/i)
    expect(
      toolCallIntent(
        { name: fusionToolNames.read, arguments: '{}' },
        [{ name: 'read', description: 'Read the open document without changing it.' }],
      ),
    ).toMatch(/without changing it/i)
  })
})

describe('F-31 Deny a Fusion execute', () => {
  test('Deny leaves Fusion unchanged and Always on read cannot run execute', async () => {
    await enableMcp()
    mcpAlwaysAllow.set(new Set([fusionToolNames.read]))
    mockChatStreams([cubeToolCallScript, cubeDeniedFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    const execute = pending.toolCalls?.[0]
    expect(execute?.name).toBe(fusionToolNames.execute)
    expect(execute?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)

    await alwaysAllowTool(chatId, pending.id, execute!.id)
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('waiting')

    await denyTool(chatId, pending.id, execute!.id)
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('denied')
    await expect
      .poll(() => lastAssistant(chatId).content)
      .toMatch(/did not run/i)
  })
})

describe('F-37 Fusion quit mid-tool', () => {
  test('A call that dies in flight errors the card and does not hang or claim Deny', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, fusionQuitFollowUpScript])
    simulateMcpQuitMidTool()
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    await allowToolOnce(chatId, pending.id, 'call_fusion_cube')
    const finished = lastAssistant(chatId)
    expect(finished.toolCalls?.[0]?.status).toBe('error')
    expect(finished.toolCalls?.[0]?.result).toMatch(/Reconnect|stopped/i)
    expect(finished.toolCalls?.[0]?.result).not.toMatch(/denied/i)
    expect(fusionDocument().cubeMm).toBeNull()
    await expect
      .poll(
        () =>
          `${lastAssistant(chatId).content}\n${lastAssistant(chatId).toolCalls?.[0]?.result ?? ''}`,
      )
      .toMatch(/Reconnect|stopped|checkbox/i)
  })
})

describe('F-39 Refresh mid-Allow', () => {
  test('Reloading a waiting write parks calling tools and never auto-runs', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    expect(pending.toolCalls?.[0]?.status).toBe('waiting')
    await backend.putMessage({
      ...pending,
      rev: pending.rev + 1,
      toolCalls: pending.toolCalls?.map((call) => ({
        ...call,
        status: 'calling',
      })),
    } as MessageRecord)
    getChatModel(chatId).messages.set(new Map())
    await chatModelInternals(chatId).reloadStoredMessages()
    const restored = lastAssistant(chatId)
    expect(restored.toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
    expect(restored.content).not.toMatch(/cube created/i)
  })
})

const longExecuteArguments = JSON.stringify({
  code: `${'x'.repeat(24_000)}\nprint("noop")`,
})

const longToolCallScript = [
  {
    data: {
      id: 'gen-mcp-long',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_mcp_long',
                type: 'function',
                function: {
                  name: fusionToolNames.execute,
                  arguments: longExecuteArguments,
                },
              },
            ],
          },
          finish_reason: 'tool_calls' as const,
        },
      ],
    },
  },
]

const longFollowUpScript = [
  {
    data: {
      id: 'gen-mcp-long-done',
      object: 'chat.completion.chunk',
      created: 1710000000,
      model: 'openai/gpt-4o-mini',
      choices: [
        {
          index: 0,
          delta: { content: 'That long script did not run a cube.' },
          finish_reason: 'stop' as const,
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
        cost: 0.00002,
        is_byok: false,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    },
  },
]

describe('P5 hostile Allow / chips / refresh', () => {
  test('Double Allow runs a write once (F-30)', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    simulateMcpCallDelay(80)
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    await Promise.allSettled([
      allowToolOnce(chatId, pending.id, 'call_fusion_cube'),
      allowToolOnce(chatId, pending.id, 'call_fusion_cube'),
    ])
    expect(mcpExecuteCalls()).toHaveLength(1)
    expect(fusionDocument().cubeMm).toBe(10)
    const statuses = lastAssistant(chatId).toolCalls?.map((call) => call.status)
    expect(statuses).toEqual(['completed'])
  })

  test('Deny then Allow does not run (F-31)', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, cubeDeniedFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    await denyTool(chatId, pending.id, 'call_fusion_cube')
    await allowToolOnce(chatId, pending.id, 'call_fusion_cube')
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('denied')
  })

  test('Simultaneous Deny and Allow cannot run the write (F-31)', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, cubeDeniedFollowUpScript])
    simulateMcpCallDelay(60)
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    await Promise.all([
      denyTool(chatId, pending.id, 'call_fusion_cube'),
      allowToolOnce(chatId, pending.id, 'call_fusion_cube'),
    ])
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).not.toBe('completed')
  })

  test('Always hunt cannot remember or auto-run execute (F-31)', async () => {
    await enableMcp()
    mcpAlwaysAllow.set(new Set([fusionToolNames.execute, fusionToolNames.read]))
    expect(isMcpWriteTool(fusionToolNames.execute)).toBe(true)
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    expect(pending.toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)

    await alwaysAllowTool(chatId, pending.id, 'call_fusion_cube')
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpAlwaysAllow().has(fusionToolNames.execute)).toBe(true)
  })

  test('Both chips on still wait for Allow and do not use :online (F-36)', async () => {
    await enableMcp()
    getChatModel('new').updateSettings({ mcpEnabled: true, webSearch: true })
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    await send('new', input(cubeAsk))
    const first = bodies()[0]
    expect(encoded(first?.tools)).toContain(fusionToolNames.execute)
    expect(encoded(first?.tools)).toContain('openrouter:web_search')
    expect(encoded(first)).not.toContain(':online')
    const chatId = onlyChatId()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)
  })

  test('Chip off mid-card does not auto-run and drops tools on the next send (F-36)', async () => {
    await enableMcp()
    mockChatStreams([cubeToolCallScript, mcpPlainReplyScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('waiting')
    getChatModel(chatId).updateSettings({ mcpEnabled: false })
    expect(lastAssistant(chatId).toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()

    const parkedId = lastAssistant(chatId).id
    await send(chatId, input('never mind'))
    expect(encoded(bodies().at(-1)?.tools ?? [])).not.toContain(
      fusionToolNames.execute,
    )
    const parked = assistants(chatId).find((message) => message.id === parkedId)
    expect(parked?.toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)
  })

  test('Reload of a calling write stays waiting even if Always is poisoned (F-39)', async () => {
    await enableMcp()
    mcpAlwaysAllow.set(new Set([fusionToolNames.execute, fusionToolNames.read]))
    mockChatStreams([cubeToolCallScript, cubeFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    await backend.putMessage({
      ...pending,
      rev: pending.rev + 1,
      toolCalls: pending.toolCalls?.map((call) => ({
        ...call,
        status: 'calling',
      })),
    } as MessageRecord)
    getChatModel(chatId).messages.set(new Map())
    await chatModelInternals(chatId).reloadStoredMessages()
    const restored = lastAssistant(chatId)
    expect(restored.toolCalls?.[0]?.status).toBe('waiting')
    expect(mcpExecuteCalls()).toHaveLength(0)
    expect(fusionDocument().cubeMm).toBeNull()
  })

  test('Very long execute args still wait for Allow and do not dump into intent (F-30)', async () => {
    await enableMcp()
    mockChatStreams([longToolCallScript, longFollowUpScript])
    await send('new', input(cubeAsk))
    const chatId = onlyChatId()
    const pending = lastAssistant(chatId)
    const call = pending.toolCalls?.[0]
    expect(call?.status).toBe('waiting')
    expect(call?.arguments.length).toBeGreaterThan(20_000)
    const intent = toolCallIntent(call!, fusionMcpTools)
    expect(intent.length).toBeLessThan(400)
    expect(intent).not.toContain('x'.repeat(80))
    expect(mcpExecuteCalls()).toHaveLength(0)
    await allowToolOnce(chatId, pending.id, 'call_mcp_long')
    expect(mcpExecuteCalls()).toHaveLength(1)
  })
})
