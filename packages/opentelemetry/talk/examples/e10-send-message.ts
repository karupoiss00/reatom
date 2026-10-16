import { action, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'chat',
  endpoint: 'https://chat.example/otel',
  serviceName: 'chat-web',
})

export const sendMessage = action(async (text: string) => {
  otel.traceVar.set(otel.createTrace({ name: 'send message' }))
  const traceparent = otel.traceparent()
  const response = await wrap(
    fetch('/api/messages', {
      method: 'POST',
      headers: traceparent ? { traceparent } : {},
      body: JSON.stringify({ text }),
    }),
  )
  return (await wrap(response.json())) as { id: string }
}, 'chat.sendMessage')
