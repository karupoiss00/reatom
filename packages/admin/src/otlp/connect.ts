import {
  atom,
  bind,
  effect,
  reatomBoolean,
  withLocalStorage,
  type Atom,
} from '@reatom/core'

import { canPersistToLocalStorage } from '../filters/persistence'
import { ADMIN_FRAME } from '../root'
import { registerLocalWorkOption } from '../view/settings'
import { reatomOtlpAdmin, type OtlpAdmin } from './chrome'
import type { AdminLocalValues, AdminRecord } from './ingest'

export const ADMIN_CLEAR_UNDO_MS = 8_000

const DEFAULT_MAX_QUEUE_SIZE = 1000
const WARN_CONTEXT_LOSS_ID = 'otel.warnContextLoss'
const SPLIT_LONG_TRACES_ID = 'otel.splitLongTraces'
const WARN_CONTEXT_LOSS_KEY = `_Admin.settings.tracing.${WARN_CONTEXT_LOSS_ID}.v1`
const SPLIT_LONG_TRACES_KEY = `_Admin.settings.tracing.${SPLIT_LONG_TRACES_ID}.v1`

export interface AdminOtelOptionsSnapshot {
  endpoint: string | null
  serviceName: string
  serviceVersion?: string
  environment?: string
  resource?: Record<string, unknown>
  keepRecords?: boolean
  maxQueueSize?: number
  /** `true` keeps live references subject to opt-out. `'all'` ignores opt-out. */
  localValues?: boolean | 'all'
  /** `true` warns when a callback without `wrap` starts a new trace. */
  warnContextLoss?: boolean
  /**
   * Span count that starts a linked trace. `Infinity` disables the limit. The
   * tracer default is 1000.
   */
  maxSpansPerTrace?: number
  /**
   * Milliseconds that start a linked trace. `Infinity` disables the limit. The
   * tracer default is 60000.
   */
  maxTraceMs?: number
}

export interface AdminOtelStats {
  queued: number
  inFlight: number
  exported: number
  dropped: number
  droppedByReason: Readonly<Record<string, number>>
  transportQuarantined: boolean
}

/**
 * Structural view of a `reatomOpentelemetry()` instance. `@reatom/admin` does
 * not import `@reatom/opentelemetry`; stories and tests pass the live instance
 * or a fake with this shape.
 */
export interface AdminOtelInstance {
  records: {
    (): readonly unknown[]
    subscribe(listener: (records: readonly unknown[]) => void): () => void
  }
  clearRecords(): void
  options: {
    (): AdminOtelOptionsSnapshot
    set(
      update:
        | AdminOtelOptionsSnapshot
        | ((current: AdminOtelOptionsSnapshot) => AdminOtelOptionsSnapshot),
    ): unknown
  }
  stats(): AdminOtelStats
  /**
   * Live references for a raw record from `records()`. Absent on older
   * instances; admin then keeps masked attributes only.
   */
  localValuesOf?(record: unknown): AdminLocalValues | undefined
}

export interface ConnectAdminOptions {
  host?: HTMLElement
  /**
   * Written to `otel.options.localValues` while connected. Default `true`.
   * `false` stops attaching new live values. `'all'` asks the instance to
   * ignore per-target opt-out.
   */
  localValues?: boolean | 'all'
  /**
   * Register the tracing switches and forward them to `otel.options`. Default
   * `true`. `false` skips registration and leaves those options untouched, for
   * hosts that render their own controls.
   */
  tracingSettings?: boolean
}

export interface AdminConnection {
  admin: OtlpAdmin
  show: () => void
  hide: () => void
  dispose: () => void
  setHost: (host: HTMLElement | undefined) => void
  pause: () => void
  resume: () => void
  paused: Atom<boolean>
  waiting: Atom<number>
  clear: () => void
  undo: () => void
  canUndo: Atom<boolean>
  olderRecordsDropped: Atom<boolean>
  stats: Atom<AdminOtelStats | null>
  refreshStats: () => void
  /** Mode forwarded to `otel.options.localValues`. Bind this from settings. */
  localValues: Atom<boolean | 'all'>
  /** True after the store drops live values past its limit. */
  localValuesTrimmed: Atom<boolean>
  /**
   * `true` writes `otel.options.warnContextLoss`. Default is the instance
   * value, or `true` when that value is absent. A persisted choice wins.
   */
  warnContextLoss: Atom<boolean>
  /**
   * `true` writes the connect-time `maxSpansPerTrace` and `maxTraceMs`
   * (`undefined` keeps the tracer default). `false` writes `Infinity` for
   * both.
   */
  splitLongTraces: Atom<boolean>
}

