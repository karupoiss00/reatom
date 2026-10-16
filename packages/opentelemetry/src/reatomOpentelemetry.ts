import type { Action, Atom, AtomLike, Ext, Variable } from '@reatom/core'
import {
  action,
  atom,
  EXTENSIONS,
  isAbort,
  isAction,
  onLineAtom,
  removeItem,
  STACK,
  top,
  variable,
} from '@reatom/core'

import {
  buildExportPayload,
  buildLogsPayload,
  buildResource,
} from './buildExportPayload.ts'
import {
  buildLogRecord,
  selectLogsUnloadBatch,
  type LogRecordInput,
  type OtlpLogRecord,
} from './buildLogRecord.ts'
import type { OtlpSpan, SpanInput } from './buildSpan.ts'
import { buildSpan, MAX_RECORD_BYTES } from './buildSpan.ts'
import type { Serialize } from './captureValues.ts'
import { createValueCapture } from './captureValues.ts'
import { preserveTracerConsent, tracerSignalEnabled } from './consentPolicy.ts'
import type { Reservation, TelemetryStats } from './createBatchQueue.ts'
import { createBatchQueue } from './createBatchQueue.ts'
import { createExportWorker } from './createExportWorker.ts'
import { createTraceContext } from './createTrace.ts'
import { errorData, exceptionType } from './errorMetadata.ts'
import { flushWithBeacon } from './flushWithBeacon.ts'
import { hexFromBytes } from './hexFromBytes.ts'
import {
  registerInstance,
  unregisterInstance,
  type LogEmission,
  type RegisteredInstance,
} from './instanceRegistry.ts'
import { isObserving, observe, suppressTracing } from './observation.ts'
import { readExportResponse } from './parseExportResponse.ts'
import { resolveQueueOptions } from './queueOptions.ts'
import { resourceAttributesVar } from './resourceAttributesVar.ts'
import type { RetryWithBackoffInput } from './retryWithBackoff.ts'
import { retryWithBackoff } from './retryWithBackoff.ts'
import {
  createRouteRootMachine,
  DEFAULT_ROOTS,
  type OtlpSpanLink,
  type RootKind,
  type RouteMode,
} from './roots/route.ts'
import { SESSION_KIND, SESSION_SPAN_NAME } from './roots/session.ts'
import {
  ErrorRing,
  TraceSampler,
  otlpSpanFlags,
  resolveSampling,
  type SamplingInput,
} from './sampling.ts'
import { selectUnloadBatch } from './selectUnloadBatch.ts'
import {
  formatTraceparent,
  parseTraceparent as parseTraceparentHeader,
} from './traceparent.ts'
import type {
  Transport,
  TransportBatch,
  TransportResult,
} from './sendTraces.ts'
import { sendSignal } from './sendTraces.ts'
import { toOtlpAttributes, type OtlpAttrValue } from './toOtlpValue.ts'
import type { SpanContext } from './traceContext.ts'
import { availableUnloadBytes, reserveUnloadBytes } from './unloadBudget.ts'
import { defaultWarnContextLoss, isDevelopment } from './devWarnings.ts'
import { mintIdentityId } from './ids.ts'
import {
  createWithOTel,
  isInstrumentationInternalName,
  type RouteRootsAdapter,
  type SpanCommit,
} from './withOTel.ts'
import { isUntracedRoot } from './untracedRoots.ts'
import type { LocalValues, LocalValuesMode } from './localValues.ts'

const encoder = new TextEncoder()
const UNLOAD_BUDGET_BYTES = 60 * 1024
const UNLOAD_NEWEST_KEEP = 8
const REATOM_NAME_DUP_MAX_UTF8 = Math.floor(
  UNLOAD_BUDGET_BYTES / UNLOAD_NEWEST_KEEP / 4,
)

const inIsolatedContextRoot = (): boolean => {
  if (STACK.length === 0) return false
  return top().root !== STACK[0]!.root
}

const resourceSnapshot = (
  capture: ReturnType<typeof createValueCapture>,
  value: Record<string, OtlpAttrValue>,
): Record<string, OtlpAttrValue> => {
  const snapshot = capture.capture('resource', value)
  if (
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot) ||
    snapshot instanceof Uint8Array
  )
    throw new TypeError('Invalid resource attributes')
  return snapshot
}

// Capture has already bounded, copied and removed cycles from these values.
// Sort object keys for grouping while preserving distinctions between types.
const stableKey = (value: OtlpAttrValue | null | undefined): string => {
  if (value === null || value === undefined) return 'x'
  if (typeof value === 'string') return 's' + JSON.stringify(value)
  if (typeof value === 'number') return 'n' + String(value)
  if (typeof value === 'bigint') return 'B' + value.toString()
  if (typeof value === 'boolean') return value ? 'b1' : 'b0'
  if (value instanceof Uint8Array) return 'U' + hexFromBytes(value)
  if (Array.isArray(value)) return 'A[' + value.map(stableKey).join(',') + ']'
  return (
    'O{' +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + stableKey(value[key]))
      .join(',') +
    '}'
  )
}

const TELEMETRY_SDK_NAME = '@reatom/opentelemetry'
const TELEMETRY_SDK_LANGUAGE = 'webjs'
const TELEMETRY_SDK_VERSION = '1000.15.2'

export type TraceContext = {
  traceId: string
  spanId: string
}

export interface CreateTraceOptions {
  name?: string
  attributes?: Record<string, OtlpAttrValue>
}

export interface OtelOptions {
  endpoint: string | null
  transports?: ReadonlyArray<Transport>
  headers?: Record<string, string>
  serviceName: string
  serviceVersion?: string
  environment?: string
  resource?: Record<string, OtlpAttrValue>
  skipGlobalExtension?: boolean
  filter?: (target: AtomLike) => boolean
  extend?: (
    target: AtomLike,
    withOTel: ReatomOpentelemetry['withOTel'],
  ) => AtomLike
  captureValues?: ReatomOpentelemetryInput['captureValues']
  /**
   * Category booleans from `reatomGDPR` submit. Absent until a choice is
   * submitted. Explicit `diagnostics: false` holds tracer export. A record with
   * no `diagnostics` key does not.
   */
  consent?: Record<string, boolean>
  /**
   * Per-signal kill switches the app owns. Absent leaves that signal on.
   * `false` stops that signal even after a diagnostics grant. `reatomGDPR` does
   * not write these; `otel.log` honors `logs: false`.
   */
  signals?: { traces?: boolean; logs?: boolean }
  keepRecords?: boolean
  /**
   * Plain references for in-app devtools, beside locally kept records. Never
   * exported, never masked, never copied. Default `false`. Ignored unless
   * `endpoint` is `null` or `keepRecords` is on. `true` still honors per-target
   * `withOTel({ captureValues: false })`; `'all'` does not.
   */
  localValues?: LocalValuesMode
  batchInterval?: number
  maxBatchSize?: number
  maxQueueSize?: number
  exportTimeoutMs?: number
  useBeacon?: boolean
  retry?: ReatomOpentelemetryInput['retry']
  version?: string
  sampling?: SamplingInput
  roots?: ReadonlyArray<RootKind>
  route?: RouteMode
  warnContextLoss?: boolean
  /**
   * Spans kept on one trace before the next span starts a continuation.
   * Default 1000. `Infinity` disables the count.
   */
  maxSpansPerTrace?: number
  /**
   * Milliseconds after a trace's first span before the next span starts a
   * continuation. Default 60000. `Infinity` disables the age limit.
   */
  maxTraceMs?: number
}

const randomInstanceId = () => mintIdentityId()

