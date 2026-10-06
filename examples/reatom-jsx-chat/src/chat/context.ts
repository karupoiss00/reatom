import type {
  AssistantMessage,
  AttachmentBlob,
  MessageId,
  MessageRecord,
  UserMessage,
} from '../storage/types'
import type { WireContent, WireMessage } from './types'

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

const assistantWire = (
  message: AssistantMessage,
  requestModel: string,
): WireMessage | null => {
  if (message.content.length === 0) return null
  const wire: WireMessage = { role: 'assistant', content: message.content }
  const details = message.reasoning?.details ?? []
  if (message.model === requestModel && details.length > 0) {
    wire.reasoningDetails = details
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
    const assistant = assistantWire(message, args.requestModel)
    if (assistant) wire.push(assistant)
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