export function resourceFromOtelOptions(
  options: AdminOtelOptionsSnapshot,
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    'service.name': options.serviceName,
  }
  if (typeof options.serviceVersion === 'string') {
    resource['service.version'] = options.serviceVersion
  }
  if (typeof options.environment === 'string') {
    resource['deployment.environment.name'] = options.environment
  }
  if (options.resource) Object.assign(resource, options.resource)
  return resource
}

/**
 * Live connection from an in-page OpenTelemetry instance into
 * `reatomOtlpAdmin`.
 *
 * Call it in the app frame. `records.subscribe`, `clearRecords`, `options.set`,
 * and `stats` run there. Ingest runs inside `ADMIN_FRAME`. Pass `options.host`
 * (or `setHost` later) so Escape inside that element is `preventDefault`ed
 * during capture. Headless connects skip the listener until a host is passed.
 *
 * When `endpoint` is not `null`, `keepRecords` is turned on before subscribe
 * and restored on dispose. Records that were dropped while `keepRecords` was
 * off are not backfilled. `endpoint: null` already keeps its window.
 *
 * `localValues` (default `true`) is written to `otel.options.localValues`
 * whenever that atom changes, including the initial value, and the previous
 * option is restored on dispose. When the mode is not `false` and the instance
 * has `localValuesOf`, ingest attaches those live references. Turning the atom
 * off stops attaching new values and leaves ones already stored. An instance
 * without `localValuesOf` still accepts the atom and the option write.
 * `localValuesTrimmed` is the store flag set after the oldest live values are
 * dropped past the store limit.
 *
 * Unless `tracingSettings` is `false`, two Local work switches are registered
 * and forwarded to `otel.options` on connect and on every change. A persisted
 * choice wins over the instance. `dispose` restores the previous tracing
 * options and unregisters those switches.
 *
 * @example
 *   const connection = connectAdmin(otel, { host })
 *   connection.pause()
 *   connection.resume()
 *   connection.clear()
 *   connection.undo()
 *   connection.dispose()
 */
