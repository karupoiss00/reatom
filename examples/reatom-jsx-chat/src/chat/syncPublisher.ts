import { onRuntimeReset } from '../platform/runtime'
import { syncBus } from '../sync'
import type { SyncBus, SyncEvent } from '../sync/types'

let publisher: SyncBus = syncBus

export const injectSyncPublisher = (next: SyncBus): (() => void) => {
  const previous = publisher
  publisher = next
  const restore = () => {
    if (publisher === next) publisher = previous
  }
  onRuntimeReset(restore)
  return restore
}

export const publishSync = (event: SyncEvent): void => {
  publisher.publish(event)
}
