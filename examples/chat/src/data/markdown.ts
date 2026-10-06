import { modelName } from '../catalog'
import type { ChatRecord, MessageRecord } from '../storage/types'
import { redactSecrets } from './redact'

export const chatToMarkdown = (
  chat: ChatRecord,
  visiblePath: MessageRecord[],
): string => {
  const lines = [`# ${redactSecrets(chat.title)}`, '']
  for (const message of visiblePath) {
    if (message.role === 'user') {
      lines.push('**You**', '', redactSecrets(message.content), '')
      if (message.attachments.length > 0) {
        const names = message.attachments
          .map((attachment) => redactSecrets(attachment.name))
          .join(', ')
        lines.push(`Attachments: ${names}`, '')
      }
      continue
    }
    lines.push(
      `**${redactSecrets(modelName(message.model))}**`,
      '',
      redactSecrets(message.content),
      '',
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}
