import {
  ADMIN_FRAME,
  connectAdmin,
  mountAdminView,
  registerLocalWorkOption,
} from '@reatom/admin'
import { reatomBoolean } from '@reatom/core'
import type { ReatomOpentelemetry } from '@reatom/opentelemetry'

export function connectChatAdmin(otel: ReatomOpentelemetry): () => void {
  const host = document.createElement('div')
  document.body.append(host)
  const connection = connectAdmin(otel, { host, localValues: true })
  const liveValues = ADMIN_FRAME.run(() =>
    reatomBoolean(connection.localValues() !== false, '_Admin.chat.liveValues'),
  )
  const stopLiveValuesSync = ADMIN_FRAME.run(() =>
    liveValues.subscribe((enabled) => connection.localValues.set(enabled)),
  )
  const unregisterLiveValues = registerLocalWorkOption({
    id: 'otel.localValues',
    label: 'Live values',
    description:
      'Show the original params, payload, state and errors from this page. Downloads and MCP stay masked.',
    checked: liveValues,
  })
  const unmountView = ADMIN_FRAME.run(() =>
    mountAdminView(host, connection.admin, connection, { floating: true }),
  )
  return () => {
    unmountView()
    unregisterLiveValues()
    stopLiveValuesSync()
    connection.dispose()
    host.remove()
  }
}
