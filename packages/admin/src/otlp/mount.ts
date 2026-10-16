import type { AdminRecord } from './ingest'

const CONNECT_HOOK_SUFFIX = '.withConnectHook'
const ACTION_SET_SUFFIX = '.set'

const frameKey = (sourceId: string, frameId: string) => `${sourceId}:${frameId}`

/**
 * Ids of the update logs that only exist because an atom was read or connected
 * (mounted), not because something wrote to it.
 *
 * - A `reatom.computed.update` with no causes. A recompute always lists the
 *   dependency that changed, so a log without causes is a first read or a
 *   reconnect.
 * - A `reatom.atom.update` whose every cause is a `*.withConnectHook` frame, such
 *   as a storage restore on connect. A plain atom read emits no log.
 *
 * A record whose name ends with `.set` is a write and never a mount log. Spans
 * are never mount logs, so the connect hook span itself stays visible.
 */
export function mountLogIds(records: readonly AdminRecord[]): Set<string> {
  const connectHookFrames = new Set<string>()
  for (const record of records) {
    if (
      record.kind === 'span' &&
      record.frameId !== undefined &&
      record.name.endsWith(CONNECT_HOOK_SUFFIX)
    ) {
      connectHookFrames.add(frameKey(record.sourceId, record.frameId))
    }
  }

  const ids = new Set<string>()
  for (const record of records) {
    if (record.kind !== 'log') continue
    const name = record.atomName ?? record.name
    if (name.endsWith(ACTION_SET_SUFFIX)) continue
    const isFirstComputation =
      record.eventName === 'reatom.computed.update' &&
      record.causeIds.length === 0
    const isConnectHookWrite =
      record.eventName === 'reatom.atom.update' &&
      record.causeIds.length > 0 &&
      record.causeIds.every((causeId) =>
        connectHookFrames.has(frameKey(record.sourceId, causeId)),
      )
    if (isFirstComputation || isConnectHookWrite) ids.add(record.id)
  }
  return ids
}