const browserResourceAttributes = (): Record<string, OtlpAttrValue> => {
  if (typeof navigator === 'undefined') return {}
  const uaData = (
    navigator as Navigator & {
      userAgentData?: {
        brands?: ReadonlyArray<{ brand: string; version: string }>
        platform?: string
        mobile?: boolean
      }
    }
  ).userAgentData
  if (!uaData) return {}
  const attributes: Record<string, OtlpAttrValue> = {}
  if (typeof navigator.language === 'string' && navigator.language) {
    attributes['browser.language'] = navigator.language
  }
  if (uaData.brands?.length) {
    attributes['browser.brands'] = uaData.brands.map(
      (brand) => `${brand.brand} ${brand.version}`,
    )
  }
  if (uaData.platform) attributes['browser.platform'] = uaData.platform
  if (typeof uaData.mobile === 'boolean') {
    attributes['browser.mobile'] = uaData.mobile
  }
  return attributes
}

export interface ReatomOpentelemetryInput {
  name: string
  endpoint: string | null
  serviceName: string
  serviceVersion?: string
  environment?: string
  /**
   * Skip automatic action spans and automatic atom/computed update logs.
   * Explicit `withOTel()` still records.
   */
  skipGlobalExtension?: boolean
  extend?: (
    target: AtomLike,
    withOTel: ReatomOpentelemetry['withOTel'],
  ) => AtomLike
  /**
   * Keep a bounded in-memory copy of admitted records even when `endpoint` is a
   * real collector. `endpoint: null` already fills `records`. `clearRecords`
   * drops those references.
   */
  keepRecords?: boolean
  /**
   * Plain references for in-app devtools, beside locally kept records. Never
   * exported, never masked, never copied. Default `false`. Ignored unless
   * `endpoint` is `null` or `keepRecords` is on. `true` still honors per-target
   * `withOTel({ captureValues: false })`; `'all'` does not.
   */
  localValues?: LocalValuesMode
  /**
   * Extra destinations invoked by `transport` in addition to the default
   * `endpoint` fetch. `endpoint` + `headers` stay the primary OTLP path.
   */
  transports?: ReadonlyArray<Transport>
  /**
   * Construction-time defaults. For per-trace runtime overrides set
   * `resourceAttributesVar`.
   */
  resourceAttributes?: Record<string, OtlpAttrValue>
  /**
   * Capture bounded snapshots of application values. Enabled by default with
   * sensitive-key redaction. Pass `false` to disable. A redaction failure
   * discards the complete span.
   */
  captureValues?: false | { redact?: (key: string, value: unknown) => unknown }
  /**
   * Replace the per-key value transform used during capture. Sensitive keys are
   * still masked after this hook returns. A throw discards the span.
   */
  serialize?: Serialize
  headers?: Record<string, string>
  /**
   * Selects automatic action spans and atom/computed update logs. Names
   * starting with `analytics.` or `otel.` are already excluded. Filtered
   * targets retain the surrounding synchronous scope. Explicit `withOTel()`
   * still records. Ordinary core bind/wrap do not capture this scope.
   */
  filter?: (target: AtomLike) => boolean
  batchInterval?: number
  maxBatchSize?: number
  maxQueueSize?: number
  /** Budget for each batch export and, separately, each flush caller. */
  exportTimeoutMs?: number
  /**
   * Opt-in to `navigator.sendBeacon` for unload-time delivery. Default:
   * `false`.
   *
   * Beacon cannot carry custom auth headers. Both transports are subject to
   * CORS and a shared browser keepalive budget; delivery is best effort.
   * Accepted beacon bytes remain charged for this document's lifetime.
   */
  useBeacon?: boolean
  /**
   * Tune the retry behavior of OTLP exports. Defaults follow the OTLP spec
   * recommendation: 3 retries, 1s base, 30s cap, full jitter.
   */
  retry?: Pick<
    RetryWithBackoffInput,
    'maxRetries' | 'baseDelayMs' | 'maxDelayMs'
  >
  sampling?: SamplingInput
  /**
   * Instrumentation scope version emitted on every batch. Recommended: pass
   * your app or library version so collectors can distinguish releases.
   * Defaults to empty string (OTLP-valid but groups all batches under one
   * "@reatom/opentelemetry@" bucket on the collector side).
   */
  version?: string
  /** Internal — injection point for tests. */
  fetch?: typeof globalThis.fetch
  /** Internal — injection point for tests. */
  sendBeacon?: (url: string, data: BodyInit) => boolean
  /**
   * Automatic roots. Default: route, mount, action, atom. `[]` turns the
   * machines off; app-session and manual `createTrace` remain.
   */
  roots?: ReadonlyArray<RootKind>
  /**
   * How a top-level action joins the page trace. Default `'child'`. `'link'`
   * mints a new `traceId` and points at the page span.
   */
  route?: RouteMode
  /**
   * Warn once per target when a call mints a fallback action root from outside
   * a Reatom frame while another trace is active in the same task (missing
   * `wrap`). Default: on in development (`NODE_ENV` of `development` or `test`,
   * or `import.meta.env.DEV` when `NODE_ENV` is unset). Off in production and
   * when neither signal is set, so a browser bundle does not warn.
   */
  warnContextLoss?: boolean
  /**
   * Spans kept on one trace before the next span starts a continuation.
   * Default 1000. `Infinity` disables the count.
   */
  maxSpansPerTrace?: number
  /**
   * Milliseconds after a trace's first span before the next span starts a
   * continuation. Default 60000. `Infinity` disables the age limit.
   */
  maxTraceMs?: number
}

export interface ReatomOpentelemetry {
  /** Construction-time instance name. Default `storageKey` for web analytics. */
  readonly name: string
  options: Atom<OtelOptions>
  withOTel: ReturnType<typeof createWithOTel>['withOTel']
  traceVar: Variable<TraceContext, [TraceContext]>
  attributesVar: Variable<Record<string, OtlpAttrValue>>
  createTrace: (options?: CreateTraceOptions) => TraceContext
  traceparent: () => string | undefined
  parseTraceparent: (
    header: string | null | undefined,
  ) => TraceContext | undefined
  /** Route page pair after a route root, or undefined when none is open. */
  pageTrace: () => TraceContext | undefined
  records: Atom<readonly unknown[]>
  /**
   * Live JavaScript values for a locally kept record. Plain references, never
   * copied, masked, or included in the exported payload. `undefined` for
   * non-objects and unknown records.
   */
  localValuesOf(record: unknown): LocalValues | undefined
  clearRecords: Action<[], void>
  log: (eventName: string, attributes?: Record<string, OtlpAttrValue>) => void
  /** One batch delivery; extend or pass `transports` to fan out. */
  transport: Action<[TransportBatch], Promise<TransportResult>>
  /** Wait for finished records present at invocation, up to exportTimeoutMs. */
  flush: () => Promise<void>
  /** Immutable snapshot of capacity, delivery and losses. */
  stats: () => TelemetryStats
  /** Stop new observation and batching; request abort of in-flight export. */
  dispose: () => void
}

type Tracing = ReturnType<typeof createWithOTel>

type InstanceInternals = {
  recordedExceptions: WeakSet<object>
  rateLimitDrops: { count: number }
  currentTrace: Tracing['currentTrace']
  runInTrace: Tracing['runInTrace']
}

const internalsByInstance = new WeakMap<
  ReatomOpentelemetry,
  InstanceInternals
>()

export const recordedExceptionsOf = (instance: ReatomOpentelemetry) =>
  internalsByInstance.get(instance)?.recordedExceptions

