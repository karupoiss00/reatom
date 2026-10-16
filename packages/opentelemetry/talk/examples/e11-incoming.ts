import { action } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'desk',
  endpoint: 'https://desk.example/otel',
  serviceName: 'desk-web',
  sampling: { ratio: 0.1 },
})

type TicketEvent = { traceparent: string | null; ticketId: string }

const showTicket = action((ticketId: string) => ticketId, 'tickets.show')

export const onSocketMessage = action((event: TicketEvent) => {
  const remote = otel.parseTraceparent(event.traceparent)
  if (remote) otel.traceVar.set(remote)
  return showTicket(event.ticketId)
}, 'tickets.onSocketMessage')

const socket = new WebSocket('wss://desk.example/events')
socket.addEventListener('message', (message) => {
  onSocketMessage(JSON.parse(String(message.data)) as TicketEvent)
})
