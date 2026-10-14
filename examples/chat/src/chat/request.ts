import type {
  ChatFunctionTool,
  ChatMessages,
  ChatRequest,
  ProviderPreferences,
} from '@openrouter/sdk/models'

import type { CatalogModel } from '../catalog/types'
import type {
  ChatSettings,
  PrivacySettings,
  ReasoningEffort,
} from '../storage/types'
import type { RequestOverrides, WireMessage } from './types'

export type McpToolSchema = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

const textContent = (content: WireMessage['content']): string =>
  typeof content === 'string'
    ? content
    : content.map((part) => (part.type === 'text' ? part.text : '')).join('')

const toSdkMessage = (message: WireMessage): ChatMessages => {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: textContent(message.content),
    }
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: textContent(message.content),
      toolCallId: message.toolCallId ?? '',
    }
  }
  if (message.role === 'assistant') {
    const content = textContent(message.content)
    const sdk: ChatMessages = { role: 'assistant', content }
    if (message.reasoningDetails && message.reasoningDetails.length > 0) {
      sdk.reasoningDetails = message.reasoningDetails as never
    }
    if (message.toolCalls && message.toolCalls.length > 0) {
      sdk.toolCalls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }))
    }
    return sdk
  }
  return { role: 'user', content: message.content as never }
}

const webSearchTool = { type: 'openrouter:web_search' } as ChatFunctionTool

const toFunctionTool = (tool: McpToolSchema): ChatFunctionTool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
})

const providerPreferences = (
  settings: ChatSettings,
  globalPrivacy: PrivacySettings,
): ProviderPreferences | null => {
  const privacy = settings.privacyOverride ?? globalPrivacy
  const provider: ProviderPreferences = {}
  if (privacy.denyDataCollection) provider.dataCollection = 'deny'
  if (privacy.zdr) provider.zdr = true
  const routing = settings.routing
  if (routing.mode !== 'auto' && routing.providers.length > 0) {
    if (routing.mode === 'order') provider.order = [...routing.providers]
    else provider.only = [...routing.providers]
  }
  if (!routing.allowFallbacks) provider.allowFallbacks = false
  return Object.keys(provider).length > 0 ? provider : null
}

const supports = (model: CatalogModel | null, parameter: string) =>
  model?.supportedParameters.includes(parameter) ?? false

const acceptedEffort = (
  model: CatalogModel | null,
  effort: ReasoningEffort | undefined,
): ReasoningEffort | null => {
  if (!effort || !model) return null
  if (!supports(model, 'reasoning') && !supports(model, 'reasoning_effort')) {
    return null
  }
  if (model.supportedEfforts && !model.supportedEfforts.includes(effort)) {
    return null
  }
  return effort
}

export const buildChatRequest = (args: {
  modelId: string
  model: CatalogModel | null
  messages: WireMessage[]
  settings: ChatSettings
  globalPrivacy: PrivacySettings
  overrides?: RequestOverrides
  mcpTools?: readonly McpToolSchema[]
}): ChatRequest => {
  const overrides = args.overrides ?? {}
  const modelId = (overrides.model ?? args.modelId).trim()
  if (modelId.length === 0) {
    throw new Error('A chat request needs a model id')
  }
  const model = args.model
  const params = args.settings.params
  const request: ChatRequest = {
    model: modelId,
    messages: args.messages.map(toSdkMessage),
    stream: true,
  }

  const provider = providerPreferences(args.settings, args.globalPrivacy)
  if (provider) request.provider = provider

  if (params.temperature !== undefined && supports(model, 'temperature')) {
    request.temperature = params.temperature
  }
  if (params.topP !== undefined && supports(model, 'top_p')) {
    request.topP = params.topP
  }
  const maxTokens = overrides.maxTokens ?? params.maxTokens
  if (maxTokens !== undefined && supports(model, 'max_tokens')) {
    request.maxTokens = maxTokens
  }
  const effort = acceptedEffort(
    model,
    overrides.reasoningEffort ?? params.reasoningEffort,
  )
  if (effort) request.reasoning = { effort }

  const tools: ChatFunctionTool[] = []
  if (args.settings.mcpEnabled && args.mcpTools && args.mcpTools.length > 0) {
    tools.push(...args.mcpTools.map(toFunctionTool))
  }
  if (args.settings.webSearch && !overrides.noWebSearch) {
    tools.push(webSearchTool)
  }
  if (tools.length > 0) request.tools = tools
  return request
}