export function connectAdmin(
  otel: AdminOtelInstance,
  options: ConnectAdminOptions = {},
): AdminConnection {
  const runInAppFrame = bind(<Result>(callback: () => Result) => callback())
  let active = true
  let otelRef: AdminOtelInstance | undefined = otel
  const initial = runInAppFrame(() => otel.options())
  const restoreKeepRecords = initial.endpoint !== null
  const previousKeepRecords = initial.keepRecords
  const previousLocalValues = initial.localValues
  const previousWarnContextLoss = initial.warnContextLoss
  const previousMaxSpansPerTrace = initial.maxSpansPerTrace
  const previousMaxTraceMs = initial.maxTraceMs
  const tracingSettings = options.tracingSettings !== false
  if (restoreKeepRecords) {
    runInAppFrame(() => {
      otel.options.set((current) => ({ ...current, keepRecords: true }))
    })
  }

  const resource = resourceFromOtelOptions(runInAppFrame(() => otel.options()))
  const serviceName = resource['service.name']
  const admin = reatomOtlpAdmin({
    sourceId:
      typeof serviceName === 'string' && serviceName !== ''
        ? serviceName
        : 'live',
    resource,
    onClear: () => {
      if (!active || otelRef === undefined) return
      runInAppFrame(() => otelRef?.clearRecords())
    },
  })

  const controls = ADMIN_FRAME.run(() => {
    const warnContextLoss = reatomBoolean(
      previousWarnContextLoss ?? true,
      '_Admin.connect.warnContextLoss',
    )
    const splitLongTraces = reatomBoolean(
      true,
      '_Admin.connect.splitLongTraces',
    )
    if (canPersistToLocalStorage()) {
      warnContextLoss.extend(withLocalStorage(WARN_CONTEXT_LOSS_KEY))
      splitLongTraces.extend(withLocalStorage(SPLIT_LONG_TRACES_KEY))
    }
    return {
      paused: atom(false, '_Admin.connect.paused'),
      waiting: atom(0, '_Admin.connect.waiting'),
      olderRecordsDropped: atom(false, '_Admin.connect.olderRecordsDropped'),
      canUndo: atom(false, '_Admin.connect.canUndo'),
      stats: atom<AdminOtelStats | null>(null, '_Admin.connect.stats'),
      localValues: atom<boolean | 'all'>(
        options.localValues ?? true,
        '_Admin.connect.localValues',
      ),
      warnContextLoss,
      splitLongTraces,
    }
  })

  let last: unknown = null
  let latestWindow: readonly unknown[] | null = null
  let pausedFlag = false
  let cancelScheduled: (() => void) | undefined
  let undoSnapshot: AdminRecord[] | null = null
  let undoTimer: ReturnType<typeof setTimeout> | undefined
  let host = options.host
  let concealed = false
  let escapeListening = false

  const maxQueueSize = () => {
    const value = runInAppFrame(() => otelRef?.options().maxQueueSize)
    return typeof value === 'number' && value > 0
      ? value
      : DEFAULT_MAX_QUEUE_SIZE
  }

  const deltaOf = (windowRecords: readonly unknown[]) => {
    if (last === null) {
      return { records: [...windowRecords], dropped: false }
    }
    const index = windowRecords.lastIndexOf(last)
    if (index === -1) {
      return {
        records: [...windowRecords],
        dropped: windowRecords.length === maxQueueSize(),
      }
    }
    return { records: windowRecords.slice(index + 1), dropped: false }
  }

  const publishWaiting = () => {
    const count =
      latestWindow === null ? 0 : deltaOf(latestWindow).records.length
    ADMIN_FRAME.run(() => controls.waiting.set(count))
  }

  const refreshStats = () => {
    if (!active || otelRef === undefined) return
    const next = runInAppFrame(() => otelRef!.stats())
    ADMIN_FRAME.run(() => controls.stats.set(next))
  }

  const flushNow = () => {
    if (!active || otelRef === undefined || latestWindow === null) return
    const delta = deltaOf(latestWindow)
    if (delta.dropped) {
      ADMIN_FRAME.run(() => controls.olderRecordsDropped.set(true))
    }
    const viewingLive = ADMIN_FRAME.run(() => admin.source() === 'live')
    if (!viewingLive || delta.records.length === 0) {
      publishWaiting()
      refreshStats()
      return
    }
    const nextResource = resourceFromOtelOptions(
      runInAppFrame(() => otelRef!.options()),
    )
    const ingested = ADMIN_FRAME.run(() => {
      if (admin.paused()) return false
      admin.setResource(nextResource)
      admin.ingest(delta.records)
      return true
    })
    if (!ingested) return
    last = delta.records[delta.records.length - 1]
    publishWaiting()
    refreshStats()
  }

  const schedule = () => {
    if (!active || pausedFlag || cancelScheduled !== undefined) return
    const run = () => {
      cancelScheduled = undefined
      if (!active || pausedFlag) return
      flushNow()
    }
    const hidden = typeof document !== 'undefined' && document.hidden === true
    if (hidden || typeof requestAnimationFrame !== 'function') {
      const id = setTimeout(run, 0)
      cancelScheduled = () => {
        clearTimeout(id)
        cancelScheduled = undefined
      }
      return
    }
    const id = requestAnimationFrame(run)
    cancelScheduled = () => {
      cancelAnimationFrame(id)
      cancelScheduled = undefined
    }
  }

  const cancelBatch = () => {
    cancelScheduled?.()
  }

  const onWindow = (windowRecords: readonly unknown[]) => {
    if (!active) return
    latestWindow = windowRecords
    if (windowRecords.length === 0) last = null
    publishWaiting()
    if (pausedFlag) return
    schedule()
  }

  const releaseUndo = () => {
    if (undoTimer !== undefined) {
      clearTimeout(undoTimer)
      undoTimer = undefined
    }
    undoSnapshot = null
    ADMIN_FRAME.run(() => controls.canUndo.set(false))
  }

  const holdUndo = (snapshot: AdminRecord[]) => {
    if (undoTimer !== undefined) clearTimeout(undoTimer)
    undoSnapshot = snapshot
    ADMIN_FRAME.run(() => controls.canUndo.set(true))
    undoTimer = setTimeout(() => {
      undoTimer = undefined
      undoSnapshot = null
      if (active) ADMIN_FRAME.run(() => controls.canUndo.set(false))
    }, ADMIN_CLEAR_UNDO_MS)
  }

  const pause = () => {
    if (!active) return
    pausedFlag = true
    cancelBatch()
    ADMIN_FRAME.run(() => controls.paused.set(true))
    publishWaiting()
  }

  const resume = () => {
    if (!active) return
    pausedFlag = false
    ADMIN_FRAME.run(() => controls.paused.set(false))
    schedule()
  }

  const clear = () => {
    if (!active) return
    const snapshot = ADMIN_FRAME.run(() => admin.records().slice())
    holdUndo(snapshot)
    cancelBatch()
    const viewingLive = ADMIN_FRAME.run(() => admin.source() === 'live')
    if (!viewingLive) {
      ADMIN_FRAME.run(() => {
        controls.olderRecordsDropped.set(false)
        admin.clear()
      })
      if (ADMIN_FRAME.run(() => admin.source() === 'live')) schedule()
      else publishWaiting()
      refreshStats()
      return
    }
    last = null
    latestWindow = []
    ADMIN_FRAME.run(() => {
      controls.olderRecordsDropped.set(false)
      controls.waiting.set(0)
      admin.store.clear()
      admin.resetSelection()
    })
    refreshStats()
  }

  const undo = () => {
    const snapshot = undoSnapshot
    if (!snapshot || !active) return
    releaseUndo()
    ADMIN_FRAME.run(() => admin.restoreRecords(snapshot))
  }

  const onKeyDown = (event: Event) => {
    const keyEvent = event as KeyboardEvent
    if (keyEvent.key !== 'Escape' || host === undefined) return
    if (typeof keyEvent.composedPath !== 'function') return
    if (!keyEvent.composedPath().includes(host)) return
    keyEvent.preventDefault()
  }

  const unlisten = () => {
    if (!escapeListening || typeof window === 'undefined') return
    window.removeEventListener('keydown', onKeyDown, true)
    escapeListening = false
  }

  const listen = () => {
    if (
      escapeListening ||
      host === undefined ||
      typeof window === 'undefined'
    ) {
      return
    }
    window.addEventListener('keydown', onKeyDown, true)
    escapeListening = true
  }

  const show = () => {
    concealed = false
    if (host) host.hidden = false
  }

  const hide = () => {
    concealed = true
    if (host) host.hidden = true
  }

  const setHost = (next: HTMLElement | undefined) => {
    if (!active) return
    unlisten()
    host = next
    if (host) host.hidden = concealed
    listen()
  }

  const syncLocalValues = (mode: boolean | 'all') => {
    const instance = otelRef
    if (!active || instance === undefined) return
    runInAppFrame(() => {
      instance.options.set((current) => ({ ...current, localValues: mode }))
    })
    const lookup =
      mode !== false && typeof instance.localValuesOf === 'function'
        ? (raw: unknown) => runInAppFrame(() => instance.localValuesOf?.(raw))
        : undefined
    admin.setLocalValues(lookup)
  }

  const stopLocalValues = ADMIN_FRAME.run(() =>
    effect(() => {
      syncLocalValues(controls.localValues())
    }, '_Admin.connect.syncLocalValues'),
  )

  const syncTracing = (warn: boolean, split: boolean) => {
    const instance = otelRef
    if (!active || instance === undefined) return
    runInAppFrame(() => {
      instance.options.set((current) => ({
        ...current,
        warnContextLoss: warn,
        maxSpansPerTrace: split ? previousMaxSpansPerTrace : Infinity,
        maxTraceMs: split ? previousMaxTraceMs : Infinity,
      }))
    })
  }

  const stopTracing = tracingSettings
    ? ADMIN_FRAME.run(() =>
        effect(() => {
          syncTracing(controls.warnContextLoss(), controls.splitLongTraces())
        }, '_Admin.connect.syncTracing'),
      )
    : undefined

  const unregisterTracing = tracingSettings
    ? [
        registerLocalWorkOption({
          id: WARN_CONTEXT_LOSS_ID,
          label: 'Warn about lost trace context',
          description:
            'Warn when a span starts without its parent, so a missing wrap is visible.',
          checked: controls.warnContextLoss,
        }),
        registerLocalWorkOption({
          id: SPLIT_LONG_TRACES_ID,
          label: 'Split long traces',
          description:
            'Break traces at the span or age limit so the gantt stays readable.',
          checked: controls.splitLongTraces,
        }),
      ]
    : []

  const unsubscribe = runInAppFrame(() => otel.records.subscribe(onWindow))
  listen()

  const dispose = () => {
    if (!active) return
    active = false
    stopLocalValues.unsubscribe()
    stopTracing?.unsubscribe()
    for (const unregister of unregisterTracing) unregister()
    runInAppFrame(unsubscribe)
    cancelBatch()
    unlisten()
    if (otelRef) {
      const restoreKeep = restoreKeepRecords
      const previousKeep = previousKeepRecords
      const previousValues = previousLocalValues
      const tracingRestore = tracingSettings
        ? {
            warnContextLoss: previousWarnContextLoss,
            maxSpansPerTrace: previousMaxSpansPerTrace,
            maxTraceMs: previousMaxTraceMs,
          }
        : {}
      runInAppFrame(() => {
        otelRef?.options.set((current) => ({
          ...current,
          ...(restoreKeep ? { keepRecords: previousKeep } : {}),
          localValues: previousValues,
          ...tracingRestore,
        }))
      })
    }
    releaseUndo()
    ADMIN_FRAME.run(() => admin.disposeModel())
    if (host) host.hidden = false
    last = null
    latestWindow = null
    host = undefined
    otelRef = undefined
  }

  return {
    admin,
    show,
    hide,
    dispose,
    setHost,
    pause,
    resume,
    paused: controls.paused,
    waiting: controls.waiting,
    clear,
    undo,
    canUndo: controls.canUndo,
    olderRecordsDropped: controls.olderRecordsDropped,
    stats: controls.stats,
    refreshStats,
    localValues: controls.localValues,
    localValuesTrimmed: admin.localValuesTrimmed,
    warnContextLoss: controls.warnContextLoss,
    splitLongTraces: controls.splitLongTraces,
  }
}
