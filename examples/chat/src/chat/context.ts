import type {
  AssistantMessage,
  AttachmentBlob,
  MessageId,
  MessageRecord,
  ToolCallRecord,
  UserMessage,
} from '../storage/types'
import type { WireContent, WireMessage, WireToolCall } from './types'

const userContent = (
  message: UserMessage,
  attachment: (id: string) => AttachmentBlob | undefined,
): WireContent => {
  if (message.attachments.length === 0) return message.content
  const parts: Exclude<WireContent, string> = []
  if (message.content.length > 0) {
    parts.push({ type: 'text', text: message.content })
  }
  for (const ref of message.attachments) {
    const blob = attachment(ref.id)
    if (!blob) continue
    if (ref.kind === 'image') {
      parts.push({ type: 'image_url', imageUrl: { url: blob.dataUrl } })
    } else {
      parts.push({
        type: 'file',
        file: { filename: ref.name, fileData: blob.dataUrl },
      })
    }
  }
  return parts.length > 0 ? parts : message.content
}

const toWireToolCall = (call: ToolCallRecord): WireToolCall => ({
  id: call.id,
  name: call.name,
  arguments: call.arguments,
  approval: call.status,
})

const toolWire = (message: MessageRecord): WireMessage | null => {
  const rec = message as {
    role: string
    content?: unknown
    toolCallId?: unknown
  }
  if (rec.role !== 'tool') return null
  const content = typeof rec.content === 'string' ? rec.content : ''
  const toolCallId = typeof rec.toolCallId === 'string' ? rec.toolCallId : undefined
  return toolCallId
    ? { role: 'tool', content, toolCallId }
    : { role: 'tool', content }
}

const pathToolCallIds = (path: MessageRecord[]) => {
  const ids = new Set<string>()
  for (const message of path) {
    const tool = toolWire(message)
    if (tool?.toolCallId) ids.add(tool.toolCallId)
  }
  return ids
}

const toolResultWire = (call: ToolCallRecord): WireMessage | null => {
  if (call.status === 'waiting' || call.status === 'calling') return null
  const content =
    typeof call.result === 'string' && call.result.length > 0
      ? call.result
      : call.status === 'denied'
        ? 'The user denied this tool call. It did not run.'
        : 'The tool finished.'
  return { role: 'tool', content, toolCallId: call.id }
}

const assistantWire = (
  message: AssistantMessage,
  requestModel: string,
): WireMessage | null => {
  const toolCalls = message.toolCalls ?? []
  if (message.content.length === 0 && toolCalls.length === 0) return null
  const wire: WireMessage = { role: 'assistant', content: message.content }
  const details = message.reasoning?.details ?? []
  if (message.model === requestModel && details.length > 0) {
    wire.reasoningDetails = details
  }
  if (toolCalls.length > 0) {
    wire.toolCalls = toolCalls.map(toWireToolCall)
  }
  return wire
}

export const assembleContext = (args: {
  path: MessageRecord[]
  systemPrompt: string
  requestModel: string
  endAtUserId?: MessageId
  attachment: (id: string) => AttachmentBlob | undefined
}): WireMessage[] => {
  const wire: WireMessage[] = []
  const existingToolIds = pathToolCallIds(args.path)
  if (args.systemPrompt.trim().length > 0) {
    wire.push({ role: 'system', content: args.systemPrompt })
  }
  for (const message of args.path) {
    if (message.role === 'user') {
      wire.push({
        role: 'user',
        content: userContent(message, args.attachment),
      })
      if (message.id === args.endAtUserId) break
      continue
    }
    const tool = toolWire(message)
    if (tool) {
      wire.push(tool)
      continue
    }
    if (message.role !== 'assistant') continue
    const assistant = assistantWire(message, args.requestModel)
    if (!assistant) continue
    wire.push(assistant)
    for (const call of message.toolCalls ?? []) {
      if (existingToolIds.has(call.id)) continue
      const result = toolResultWire(call)
      if (!result) continue
      wire.push(result)
      existingToolIds.add(call.id)
    }
  }
  return wire
}

export const contextCharacterCount = (messages: WireMessage[]): number => {
  let count = 0
  for (const message of messages) {
    if (typeof message.content === 'string') {
      count += message.content.length
      continue
    }
    for (const part of message.content) {
      if (part.type === 'text') count += part.text.length
    }
  }
  return count
}
