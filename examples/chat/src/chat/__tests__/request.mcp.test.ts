import { describe, expect, test } from 'vitest'

import { createDefaultChatSettings } from '../../storage/records'
import type { ChatSettings } from '../../storage/types'
import {
  cubeAsk,
  fusionMcpTools,
  fusionToolNames,
} from '../../testing/fixtures/mcp'
import { buildChatRequest } from '../request'
import { gpt4oMini } from './fixtures'

const strictPrivacy = { denyDataCollection: true, zdr: false }
const webSearchTool = { type: 'openrouter:web_search' }

const settingsWith = (patch: Partial<ChatSettings> = {}): ChatSettings => ({
  ...createDefaultChatSettings(),
  ...patch,
})

const mappedFusionTools = fusionMcpTools.map((tool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
}))

const chatRequest = (
  settings: Partial<ChatSettings>,
  mcpTools: readonly (typeof fusionMcpTools)[number][] = [...fusionMcpTools],
) => {
  const args = {
    modelId: gpt4oMini.id,
    model: gpt4oMini,
    messages: [{ role: 'user' as const, content: cubeAsk }],
    settings: settingsWith(settings),
    globalPrivacy: strictPrivacy,
    mcpTools,
  }
  return buildChatRequest(args)
}

const encoded = (value: unknown) => JSON.stringify(value)

describe('F-21 exact tools when MCP is off', () => {
  test('When mcpEnabled is off, tools is still only openrouter:web_search if webSearch is on, even if Fusion schemas are passed', () => {
    const request = chatRequest({ webSearch: true, mcpEnabled: false })
    expect(request.tools).toEqual([webSearchTool])
    expect(String(request.model)).not.toContain(':online')
    expect(request.plugins).toBeUndefined()
    expect(encoded(request)).not.toContain(':online')
    expect(encoded(request)).not.toContain('"id":"web"')
    expect(encoded(request.tools)).not.toContain(fusionToolNames.execute)
  })

  test('When mcpEnabled is off and webSearch is off, tools stays absent', () => {
    const request = chatRequest({ webSearch: false, mcpEnabled: false })
    expect(request.tools).toBeUndefined()
    expect(encoded(request)).not.toContain('openrouter:web_search')
    expect(encoded(request)).not.toContain(fusionToolNames.execute)
  })
})

describe('F-30 Rule Fusion from chat', () => {
  test('When mcpEnabled and Fusion schemas are connected, buildChatRequest maps them to function tools including fusion_mcp_execute', () => {
    const request = chatRequest({ mcpEnabled: true, webSearch: false })
    expect(request.tools).toEqual(mappedFusionTools)
    expect(encoded(request.tools)).toContain(fusionToolNames.execute)
    expect(encoded(request.tools)).not.toContain('openrouter:fusion')
    expect(encoded(request)).not.toContain(':online')
  })
})

describe('F-36 Both chips on', () => {
  test('When mcpEnabled and webSearch are on, tools is mapped Fusion functions PLUS openrouter:web_search', () => {
    const request = chatRequest({ mcpEnabled: true, webSearch: true })
    expect(request.tools).toEqual([...mappedFusionTools, webSearchTool])
    expect(encoded(request)).not.toContain(':online')
    expect(encoded(request)).not.toContain('"id":"web"')
    expect(request.plugins).toBeUndefined()
  })

  test('Connected but empty Fusion schemas keep tools as web_search only when webSearch is on', () => {
    const request = chatRequest({ mcpEnabled: true, webSearch: true }, [])
    expect(request.tools).toEqual([webSearchTool])
  })
})