export const currentTraceOf = (instance: ReatomOpentelemetry) =>
  internalsByInstance.get(instance)?.currentTrace()

export const runInTraceOf = <Result>(
  instance: ReatomOpentelemetry,
  pair: SpanContext | undefined,
  callback: () => Result,
): Result => {
  const internals = internalsByInstance.get(instance)
  return internals ? internals.runInTrace(pair, callback) : callback()
}

export const countRateLimitDrop = (instance: ReatomOpentelemetry) => {
  const internals = internalsByInstance.get(instance)
  if (!internals) return
  internals.rateLimitDrops.count++
}

export const resetRateLimitDrops = (instance: ReatomOpentelemetry) => {
  const internals = internalsByInstance.get(instance)
  if (!internals) return
  internals.rateLimitDrops.count = 0
}

const assertEndpoint = (endpoint: string | null, instanceName: string) => {
  if (endpoint === '') {
    throw new Error(
      `[@reatom/opentelemetry] endpoint must be a non-empty string or null for instance "${instanceName}"`,
    )
  }
  if (endpoint !== null && !isAbsoluteHttpUrl(endpoint)) {
    const message = `[@reatom/opentelemetry] endpoint must be an absolute http(s) URL or null for instance "${instanceName}", received ${JSON.stringify(endpoint)}`
    if (isDevelopment()) console.warn(message)
    throw new Error(message)
  }
}

const isAbsoluteHttpUrl = (endpoint: string): boolean => {
  try {
    const url = new URL(endpoint)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.host.length > 0
    )
  } catch {
    return false
  }
}

/**
 * Install tracing before creating application actions. Values are captured by
 * default with sensitive-key redaction; pass captureValues: false to disable.
 * Existing targets require local withOTel. Flush before disposal when delivery
 * should be attempted at shutdown.
 */
