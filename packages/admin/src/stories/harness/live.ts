import { noop, urlAtom } from '@reatom/core'

import { connectAdmin, type AdminConnection } from '../../otlp'
import { ADMIN_FRAME } from '../../root'
import {
  registerStoryCleanup,
  setCurrentConnection,
} from '../../testing/storybook-runtime'
import { mountAdminView } from '../../view/otlp'
import { storyOtel } from './otel'

export interface LiveAdminMount {
  connection: AdminConnection
  host: HTMLElement
  /** Example application root, outside the admin shadow host. */
  appRoot: HTMLElement
  unmountAdmin: () => void
}

/**
 * Clears the story sink, connects the admin in the app frame, and mounts the
 * Gantt UI in a floating shadow host over the page. Call it after any
 * `context.reset()`, then mount the example into `appRoot`.
 */
export function connectLiveAdmin(): LiveAdminMount {
  urlAtom.sync.set(() => noop)
  urlAtom.catchLinks.set(false)
  ADMIN_FRAME.run(() => {
    urlAtom.sync.set(() => noop)
    urlAtom.catchLinks.set(false)
  })
  storyOtel.clearRecords()

  const host = document.createElement('div')
  host.dataset.adminHost = ''

  const connection = connectAdmin(storyOtel, { host })
  setCurrentConnection(connection)
  const unmountAdmin = ADMIN_FRAME.run(() =>
    mountAdminView(host, connection.admin, connection, { floating: true }),
  )

  registerStoryCleanup(() => {
    unmountAdmin()
    connection.dispose()
    setCurrentConnection(null)
    host.remove()
  })

  const appRoot = document.createElement('div')
  appRoot.dataset.appRoot = ''
  appRoot.style.minHeight = '0'
  appRoot.style.minWidth = '0'
  return { connection, host, appRoot, unmountAdmin }
}