export const reatomOpentelemetry = (
  input: ReatomOpentelemetryInput,
): ReatomOpentelemetry => {
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new Error('[@reatom/opentelemetry] name is required')
  }
  if (!('endpoint' in input) || input.endpoint === undefined) {
    throw new Error('[@reatom/opentelemetry] endpoint is required')
  }
  assertEndpoint(input.endpoint, input.name)
  const name = input.name
  const creationSite = new Error(
    `[@reatom/opentelemetry] instance "${name}" created`,
  )
  const queueOptions = resolveQueueOptions(input)
  const pageDocument = typeof document === 'undefined' ? undefined : document
  const instanceId = randomInstanceId()
  const recordsSink: unknown[] = []
  let applySignalTransition: (
    previous: OtelOptions,
    next: OtelOptions,
    root: object,
  ) => void = () => {}
  const { options, records, clearRecords, traceVar, attributesVar } =
    suppressTracing(() => {
      const options = atom<OtelOptions>(
        {
          endpoint: input.endpoint,
          headers: input.headers,
          serviceName: input.serviceName,
          serviceVersion: input.serviceVersion,
          environment: input.environment,
          resource: input.resourceAttributes,
          skipGlobalExtension: input.skipGlobalExtension === true,
          filter: input.filter,
          extend: input.extend,
          captureValues: input.captureValues,
          keepRecords: input.keepRecords,
          localValues: input.localValues ?? false,
          transports: input.transports,
          batchInterval: input.batchInterval,
          maxBatchSize: input.maxBatchSize,
          maxQueueSize: input.maxQueueSize,
          exportTimeoutMs: input.exportTimeoutMs,
          useBeacon: input.useBeacon,
          retry: input.retry,
          version: input.version,
          sampling: resolveSampling(input.sampling),
          roots: input.roots,
          route: input.route,
          warnContextLoss: input.warnContextLoss ?? defaultWarnContextLoss(),
          maxSpansPerTrace: input.maxSpansPerTrace ?? 1000,
          maxTraceMs: input.maxTraceMs ?? 60_000,
        } satisfies OtelOptions,
        `otel.${name}.options`,
      )
      const writeOptions = options.set.bind(options)
      options.set = ((
        update: OtelOptions | ((current: OtelOptions) => OtelOptions),
      ) => {
        const current = options()
        const proposed = typeof update === 'function' ? update(current) : update
        const next = preserveTracerConsent(current, proposed)
        assertEndpoint(next.endpoint, name)
        const written = writeOptions(next)
        applySignalTransition(current, next, top().root)
        return written
      }) as typeof options.set
      const records = atom<readonly unknown[]>([], `otel.${name}.records`)
      const clearRecords = action(() => {
        recordsSink.length = 0
        records.set([])
      }, `otel.${name}.clearRecords`)
      const traceVar = variable<TraceContext>(`otel.${name}.trace`)
      const attributesVar = variable<Record<string, OtlpAttrValue>>(
        `otel.${name}.attributes`,
      )
      return { options, records, clearRecords, traceVar, attributesVar }
    })
  // OTel mandate: a tracer must never escalate. Log once, move on.
  // Aborts after dispose() are expected — gate at the single sink so
  // every call site (queue.onError, keepalive .catch) inherits it.
  // `dropped` lets ops correlate failure pressure with traffic — a 1-span
  // drop and a 100-span drop look identical without it.
  const warnedExportKinds = new Set<string>()
  const warnDev = (...args: unknown[]) => {
    if (!isDevelopment()) return
    console.warn(...args)
  }
  const warnOnce = (kind: string, ...args: unknown[]) => {
    if (!isDevelopment()) return
    if (warnedExportKinds.has(kind)) return
    warnedExportKinds.add(kind)
    console.warn(...args)
  }
  const logExportError = (error: unknown, dropped?: readonly unknown[]) =>
    observe(() => {
      if (isAbort(error)) return
      // Transport errors may echo credentials from the request URL.
      const message = errorData(error, 'message')
      const reason =
        typeof message === 'string' && /^HTTP \d{3}$/.test(message)
          ? message
          : exceptionType(error)
      const detail = dropped ? ` (dropped ${dropped.length} spans)` : ''
      warnOnce(
        reason,
        `[@reatom/opentelemetry] OTLP export failed${detail}:`,
        reason,
      )
    })
  const isOffline = (): boolean => {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.onLine !== 'boolean'
    ) {
      return false
    }
    try {
      const online = observe(() => onLineAtom())
      if (typeof online === 'boolean') return !online
    } catch {
      // Fall through to the native flag.
    }
    return navigator.onLine === false
  }
  const resourceAttributes = observe(() => {
    const capture = createValueCapture()
    const current = options()
    const serviceName = capture.capture('service.name', current.serviceName)
    const defaults: Record<string, OtlpAttrValue> = {
      'telemetry.sdk.name': TELEMETRY_SDK_NAME,
      'telemetry.sdk.language': TELEMETRY_SDK_LANGUAGE,
      'telemetry.sdk.version': TELEMETRY_SDK_VERSION,
      'service.instance.id': instanceId,
      ...browserResourceAttributes(),
    }
    if (typeof current.serviceVersion === 'string') {
      defaults['service.version'] = current.serviceVersion
    }
    if (typeof current.environment === 'string') {
      defaults['deployment.environment.name'] = current.environment
    }
    return {
      'service.name': serviceName,
      ...defaults,
      ...resourceSnapshot(capture, current.resource ?? {}),
    }
  })
  const version = input.version ?? ''

  // Each queue item carries its own resourceAttributesVar snapshot so a
  // span dropped at maxQueueSize cannot taint the batch made of survivors.
  // Items are grouped at flush time so spans with different resource
  // attributes go to distinct resourceSpans entries — required by OTLP and
  // critical when traces from multiple environments share one batch window.
  type QueueItem = {
    span: OtlpSpan
    resourceAttributes: Record<string, OtlpAttrValue>
    root: object
  }
  const groupItemsByResource = (
    items: readonly QueueItem[],
  ): Array<{
    resourceAttributes: Record<string, OtlpAttrValue>
    spans: OtlpSpan[]
  }> => {
    const groups = new Map<
      string,
      { resourceAttributes: Record<string, OtlpAttrValue>; spans: OtlpSpan[] }
    >()
    for (const item of items) {
      const key = stableKey(item.resourceAttributes)
      let group = groups.get(key)
      if (!group) {
        group = {
          resourceAttributes: item.resourceAttributes,
          spans: [],
        }
        groups.set(key, group)
      }
      group.spans.push(item.span)
    }
    return [...groups.values()]
  }

  const payload = (items: readonly QueueItem[]) =>
    buildExportPayload({
      groups: groupItemsByResource(items).map((group) => ({
        ...group,
        version,
      })),
    })
  const selectUnload = (items: readonly QueueItem[]) =>
    selectUnloadBatch({
      items,
      maxBytes: availableUnloadBytes(pageDocument!),
      // One complete ResourceSpans group per record allows exact linear sizing.
      encode: (item) => JSON.stringify(payload([item]).resourceSpans[0]),
    })
  const hasExportDestination = () => {
    const current = options()
    return current.endpoint !== null || (current.transports?.length ?? 0) > 0
  }
  const transport = action(
    async (batch: TransportBatch): Promise<TransportResult> => {
      const current = options()
      const extras = current.transports ?? []
      const destinations: Transport[] = []
      if (current.endpoint !== null) {
        const endpoint = current.endpoint
        destinations.push(async (next) => {
          const response = await retryWithBackoff({
            ...input.retry,
            ...(next.keepalive ? { maxRetries: 0 } : {}),
            signal: next.abort,
            deadline: next.deadline,
            send: () =>
              sendSignal({
                endpoint,
                otlpSignal: next.signal,
                payload: next.payload,
                body: next.body,
                headers: current.headers,
                fetch: input.fetch,
                signal: next.abort,
                keepalive: next.keepalive,
              }),
          })
          if (!response.ok) {
            await response.body?.cancel()
            throw new Error(`HTTP ${response.status}`)
          }
          const outcome = await readExportResponse(response, next.itemCount)
          if (outcome.rejected || outcome.errorMessage)
            observe(() =>
              warnOnce(
                'partialSuccess',
                `[@reatom/opentelemetry] OTLP export: partialSuccess rejected ${outcome.rejected} ${next.signal}${outcome.errorMessage ? ': ' + outcome.errorMessage : ''}`,
              ),
            )
          return {
            accepted: outcome.accepted,
            rejected: outcome.rejected,
            ...(outcome.errorMessage === undefined
              ? {}
              : { errorMessage: outcome.errorMessage }),
          }
        })
      }
      destinations.push(...extras)
      if (destinations.length === 0) {
        return { accepted: batch.itemCount, rejected: 0 }
      }
      const [primary, ...rest] = destinations
      const extraJobs = rest.map((destination) =>
        Promise.resolve()
          .then(() => destination(batch))
          .catch((error) => {
            logExportError(error)
            return { accepted: 0, rejected: batch.itemCount }
          }),
      )
      const results = await Promise.all([primary!(batch), ...extraJobs])
      return results[0]!
    },
    `otel.${name}.transport`,
  )
  type OpenFlags = {
    traces: boolean
    logs: boolean
    publicLogs: boolean
  }
  const detachedRoot = {}
  const openByRoot = new WeakMap<object, OpenFlags>()
  const flagsFor = (root: object): OpenFlags => {
    let flags = openByRoot.get(root)
    if (!flags) {
      flags = { traces: true, logs: true, publicLogs: true }
      openByRoot.set(root, flags)
    }
    return flags
  }
  const syncFlags = (root: object, current: OtelOptions): OpenFlags => {
    const flags = flagsFor(root)
    flags.traces = tracerSignalEnabled(current, 'traces')
    flags.logs = tracerSignalEnabled(current, 'logs')
    flags.publicLogs = current.signals?.logs !== false
    return flags
  }
  const rootNow = (): object => {
    try {
      return top().root
    } catch {
      return detachedRoot
    }
  }
  const liveFlags = (): OpenFlags => {
    try {
      return syncFlags(top().root, options())
    } catch {
      return flagsFor(detachedRoot)
    }
  }
  let sessionSpanCommitted = false
  let sessionRoot: object | undefined
  let logsEpoch = 0
  const TRACE_BOUND_LOG = new Set([
    'reatom.atom.update',
    'reatom.computed.update',
    'exception',
    'reatom.log',
  ])
  const worker = createExportWorker<QueueItem>({
    exportTimeoutMs: queueOptions.exportTimeoutMs,
    onError: logExportError,
    onQuarantine: (count) =>
      observe(() =>
        warnDev(
          `[@reatom/opentelemetry] transport did not settle after abort; holding ${count} records`,
        ),
      ),
    send: async (items, { signal, deadline, keepalive, excludeOversized }) => {
      const allowed = items.filter((item) => flagsFor(item.root).traces)
      const blocked = items.length - allowed.length
      const consentDrops = (
        dropped: Partial<Record<'consent' | 'export', number>> = {},
      ) => (blocked > 0 ? { ...dropped, consent: blocked } : dropped)
      if (allowed.length === 0) {
        return {
          exported: 0,
          beaconAccepted: 0,
          droppedByReason: consentDrops(),
        }
      }
      if (!hasExportDestination()) {
        return {
          exported: allowed.length,
          beaconAccepted: 0,
          droppedByReason: consentDrops(),
        }
      }
      let credit: ReturnType<typeof reserveUnloadBytes> | undefined
      let keptCount = allowed.length
      let body: string | undefined
      try {
        if (keepalive) {
          const selected = selectUnload(allowed)
          keptCount = selected.keptCount
          excludeOversized(selected.droppedCount)
          if (keptCount === 0)
            return {
              exported: 0,
              beaconAccepted: 0,
              droppedByReason: consentDrops(),
            }
          body = selected.body
          credit = reserveUnloadBytes(
            pageDocument!,
            encoder.encode(body).length,
          )
        }
        const data = body === undefined ? payload(allowed) : undefined
        const result = await transport({
          signal: 'traces',
          payload: data,
          body,
          keepalive,
          abort: signal,
          itemCount: keptCount,
          deadline,
        })
        return {
          exported: result.accepted,
          beaconAccepted: 0,
          droppedByReason: consentDrops(
            result.rejected ? { export: result.rejected } : {},
          ),
        }
      } finally {
        credit?.release()
      }
    },
  })

  const queue = createBatchQueue<QueueItem>({
    ...queueOptions,
    pauseWhile: isOffline,
    send: (lease) => {
      // A full batch can be committed before the observed execution settles.
      // Transport wrappers may read application state; run them after capture.
      if (isObserving()) queueMicrotask(() => worker.send(lease))
      else worker.send(lease)
    },
    onError: logExportError,
    isQuarantined: worker.isQuarantined,
    onFlushTimeout: (unfinished) =>
      observe(() =>
        warnDev(
          `[@reatom/opentelemetry] flush_timeout: ${unfinished} records unfinished`,
        ),
      ),
  })
  type LogQueueItem = {
    log: OtlpLogRecord
    resourceAttributes: Record<string, OtlpAttrValue>
    root: object
  }
  const groupLogsByResource = (
    items: readonly LogQueueItem[],
  ): Array<{
    resourceAttributes: Record<string, OtlpAttrValue>
    logs: OtlpLogRecord[]
  }> => {
    const groups = new Map<
      string,
      {
        resourceAttributes: Record<string, OtlpAttrValue>
        logs: OtlpLogRecord[]
      }
    >()
    for (const item of items) {
      const key = stableKey(item.resourceAttributes)
      let group = groups.get(key)
      if (!group) {
        group = {
          resourceAttributes: item.resourceAttributes,
          logs: [],
        }
        groups.set(key, group)
      }
      group.logs.push(item.log)
    }
    return [...groups.values()]
  }
  const logsPayload = (items: readonly LogQueueItem[]) =>
    buildLogsPayload({
      groups: groupLogsByResource(items).map((group) => ({
        ...group,
        version,
      })),
    })
  const selectLogsUnload = (items: readonly LogQueueItem[]) =>
    selectLogsUnloadBatch({
      items,
      maxBytes: availableUnloadBytes(pageDocument!),
      encode: (item) => JSON.stringify(logsPayload([item]).resourceLogs[0]),
    })
  const logsWorker = createExportWorker<LogQueueItem>({
    exportTimeoutMs: queueOptions.exportTimeoutMs,
    onError: logExportError,
    onQuarantine: (count) =>
      observe(() =>
        warnDev(
          `[@reatom/opentelemetry] transport did not settle after abort; holding ${count} records`,
        ),
      ),
    send: async (items, { signal, deadline, keepalive, excludeOversized }) => {
      const allowed = items.filter((item) => {
        const flags = flagsFor(item.root)
        return TRACE_BOUND_LOG.has(item.log.eventName)
          ? flags.logs
          : flags.publicLogs
      })
      const blocked = items.length - allowed.length
      const consentDrops = (
        dropped: Partial<Record<'consent' | 'export', number>> = {},
      ) => (blocked > 0 ? { ...dropped, consent: blocked } : dropped)
      if (allowed.length === 0) {
        return {
          exported: 0,
          beaconAccepted: 0,
          droppedByReason: consentDrops(),
        }
      }
      if (!hasExportDestination()) {
        return {
          exported: allowed.length,
          beaconAccepted: 0,
          droppedByReason: consentDrops(),
        }
      }
      let credit: ReturnType<typeof reserveUnloadBytes> | undefined
      let keptCount = allowed.length
      let body: string | undefined
      try {
        if (keepalive) {
          const selected = selectLogsUnload(allowed)
          keptCount = selected.keptCount
          excludeOversized(selected.droppedCount)
          if (keptCount === 0)
            return {
              exported: 0,
              beaconAccepted: 0,
              droppedByReason: consentDrops(),
            }
          body = selected.body
          credit = reserveUnloadBytes(
            pageDocument!,
            encoder.encode(body).length,
          )
        }
        const data = body === undefined ? logsPayload(allowed) : undefined
        const result = await transport({
          signal: 'logs',
          payload: data,
          body,
          keepalive,
          abort: signal,
          itemCount: keptCount,
          deadline,
        })
        return {
          exported: result.accepted,
          beaconAccepted: 0,
          droppedByReason: consentDrops(
            result.rejected ? { export: result.rejected } : {},
          ),
        }
      } finally {
        credit?.release()
      }
    },
  })
  const logsQueue = createBatchQueue<LogQueueItem>({
    ...queueOptions,
    maxQueueSize: Math.max(queueOptions.maxQueueSize, 1000),
    pauseWhile: isOffline,
    send: (lease) => {
      if (isObserving()) queueMicrotask(() => logsWorker.send(lease))
      else logsWorker.send(lease)
    },
    onError: logExportError,
    isQuarantined: logsWorker.isQuarantined,
    onFlushTimeout: (unfinished) =>
      observe(() =>
        warnDev(
          `[@reatom/opentelemetry] flush_timeout: ${unfinished} records unfinished`,
        ),
      ),
  })
  let disposed = false
  const resumeExport = () => {
    if (disposed || isOffline()) return
    queue.wake()
    logsQueue.wake()
  }
  const onlineTarget =
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function'
      ? window
      : undefined
  onlineTarget?.addEventListener('online', resumeExport)
  let invalidParent = 0
  let warnedInvalidParent = false
  const remoteSpanIds = new Set<string>()
  const manualRootSpanIds = new Set<string>()
  const adoptedParents = new Map<
    string,
    { traceId: string; parentSpanId: string }
  >()
  const MAX_PARENT_IDS = 1024
  const rememberId = (ids: Set<string>, id: string) => {
    if (ids.has(id)) return
    ids.add(id)
    if (ids.size <= MAX_PARENT_IDS) return
    const oldest = ids.values().next().value
    if (oldest !== undefined) ids.delete(oldest)
  }
  const rememberParent = (
    spanId: string,
    parent: { traceId: string; parentSpanId: string },
  ) => {
    if (!adoptedParents.has(spanId) && adoptedParents.size >= MAX_PARENT_IDS) {
      const oldest = adoptedParents.keys().next().value
      if (oldest !== undefined) adoptedParents.delete(oldest)
    }
    adoptedParents.set(spanId, parent)
  }
  let sessionPair: TraceContext | undefined
  const sessionContext: TraceContext = {
    get traceId() {
      return (sessionPair ??= createTraceContext()).traceId
    },
    get spanId() {
      return (sessionPair ??= createTraceContext()).spanId
    },
  }
  const sampler = new TraceSampler(
    () => resolveSampling(options().sampling),
    () => sessionContext.traceId,
  )
  const errorRing = new ErrorRing<QueueItem>()
  const heldLogs = new ErrorRing<LogQueueItem>()
  applySignalTransition = (previous, next, root) => {
    const tracesClosed =
      tracerSignalEnabled(previous, 'traces') &&
      !tracerSignalEnabled(next, 'traces')
    const tracerLogsClosed =
      tracerSignalEnabled(previous, 'logs') &&
      !tracerSignalEnabled(next, 'logs')
    const publicLogsClosed =
      previous.signals?.logs !== false && next.signals?.logs === false
    if (tracesClosed) {
      queue.dropQueued((item) => item.root === root)
      if (sessionRoot === root) {
        sessionSpanCommitted = false
        sessionRoot = undefined
      }
      errorRing.clear()
    }
    if (tracerLogsClosed || publicLogsClosed) {
      logsQueue.dropQueued((item) => {
        if (item.root !== root) return false
        const tracerEvent = TRACE_BOUND_LOG.has(item.log.eventName)
        return tracerEvent ? tracerLogsClosed : publicLogsClosed
      })
    }
    if (tracerLogsClosed) {
      heldLogs.clear()
      logsEpoch++
    }
    syncFlags(root, next)
  }
  const flushHeldLogs = (traceId: string) => {
    for (const held of heldLogs.take(traceId)) {
      const reservation = logsQueue.reserve()
      if (reservation) reservation.commit(held)
    }
  }
  const flushHeldSpans = (traceId: string) => {
    for (const held of errorRing.take(traceId)) {
      const heldReservation = queue.reserve()
      if (heldReservation) heldReservation.commit(held)
    }
  }
  const originalTraceSet = traceVar.set.bind(traceVar)
  const explicitByRoot = new WeakMap<object, TraceContext>()
  const readExplicitTrace = (): TraceContext | undefined => {
    try {
      return explicitByRoot.get(top().root)
    } catch {
      return undefined
    }
  }
  traceVar.set = ((context: TraceContext) => {
    const joinsKnownParent =
      remoteSpanIds.has(context.spanId) || manualRootSpanIds.has(context.spanId)
    if (joinsKnownParent) {
      try {
        explicitByRoot.set(top().root, context)
      } catch {
        // Outside a frame there is no request root to scope the parent to.
      }
    }
    try {
      const current = traceVar.get()
      if (current && joinsKnownParent && current.traceId !== context.traceId) {
        rememberParent(current.spanId, {
          traceId: context.traceId,
          parentSpanId: context.spanId,
        })
      }
    } catch {
      // No current trace context to adopt.
    }
    return originalTraceSet(context)
  }) as typeof traceVar.set
  const snapshotResources = (): Record<string, OtlpAttrValue> | undefined => {
    try {
      if (!resourceAttributes) throw new Error('Invalid Resource')
      const override = STACK.length ? resourceAttributesVar.get() : undefined
      return override === undefined
        ? resourceAttributes
        : {
            ...resourceAttributes,
            ...resourceSnapshot(createValueCapture(), override),
          }
    } catch {
      return
    }
  }
  const readInstanceAttributes = (): Record<string, OtlpAttrValue> => {
    if (!STACK.length) return {}
    try {
      const value = attributesVar.get()
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      return value
    } catch {
      return {}
    }
  }
  const keepLocalRecords = () => {
    const current = options()
    return current.endpoint === null || current.keepRecords === true
  }
  const localValuesByRecord = new WeakMap<object, LocalValues>()
  const localValuesActive = () => {
    const mode = options().localValues
    if (mode === false || mode === undefined) return false
    return keepLocalRecords()
  }
  const rememberRecord = (record: unknown, local?: LocalValues) => {
    if (!keepLocalRecords()) return
    if (
      local !== undefined &&
      localValuesActive() &&
      typeof record === 'object' &&
      record !== null
    ) {
      localValuesByRecord.set(record, local)
    }
    const limit = options().maxQueueSize ?? queueOptions.maxQueueSize
    recordsSink.push(record)
    if (recordsSink.length > limit) {
      recordsSink.splice(0, recordsSink.length - limit)
    }
    records.set((stored) => {
      const next = [...stored, record]
      return next.length > limit ? next.slice(next.length - limit) : next
    })
  }
  const reserveSpan = ():
    (Reservation<SpanCommit> & { accepted: boolean }) | undefined => {
    if (disposed) return
    const reservation = queue.reserve()
    const localOnly = !reservation && localValuesActive()
    if (!reservation && !localOnly) return
    const resources = snapshotResources()
    if (!resources) {
      reservation?.cancel('observation')
      return
    }
    const root = rootNow()
    try {
      syncFlags(top().root, options())
    } catch {
      // Admission outside a frame keeps the detached root's flags.
    }
    const accepted = { current: false }
    return {
      get accepted() {
        return accepted.current
      },
      commit: (span) => {
        if (!resourceAttributes) {
          reservation?.cancel('observation')
          return
        }
        const spanLocal = span.local
        const spanFields = spanLocal === undefined ? span : { ...span }
        if (spanLocal !== undefined) delete spanFields.local
        if (
          (span.name.length > MAX_RECORD_BYTES ||
            version.length > MAX_RECORD_BYTES) &&
          !localValuesActive()
        ) {
          reservation?.cancel('oversized')
          return
        }
        const adopted = adoptedParents.get(span.spanId)
        adoptedParents.delete(span.spanId)
        const linked: SpanInput = adopted
          ? {
              ...spanFields,
              traceId: adopted.traceId as SpanInput['traceId'],
              parentSpanId: adopted.parentSpanId as SpanInput['parentSpanId'],
            }
          : spanFields
        if (reservation && linked.status?.code === 'error') {
          sampler.promote(linked.traceId)
        }
        const decision = sampler.of(linked.traceId)
        const parentIsRemote = !!(
          linked.parentSpanId && remoteSpanIds.has(linked.parentSpanId)
        )
        const flags = otlpSpanFlags(decision.sampled, parentIsRemote)
        const payload = linked.attributes?.payload
        const extraOutcome = linked.extraAttributes?.['reatom.outcome']
        const reatomOutcome =
          typeof extraOutcome === 'string'
            ? extraOutcome
            : linked.status?.code === 'error'
              ? 'error'
              : payload === '[AbortError]'
                ? 'abort'
                : payload === '[Suspension]'
                  ? 'suspense'
                  : 'ok'
        const nameUtf8Bytes = encoder.encode(linked.name).byteLength
        const otlp = buildSpan({
          ...linked,
          attributes: {
            ...(nameUtf8Bytes <= REATOM_NAME_DUP_MAX_UTF8
              ? { 'reatom.name': linked.name }
              : {}),
            'reatom.kind': 'action',
            'reatom.outcome': reatomOutcome,
            ...readInstanceAttributes(),
            ...linked.attributes,
          },
        })
        const stamped = otlp as OtlpSpan & {
          flags?: number
          links?: OtlpSpanLink[]
        }
        stamped.flags = flags
        const links = (linked as SpanCommit).links
        if (links?.length) stamped.links = links
        const record = {
          span: otlp,
          resourceAttributes: resources,
          root,
        }
        const size = encoder.encode(
          JSON.stringify({
            span: record.span,
            resource: buildResource(resources),
            scope: { name: '@reatom/opentelemetry', version },
          }),
        ).length
        if (!reservation) {
          if (spanLocal !== undefined) rememberRecord(record.span, spanLocal)
          return
        }
        if (size > MAX_RECORD_BYTES) reservation.cancel('oversized')
        else if (!flagsFor(root).traces) {
          rememberRecord(record.span, spanLocal)
          reservation.release()
          return
        }
        if (decision.sampled) {
          flushHeldLogs(linked.traceId)
          rememberRecord(record.span, spanLocal)
          reservation.commit(record)
          accepted.current = true
          flushHeldSpans(linked.traceId)
        } else {
          rememberRecord(record.span, spanLocal)
          errorRing.add(linked.traceId, record)
          reservation.release()
          accepted.current = true
        }
      },
      cancel: (reason) => {
        reservation?.cancel(reason)
      },
      release: () => {
        reservation?.release()
      },
    }
  }
  const serialize = input.serialize
  const liveCapture = () => {
    const current = options()
    if (current.captureValues === false) return false as const
    return {
      redact: serialize
        ? (key: string, value: unknown) => serialize(value, key)
        : typeof current.captureValues === 'object'
          ? current.captureValues.redact
          : undefined,
    }
  }

  const commitObservedSpan = (span: SpanCommit): boolean => {
    if (isUntracedRoot()) return false
    let kept = false
    observe(() => {
      const reservation = reserveSpan()
      if (!reservation) return
      reservation.commit(span)
      kept = reservation.accepted
    })
    return kept
  }
  const commitShortRoot = (
    context: TraceContext,
    name: string,
    attributes?: Record<string, OtlpAttrValue>,
  ): boolean => {
    const now = Date.now()
    return commitObservedSpan({
      traceId: context.traceId as SpanInput['traceId'],
      spanId: context.spanId as SpanInput['spanId'],
      name,
      startTimeMs: now,
      endTimeMs: now,
      attributes: {
        ...attributes,
        'reatom.parent.reason': 'root',
      },
    })
  }
  const ensureSessionSpan = () => {
    if (sessionSpanCommitted || disposed || isUntracedRoot()) return
    const root = rootNow()
    const kept = commitShortRoot(sessionContext, SESSION_SPAN_NAME, {
      'reatom.kind': SESSION_KIND,
    })
    if (!kept) return
    sessionSpanCommitted = true
    sessionRoot = root
  }
  const currentTrace = (): TraceContext | undefined => {
    try {
      return traceVar.get()
    } catch {
      return undefined
    }
  }
  let routeMachine: ReturnType<typeof createRouteRootMachine> | undefined
  const hasRoot = (kind: RootKind) =>
    (options().roots ?? DEFAULT_ROOTS).includes(kind)
  const fallbackTrace = (): TraceContext => {
    const found = currentTrace()
    if (found) return found
    const page = routeMachine?.pageTrace()
    if (page) return page
    const explicit = readExplicitTrace()
    if (explicit) return explicit
    return sessionContext
  }
  const rootsAdapter: RouteRootsAdapter = {
    pageTrace: () => routeMachine?.pageTrace(),
    explicitTrace: readExplicitTrace,
    routeMode: () => (options().route === 'link' ? 'link' : 'child'),
    allowActionRoot: () => hasRoot('action'),
    closePendingRouteSpan: () => {
      routeMachine?.closePendingIfReady()
    },
    discover: (target) => {
      routeMachine?.discover(target)
    },
    afterAction: (name) => {
      if (/\.go$/.test(name)) routeMachine?.sync()
    },
  }
  const commitLogRecord = (
    record: OtlpLogRecord,
    source: 'tracer' | 'public' = 'public',
    local?: LocalValues,
  ) => {
    const resources = snapshotResources()
    if (!resources) return
    const instanceAttributes = readInstanceAttributes()
    const stamped =
      Object.keys(instanceAttributes).length === 0
        ? record
        : {
            ...record,
            attributes: [
              ...record.attributes,
              ...toOtlpAttributes(instanceAttributes),
            ],
          }
    const size = encoder.encode(
      JSON.stringify({
        log: stamped,
        resource: buildResource(resources),
        scope: { name: '@reatom/opentelemetry', version },
      }),
    ).length
    if (size > MAX_RECORD_BYTES) {
      if (local !== undefined && localValuesActive()) {
        rememberRecord(stamped, local)
      }
      return
    }
    const root = rootNow()
    let open = flagsFor(root)
    try {
      open = syncFlags(top().root, options())
    } catch {
      open = flagsFor(root)
    }
    rememberRecord(stamped, local)
    const tracerEvent = TRACE_BOUND_LOG.has(stamped.eventName)
    if (source === 'tracer' && !open.logs) return
    if (source === 'public' && !open.publicLogs) return
    if (source === 'tracer' && tracerEvent) {
      if (stamped.eventName === 'exception') {
        sampler.promote(stamped.traceId)
        if (open.traces) flushHeldSpans(stamped.traceId)
      }
      if (!sampler.of(stamped.traceId).sampled) {
        heldLogs.add(stamped.traceId, {
          log: stamped,
          resourceAttributes: resources,
          root,
        })
        return
      }
      flushHeldLogs(stamped.traceId)
    }
    const reservation = logsQueue.reserve()
    if (!reservation) return
    reservation.commit({ log: stamped, resourceAttributes: resources, root })
  }
  const reserveLog = (): Reservation<LogRecordInput> | undefined => {
    if (disposed) return
    return {
      commit: (input) => {
        if (disposed) return
        commitLogRecord(buildLogRecord(input), 'tracer', input.local)
      },
      cancel: () => {},
      release: () => {},
    }
  }
  const tracing = createWithOTel({
    reserveSpan,
    reserveLog,
    fallbackTrace,
    isActive: () => !disposed,
    traceVar,
    roots: rootsAdapter,
    admit: (target) => {
      const current = options()
      if (!current.filter) return true
      return !!current.filter(target)
    },
    warnContextLoss: () =>
      observe(() => options().warnContextLoss === true) === true,
    spanBudget: () => {
      const current = options()
      return {
        maxSpansPerTrace: current.maxSpansPerTrace,
        maxTraceMs: current.maxTraceMs,
      }
    },
    autoUpdates: input.skipGlobalExtension !== true,
    captureBlocked: () => !liveFlags().traces,
    logRevision: () => logsEpoch,
    captureValues: liveCapture,
    instanceAttributes: readInstanceAttributes,
    localValues: () => {
      const mode = options().localValues ?? false
      if (mode === false || !keepLocalRecords()) return false
      return mode
    },
  })
  routeMachine = createRouteRootMachine({
    isActive: () => !disposed,
    isEnabled: () => hasRoot('route'),
    optionsOf: (target) => tracing.optionsOf(target),
    sessionContext,
    mintPageTrace: () => {
      const context = createTraceContext()
      sampler.root(context.traceId)
      return context
    },
    setTrace: (context) => {
      originalTraceSet(context)
    },
    commitSpan: (span) => {
      commitObservedSpan({
        traceId: span.context.traceId as SpanInput['traceId'],
        spanId: span.context.spanId as SpanInput['spanId'],
        parentSpanId: span.parent
          ? (span.parent.spanId as SpanInput['parentSpanId'])
          : undefined,
        name: span.name,
        startTimeMs: span.startTimeMs,
        endTimeMs: span.endTimeMs,
        attributes: span.attributes,
      })
    },
  })
  // Subscribe from the first navigation (same store as `go()`), not at
  // construction — `urlAtom` is a per-root atom and factory-time subscribe
  // would init it in a different store.
  const commitNamedLog = (
    eventName: string,
    attributes?: Record<string, OtlpAttrValue>,
    body?: OtlpAttrValue,
    source: 'tracer' | 'public' = 'public',
    local?: LocalValues,
  ) => {
    if (disposed || isUntracedRoot()) return
    if (!currentTrace() && !routeMachine?.pageTrace() && !readExplicitTrace()) {
      ensureSessionSpan()
    }
    const spanContext = fallbackTrace()
    commitLogRecord(
      buildLogRecord({
        eventName,
        traceId: spanContext.traceId as OtlpLogRecord['traceId'],
        spanId: spanContext.spanId as OtlpLogRecord['spanId'],
        timeMs: Date.now(),
        body,
        attributes,
      }),
      source,
      local,
    )
  }
  const log = (
    eventName: string,
    attributes?: Record<string, OtlpAttrValue>,
  ) => {
    observe(() => commitNamedLog(eventName, attributes))
  }
  const emitLog = (emission: LogEmission) => {
    if (disposed || isUntracedRoot()) return
    observe(() => {
      const current = options()
      const captureOff = !liveFlags().logs || current.captureValues === false
      const attributes: Record<string, OtlpAttrValue> = {}
      const label =
        emission.kind === 'label' && typeof emission.params[0] === 'string'
          ? emission.params[0]
          : undefined
      if (label) attributes['reatom.log.label'] = label
      if (typeof emission.stateName === 'string') {
        attributes['reatom.log.state'] = emission.stateName
      }
      let body: OtlpAttrValue | undefined
      if (!captureOff && emission.payload !== undefined) {
        const configured = liveCapture()
        const names = [
          ...(typeof emission.stateName === 'string'
            ? [emission.stateName]
            : []),
          ...(label ? [label] : []),
        ]
        const capture = createValueCapture(
          configured === false ? undefined : configured.redact,
          { names },
        )
        try {
          body = capture.capture('body', emission.payload)
        } catch {
          return
        }
      }
      commitNamedLog(
        'reatom.log',
        attributes,
        body,
        'tracer',
        localValuesActive() ? { payload: emission.payload } : undefined,
      )
    })
  }

  const globalExt: Ext = (target) => {
    if (isObserving()) return target
    if (
      target.name === 'LOG' ||
      target.name === 'LOG.label' ||
      isInstrumentationInternalName(target.name)
    ) {
      return target
    }
    const current = options()
    let next = isAction(target) ? tracing.auto(target, true) : target
    if (current.extend) {
      const extended = observe(() => current.extend!(next, tracing.withOTel))
      if (extended) next = extended
    }
    return next
  }
  const skipGlobalExtension = input.skipGlobalExtension === true
  if (!skipGlobalExtension) EXTENSIONS.push(globalExt)

  const flushNow = () => {
    if (disposed || !pageDocument) return
    if (options().endpoint === null) return
    tracing.closePendingSpans()
    if (isOffline()) return
    const tracesLease = queue.takeForUnload()
    const logsLease = logsQueue.takeForUnload()
    if (!tracesLease && !logsLease) return
    if (input.useBeacon !== true) {
      if (tracesLease) worker.send(tracesLease, true)
      if (logsLease) logsWorker.send(logsLease, true)
      return
    }
    if (logsLease) logsWorker.send(logsLease, true)
    const lease = tracesLease
    if (!lease) return
    const allowed = lease.items.filter((item) => flagsFor(item.root).traces)
    const blocked = lease.items.length - allowed.length
    if (allowed.length === 0) {
      lease.release({
        exported: 0,
        beaconAccepted: 0,
        droppedByReason: { consent: lease.items.length },
      })
      return
    }
    let credit: ReturnType<typeof reserveUnloadBytes> | undefined
    let keptCount = allowed.length
    let excluded = 0
    try {
      const selected = selectUnload(allowed)
      keptCount = selected.keptCount
      excluded = selected.droppedCount
      const consentDrop = blocked > 0 ? { consent: blocked } : {}
      if (keptCount === 0) {
        lease.release({
          exported: 0,
          beaconAccepted: 0,
          droppedByReason: { oversized: excluded, ...consentDrop },
        })
        return
      }
      credit = reserveUnloadBytes(
        pageDocument,
        encoder.encode(selected.body).length,
      )
      const endpoint = options().endpoint
      if (endpoint === null) {
        lease.release({
          exported: allowed.length,
          beaconAccepted: 0,
          droppedByReason: consentDrop,
        })
        return
      }
      const sendBeacon = input.sendBeacon
      if (disposed) {
        lease.release({
          exported: 0,
          beaconAccepted: 0,
          droppedByReason: {
            disposed: keptCount,
            oversized: excluded,
            ...consentDrop,
          },
        })
        return
      }
      const accepted = flushWithBeacon({
        endpoint,
        body: selected.body,
        sendBeacon,
      })
      if (accepted) credit.acceptBeacon()
      lease.release({
        exported: 0,
        beaconAccepted: accepted ? keptCount : 0,
        droppedByReason: {
          oversized: excluded,
          export: accepted ? 0 : keptCount,
          ...consentDrop,
        },
      })
      if (!accepted)
        logExportError(new Error('beacon delivery failed'), lease.items)
    } catch (error) {
      lease.release({
        exported: 0,
        beaconAccepted: 0,
        droppedByReason: {
          oversized: excluded,
          [disposed ? 'disposed' : 'export']: keptCount,
          ...(blocked > 0 ? { consent: blocked } : {}),
        },
      })
      logExportError(error, lease.items)
    } finally {
      credit?.release()
    }
  }

  const onVisibilityChange = () => {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      flushNow()
    }
  }
  // iOS Safari fires `pagehide` without flipping visibilityState during
  // bf-cache transitions, so this handler must NOT gate on visibility.
  const onPageHide = flushNow

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
  }

  const createTrace = (createOptions?: CreateTraceOptions): TraceContext => {
    const context = createTraceContext()
    rememberId(manualRootSpanIds, context.spanId)
    sampler.root(context.traceId)
    commitShortRoot(
      context,
      createOptions?.name ?? 'trace',
      createOptions?.attributes,
    )
    return context
  }
  const parseTraceparent = (
    header: string | null | undefined,
  ): TraceContext | undefined => {
    const parsed = parseTraceparentHeader(header)
    if (parsed) {
      rememberId(remoteSpanIds, parsed.spanId)
      sampler.remote(parsed.traceId, parsed.sampled)
      return { traceId: parsed.traceId, spanId: parsed.spanId }
    }
    if (typeof header === 'string') {
      invalidParent++
      if (!warnedInvalidParent && isDevelopment()) {
        warnedInvalidParent = true
        console.warn(`[@reatom/opentelemetry] invalid traceparent: ${header}`)
      }
    }
    return undefined
  }
  const traceparent = (): string | undefined => {
    const context = currentTrace()
    if (!context) return undefined
    return formatTraceparent(context, sampler.of(context.traceId).sampled)
  }

  const entry: RegisteredInstance = {
    name,
    creationSite,
    dispose: () => {},
    emitLog,
  }
  const rateLimitDrops = { count: 0 }
  const mergeStats = (): TelemetryStats => {
    const traces = queue.stats()
    const logs = logsQueue.stats()
    const droppedByReason = Object.fromEntries(
      (
        Object.keys(traces.droppedByReason) as Array<
          keyof typeof traces.droppedByReason
        >
      ).map((reason) => [
        reason,
        (traces.droppedByReason[reason] ?? 0) +
          (logs.droppedByReason[reason] ?? 0),
      ]),
    ) as TelemetryStats['droppedByReason']
    const rateLimitDropped = rateLimitDrops.count
    return Object.freeze({
      active: traces.active + logs.active,
      queued: traces.queued + logs.queued,
      inFlight: traces.inFlight + logs.inFlight,
      exported: traces.exported + logs.exported,
      dropped: traces.dropped + logs.dropped + rateLimitDropped,
      droppedByReason: Object.freeze(
        rateLimitDropped > 0
          ? { ...droppedByReason, rateLimit: rateLimitDropped }
          : droppedByReason,
      ),
      beaconAccepted: traces.beaconAccepted + logs.beaconAccepted,
      flushTimeouts: traces.flushTimeouts + logs.flushTimeouts,
      transportQuarantined:
        traces.transportQuarantined || logs.transportQuarantined,
      invalidParent,
    })
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    onlineTarget?.removeEventListener('online', resumeExport)
    unregisterInstance(entry)
    routeMachine?.dispose()
    tracing.dispose()
    queue.dispose()
    worker.dispose()
    logsQueue.dispose()
    logsWorker.dispose()
    recordsSink.length = 0
    observe(() => records.set([]))
    if (!skipGlobalExtension) removeItem(EXTENSIONS, globalExt)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
    }
  }
  entry.dispose = dispose
  registerInstance(entry)

  const instance: ReatomOpentelemetry = {
    name,
    options,
    withOTel: tracing.withOTel,
    traceVar,
    attributesVar,
    createTrace,
    traceparent,
    parseTraceparent,
    pageTrace: () => routeMachine?.pageTrace(),
    records: Object.assign(() => {
      if (!inIsolatedContextRoot()) return recordsSink.slice()
      return records()
    }, records),
    localValuesOf: (record) => {
      if (typeof record !== 'object' || record === null) return
      return localValuesByRecord.get(record)
    },
    clearRecords,
    log,
    transport,
    stats: mergeStats,
    flush: async () => {
      await Promise.resolve()
      await Promise.all([queue.flush(), logsQueue.flush()])
    },
    dispose,
  }
  internalsByInstance.set(instance, {
    recordedExceptions: tracing.recordedExceptions,
    rateLimitDrops,
    currentTrace: tracing.currentTrace,
    runInTrace: tracing.runInTrace,
  })
  return instance
}
