# OpenTelemetry API reference

This reference describes the **unreleased workspace package**. Start with the
[README](./README.md) for setup and optional imports, or the
[worked guide](../../docs/src/content/docs/guides/opentelemetry.md) for eighteen
application scenarios. Use one shared `@reatom/core` peer dependency.

## Instance creation

`reatomOpentelemetry(input)` installs observation for targets created afterwards.
Earlier targets need `.extend(otel.withOTel())`. It uses Reatom frame variables;
normal `await wrap(promise)` and externally called `wrap(callback)` rules apply.
It is not a general OpenTelemetry provider or a zone/context patch for other SDKs.
The root import installs no browser network or console patches.

| Input                            | Default and behavior                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                           | Required nonempty registry key. A second live instance with the same name disposes the first; distinct names have separate context, records and queues.                                                                                                             |
| `endpoint`                       | Required absolute HTTP(S) base URL or `null`. Native OTLP/HTTP JSON appends `/v1/traces` and `/v1/logs`; relative/empty URLs throw. `null` disables that destination, but explicit `transports` still run.                                                          |
| `serviceName`                    | Required; resource `service.name`.                                                                                                                                                                                                                                  |
| `serviceVersion`, `environment`  | Optional; resource `service.version`, `deployment.environment.name`.                                                                                                                                                                                                |
| `resourceAttributes`             | Extra construction-time resource defaults. Resource values are bounded snapshots at construction. The exposed `options.resource` field does not currently refresh that snapshot.                                                                                    |
| `headers`                        | OTLP request headers, read per delivery. `Content-Type` is fixed to `application/json`. Browser CORS must allow your origin and headers.                                                                                                                            |
| `transports`                     | Additional `Transport` destinations, also usable with `endpoint: null`. See [delivery](#delivery-and-transports).                                                                                                                                                   |
| `skipGlobalExtension`            | `false`: automatically observe future actions and atom/computed updates. `true` leaves explicit `withOTel()` available. Installation is fixed at construction.                                                                                                      |
| `filter(target)`                 | Select automatic targets. Explicit `withOTel()` still records. Internal `analytics.*` and `otel.*` names are excluded automatically. Private targets are normally skipped, with exceptions for route-related instrumentation.                                       |
| `extend(target, withOTel)`       | Customize newly created targets, e.g. return `target.extend(withOTel({ kind: 'client' }))` for `api.*`.                                                                                                                                                             |
| `captureValues`                  | Enabled by default. `false` disables automatic value snapshots; `{ redact(key, value) }` transforms values before sensitive-key masking. A failing instance transform can discard a record.                                                                         |
| `serialize(value, key)`          | Construction-time transform replacing the instance `redact` hook; sensitive-key masking still follows it.                                                                                                                                                           |
| `keepRecords`                    | `false`; keep bounded local records beside an export destination. `endpoint: null` already keeps them.                                                                                                                                                              |
| `localValues`                    | `false`, `true` or `'all'`; [raw local references](#local-records-and-values), independent of export capture.                                                                                                                                                       |
| `batchInterval`                  | `3000` ms.                                                                                                                                                                                                                                                          |
| `maxBatchSize`                   | `100` records.                                                                                                                                                                                                                                                      |
| `maxQueueSize`                   | `1000` reservations per signal queue; local records are bounded too.                                                                                                                                                                                                |
| `exportTimeoutMs`                | `30000` ms; batch delivery and each `flush()` caller have separate deadlines.                                                                                                                                                                                       |
| `retry`                          | Native endpoint: `{ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }`, exponential backoff with full jitter. Three retries mean up to four attempts; unload has no retries. Extra transports own their retry policy.                                           |
| `useBeacon`                      | `false`; opt-in unload fallback. Cannot carry custom headers. Accepted bytes indicate browser acceptance, not collector receipt.                                                                                                                                    |
| `version`                        | Instrumentation scope version, default `''`. Distinct from the application's `serviceVersion`; fixed at construction.                                                                                                                                               |
| `sampling`                       | `{ ratio: 1, by: 'trace', updates: 1, errors: 'always' }`. Ratios clamp to 0–1. `by: 'session'` shares the decision within the tracer session; this is distinct from analytics session storage. `updates` samples update logs. Remote parent flags take precedence. |
| `roots`                          | `['route', 'mount', 'action', 'atom']`. `[]` disables automatic root machines; manual roots and `app.session` fallback remain. `mount` is accepted but does **not** implement automatic mount/render profiling.                                                     |
| `route`                          | `'child'`: top-level page actions join its trace. `'link'` creates new action traces linked to the page root.                                                                                                                                                       |
| `maxSpansPerTrace`, `maxTraceMs` | `1000` spans / `60000` ms; later spans start linked continuation traces. `Infinity` disables the corresponding limit.                                                                                                                                               |
| `warnContextLoss`                | Enabled in development/test (`NODE_ENV`, or `import.meta.env.DEV` when unset). Warns once per target about some missing `wrap` boundaries; cannot detect every lost context.                                                                                        |
| `fetch`, `sendBeacon`            | Construction-time injection points, primarily for tests.                                                                                                                                                                                                            |

A random `service.instance.id` identifies the instance. SDK metadata and available
low-entropy browser hints are added to resource attributes; the raw user agent
is not collected. Each record retains its resource snapshot alongside the queue item.

`otel.options` is an atom. Update with
`otel.options.set(current => ({ ...current, headers: nextHeaders }))`.
Endpoint, headers, transports, sampling, capture policy, local retention, roots,
route policy and span limits are consulted during operation. Filter/extend affect
future target installation; changing them does not uninstall existing target
middleware. Service/resource metadata is snapshotted at construction; changing those option fields does not refresh exported resources. Queue scheduling
and capacity, the constructor `serialize`, native retry policy, scope `version`,
`useBeacon`, injected platform functions and global extension installation remain
construction-time settings; recreating the instance applies those changes.
`options.maxQueueSize` also controls the local record retention limit.

`consent` and `signals` are **not constructor inputs**. Configure them through
`options.set` or a submitted `reatomGDPR` snapshot. Updates that omit either retain
its existing value. Diagnostics default on; only explicit `consent.diagnostics:
false` disables diagnostics admission/export and automatic value capture.
`signals.traces: false` / `signals.logs: false` independently stop those signals.
Public `otel.log` obeys the logs switch, while the caller owns its category
consent and explicit attributes. Attaching an unsubmitted consent form alone does
not disable diagnostics. See [consent](#consent-form).

## Instance members

| Member                                               | Contract                                                                                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                               | Read-only construction-time name, also analytics' default `storageKey`.                                                                                                                                         |
| `options`                                            | Live configuration atom; restrictions above apply.                                                                                                                                                              |
| `withOTel(options?)`                                 | Target extension; [options below](#target-options).                                                                                                                                                             |
| `traceVar`                                           | Reatom variable `{ traceId, spanId }`. Set a manual or parsed parent inside a frame; `run(context, callback)` scopes it.                                                                                        |
| `attributesVar`                                      | Reatom variable of attributes. `run(attributes, callback)` adds domain attributes to spans/logs in that frame subtree. Explicit attributes require caller privacy policy.                                       |
| `createTrace({ name?, attributes? }?)`               | Returns a fresh context and records a short manual root. Use `traceVar.set(otel.createTrace(...))` inside an action.                                                                                            |
| `traceparent()`                                      | W3C header for the active context, or `undefined`. Propagation is manual unless the network connector is explicitly configured.                                                                                 |
| `parseTraceparent(header)`                           | Accepts `string \| null \| undefined`; returns context or `undefined`. Guard before `traceVar.set`. Invalid headers warn once in development and increment runtime `invalidParent`; missing headers are silent. |
| `pageTrace()`                                        | Current route root pair, or `undefined`; it need not be an analytics page trace.                                                                                                                                |
| `records`, `localValuesOf(record)`, `clearRecords()` | [Local inspection](#local-records-and-values).                                                                                                                                                                  |
| `log(eventName, attributes?)`                        | Manual OTLP log. Explicit attributes are not automatically sensitive-key masked. Honors `signals.logs`; caller owns consent, data minimization and stable names.                                                |
| `transport(batch)`                                   | Named Reatom action delivering one batch; extra transports fan out from it.                                                                                                                                     |
| `flush()`                                            | Attempts delivery of finished records present at invocation, bounded by a caller timeout. Does not await unfinished application actions or guarantee remote receipt.                                            |
| `stats()`                                            | Immutable counters: `active`, `queued`, `inFlight`, `exported`, `dropped`, `droppedByReason`, `beaconAccepted`, `flushTimeouts`, `transportQuarantined`. Runtime also includes `invalidParent`.                 |
| `dispose()`                                          | Stops observation/listeners/connectors/queues, requests abort of in-flight exports, clears local records. Attempt `flush()` first if shutdown delivery matters.                                                 |

Drop reasons include `capacity`, `oversized`, `disposed`, `export`, `timeout`,
`observation`, `consent`, and optional analytics `rateLimit`. Inspect them alongside
your receiver's own metrics. Development warnings are diagnostic aids; production
export failures stay out of the application error path.

Actions become spans; atom/computed updates become `reatom.atom.update` /
`reatom.computed.update` logs; core `log` calls become `reatom.log`. Cross-trace
computed dependencies get linked spans. `reatom.frame.id` and `reatom.cause.ids`
retain the Reatom cause graph. Route match changes create short roots; same-route
parameter changes do not necessarily start a new route root. Orphan updates/logs
use `app.session`, distinct from an analytics session. Aborts and unfinished
unload actions use outcomes `abort` and `pending`; they are not ordinary errors.

### Target options

`target.extend(otel.withOTel(options))` supports the following. Subsequent calls
merge defined fields with the existing settings.

| Option                  | Behavior                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `false` disables this target's instrumentation.                                                                                                                                                                             |
| `name`                  | Override recorded name. Factory ids are normalized into attributes.                                                                                                                                                         |
| `kind`                  | Span kind: `internal` (default), `server`, `client`, `producer`, `consumer`.                                                                                                                                                |
| `span`                  | `true` suppresses atom/computed update logs for this target. It does not turn arbitrary component work into render spans.                                                                                                   |
| `boundary`              | Route watershed control; `false` lets a modal route remain in the current trace.                                                                                                                                            |
| `attributes`            | Static attributes or `({ params, payload, state, prevState, error }) => attributes`, evaluated at completion. Callback failure adds `reatom.attributes_error`; attributes are caller-owned, not automatically value-masked. |
| `captureValues`         | Override automatic value capture. `true` cannot override a diagnostics denial. `false` removes params/payload/update bodies/core log payloads.                                                                              |
| `serialize(value, key)` | Per-target transform replacing the instance transform and enabling capture for this target when instance capture is off; sensitive-key masking still follows.                                                               |
| `importance`            | `'low' \| 'normal'` adds `reatom.importance`; it is metadata, not a delivery guarantee.                                                                                                                                     |

Automatic snapshots bound depth to 5, entries to 100, strings to 2048 characters
and captured bytes to 8192. Complete records have a 16 KiB export limit. Capture
handles cycles without invoking getters, masks sensitive keys/names, and scrubs
recognized contact/credential text. This does not sanitize arbitrary URLs,
manual log attributes, `attributesVar` or custom domain attributes.
`checkSensitiveNames` warns about names; it does not redact them.

### Local records and values

`endpoint: null` keeps records locally even when extra transports export them.
`keepRecords: true` enables the same inspection with a native endpoint.
`records()` holds serialized OTLP records and may include samples held back from
export. `clearRecords()` releases retained records. See
[Reatom admin](../admin/README.md) for an in-page inspection workflow.

`localValues: true` stores `{ params?, payload?, state?, error? }` beside locally
retained records; `otel.localValuesOf(record)` reads it. These are **raw live
references**, never copied, masked, truncated or exported. Instance capture,
redaction and consent do not control this side channel. `true` honors per-target
`captureValues: false`; `'all'` retains those values too. No local record means
no retained raw value. Enable deliberately for local debugging and account for
retained application objects.

## Web analytics

Import `connectWebAnalytics` from `@reatom/opentelemetry/web-analytics`.
`connectWebAnalytics(otel, options?)` shares an existing instance.
`connectWebAnalytics({ name, endpoint, serviceName, ...options })` creates an
owned instance, defaulting `skipGlobalExtension` to `true`. Disposing this model
also disposes the owned instance. Attaching twice to one instance throws;
disposing the parent cleans up the attached model. Without `window`, it is a
no-op with a development warning.

| Option                | Default and behavior                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consent`             | Denied. Accepts a boolean, boolean atom/reader, `{ analytics: reader }`, or a form with `fields.analytics` and submitted `snapshot`. Atom/form changes are observed; arbitrary readers are reevaluated on activity and may not trigger a grant immediately. |
| `autoPageViews`       | `true`. `false` skips the initial automatic view; navigation listeners remain active.                                                                                                                                                                       |
| `errors`              | `true`; listen to window `error` and `unhandledrejection`, deduplicating Error objects already captured by the tracer.                                                                                                                                      |
| `captureErrorDetails` | `false`; type only. `true` adds scrubbed message/stack to analytics errors. Does not alter tracer error capture.                                                                                                                                            |
| `captureQuery`        | `false`; analytics page URLs omit query/hash. `true` includes the full URL in analytics page-view data. General diagnostic page metadata stays query-free.                                                                                                  |
| `persistVisitor`      | `true`; `false` keeps the visitor only in RAM. Session storage continues.                                                                                                                                                                                   |
| `navigation`          | Chosen once: `'urlAtom'` if routes exist, else `'navigation-api'` if available, else `'popstate'`. Fallback foreign `pushState`/`replaceState` requires `pageView()`. Explicit `'urlAtom'` without routes needs router integration; see guide E4.           |
| `storageKey`          | Instance name; visitor/session keys are `<key>.visitor` and `<key>.session`.                                                                                                                                                                                |
| `sessionTimeout`      | `1800000` ms idle; checked when session state synchronizes, not by a precise expiry timer.                                                                                                                                                                  |
| `perTab`              | `false`: shared localStorage session and storage-event synchronization. `true`: sessionStorage session per tab.                                                                                                                                             |
| `rotateAtMidnight`    | `false`; optional rotation on a new local day.                                                                                                                                                                                                              |
| `attributionParams`   | `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `yclid`, `fbclid`, `msclkid`. `utm_term`/`utm_content` are additionally captured; alone they do not rotate sessions.                                                                                   |
| `errorSampling`       | `1`; ratio for analytics exceptions only.                                                                                                                                                                                                                   |
| `rateLimit`           | `{ errorsPerMin: 10, eventsPerMin: 60, byName: {} }`. Error cap per signature and named-event cap per name, per page per minute. `byName` overrides a name's cap; `0` means no client cap.                                                                  |

The model returns `visitorAtom` (`string | undefined`), `sessionAtom`
(`{ id?, start?, previousId? }`), `pageAtom` (`{ path?, url? }`),
`attributionAtom` (`Attribution`), `focusAtom` (`boolean`), `pageView(attributes?)`,
`otel` and `dispose()`. `Attribution` has optional source/medium/campaign/term/content,
click ids and custom parameter keys. Page/session atoms are observable state;
there is no separate `trackEvent` method. Use named actions with `withOTel` for
application operations, and explicitly consented `otel.log` for manual facts.

Records are `session.start`, `app.page_view`, `app.page.engagement`, `exception`,
and `exception.suppressed`. Analytics records carry consented visitor/session
attributes and attribution. Visible engagement requires visibility and focus;
active engagement additionally needs input within the last 5 seconds. Suppressed
error counts flush on lifecycle changes. Session rotation follows idle timeout,
optional midnight, or changed external inbound campaign; same-origin navigation
campaign changes do not rotate it. Visitors expire 400 days after creation; activity updates `lastSeen` without
extending that expiry. Web Storage failures degrade to memory.

Before analytics permission, no analytics identity is read/written to storage
and no analytics records are emitted. Current-page engagement can accumulate in
RAM and be emitted after a grant; earlier unconsented pages are discarded.
Diagnostics are independent. Revocation stops analytics identity use and future
analytics sends; it does not automatically delete previously stored identifiers.

With analytics consent, **general spans, logs and manual records** also capture
`session.id`, `page.url`, `page.path` and legacy `url.full`/`url.path` fallback
metadata, without automatically copying visitor or login ids. Metadata is captured
with the record, never read from the current page at flush. Pending session
identity is stripped if permission is revoked. A metadata/consent read failure
fails closed without adding identity. Page metadata remains query-free even with
analytics `captureQuery: true`. Older-page engagement can still use the current
page trace; use session, page/time attributes to interpret it, not trace id alone.

## Browser connectors

Each connector has its **own explicit import**; there is no plugin registry or
root barrel export. Importing does not connect it. All return `{ dispose() }`,
follow parent disposal, and replace the same connector on a given parent on
reattachment. Same-name instance replacement/HMR also cleans them up. They no-op
without browser APIs. Diagnostic collection follows diagnostics and signal gates
at admission/export; it does not require analytics permission to collect
identity-free diagnostics.

Collectors observe the **whole document/page**. Multiple instances receive their
own records from shared native instrumentation; a widget's instance does not
isolate its network or console activity from the host. Consent and the parent
signal settings apply independently to each subscriber.

### Network

`connectBrowserNetwork(otel, { propagateTraceparent?, ignoreUrl? })` from
`@reatom/opentelemetry/browser-network` explicitly wraps native `fetch` and XHR.
It emits CLIENT spans with method, sanitized `url.full`, response status,
`http.request.duration` in ms and error status for native failures/HTTP errors.
Fetch ends when the response becomes available; XHR ends at completion. Neither
measures response body consumption. Request normalization and native XHR argument
semantics are preserved. No headers or bodies are recorded; exported URLs omit
credentials, query and fragment.

Propagation defaults **off**. `propagateTraceparent` accepts a list of exact
origins (including scheme and port) or a predicate on the full resolved URL.
Existing `traceparent` is preserved. Multiple subscribers can record the request,
but only the first eligible propagation context is injected. Configure API CORS
for the header. `ignoreUrl` receives a full URL clone before sanitization;
`true` or a throw excludes both capture and propagation. Predicates can see query
and userinfo, so make their decisions deliberately.

### Console

`connectBrowserConsole(otel, { levels? })` from
`@reatom/opentelemetry/browser-console` wraps console methods while preserving
native calls. Defaults to `['warn', 'error']`; available levels are `debug`, `info`,
`log`, `warn`, `error`. Emits `reatom.console` logs with `console.level`, severity,
bounded/redacted arguments, and captured Error details when capture is enabled.
Avoid logging sensitive values even with automatic masking.

### Web Vitals

`connectWebVitals(otel)` from `@reatom/opentelemetry/web-vitals` uses the official
`web-vitals` **6.2.3** dependency, reachable only through this entry. It records
CLS, FCP, INP, LCP and TTFB as `measurement` logs of type `web-vitals`:

- `measurement.values`: lowercase name plus `delta`, e.g. `{ lcp: 1200, delta: 1200 }`.
- `measurement.unit`: `1` for CLS, `ms` otherwise.
- `web_vital.name` (uppercase), `.id`, `.rating`, `.navigation_type`, `.delta`.

These are document metrics, not a new measurement for each SPA route. Browser
support, upstream reporting and late attachment constrain availability. A shared
collector registers five callbacks per document; it caches only five primitive
measurements and weak subscribers. Disposal stops this instance's reports;
upstream observers may remain until document end. Document metadata is snapshotted
when attached, so attach analytics first if measurements need consented joins.
A later grant does not backfill identity into that snapshot.

### Navigation and resources

`connectBrowserPerformance(otel, { navigation?, resources?, ignoreUrl? })` from
`@reatom/opentelemetry/browser-performance` observes native PerformanceObserver
entries, both categories enabled by default. Emits measurement types
`browser-navigation` and `browser-resource`, with `measurement.values`:

| Values                                                           | Units                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| `duration`, `dns`, `connect`, `request`, `response`              | `ms`                                                 |
| `transfer_size`, `encoded_body_size`, `decoded_body_size`        | `By`                                                 |
| Navigation only: `dom_interactive`, `dom_content_loaded`, `load` | `ms` from navigation start, when completed/available |

Attributes include sanitized `url.full`, `performance.entry_type`, resource
`performance.initiator_type` or `performance.navigation_type`, and a
`measurement.units` map. Missing/unfinished navigation milestones are omitted.
Cross-origin timing fields can be restricted or zero without Timing-Allow-Origin.
Buffered delivery processes at most 100 entries per observer callback. Disposal
disconnects observers. Navigation uses attach-time document metadata; resource
entries use metadata at observer delivery, which may occur after navigation.
HTTP spans instead snapshot metadata at request start. These are this package's
measurement schema, not native Faro performance events.

### Excluding custom collectors

Built-in OTLP and Faro destinations are excluded automatically. Synchronous custom
transport calls are suppressed during invocation. If a custom transport starts
network work **after an await**, exclude its URL explicitly from network capture.
PerformanceObserver delivery is asynchronous, so exclude custom collector URLs
from performance capture regardless of when the transport starts. Avoid logging at captured console levels after an await in a custom transport,
or use a logger that the console connector does not capture. Console collection
has no URL exclusion option.

```ts
import { reatomOpentelemetry, type Transport } from '@reatom/opentelemetry'
import { connectBrowserNetwork } from '@reatom/opentelemetry/browser-network'
import { connectBrowserPerformance } from '@reatom/opentelemetry/browser-performance'

const collector = new URL('https://telemetry.example/ingest')
const ignoreCollector = (url: URL) =>
  url.origin === collector.origin && url.pathname === collector.pathname
const transport: Transport = async (batch) => {
  await Promise.resolve() // An asynchronous custom transport boundary.
  const response = await fetch(collector, {
    method: 'POST',
    body: batch.body ?? JSON.stringify(batch.payload),
    signal: batch.abort,
    keepalive: batch.keepalive,
  })
  await response.body?.cancel()
  return response.ok
    ? { accepted: batch.itemCount, rejected: 0 }
    : { accepted: 0, rejected: batch.itemCount }
}
const otel = reatomOpentelemetry({
  name: 'custom-collector',
  endpoint: null,
  serviceName: 'shop-web',
  transports: [transport],
})
connectBrowserNetwork(otel, { ignoreUrl: ignoreCollector })
connectBrowserPerformance(otel, { ignoreUrl: ignoreCollector })
```

Unrelated application requests remain captured. This example shows exclusion and
a single-attempt delivery contract; a production custom transport also owns its
protocol, authentication, deadline and retry policy.

## Delivery and transports

`Transport` is `(batch: TransportBatch) => Promise<TransportResult>`.
The batch contains `signal: 'traces' | 'logs'`, OTLP `payload`, optional serialized
`body`, `keepalive`, `abort: AbortSignal`, `itemCount` and optional absolute
`deadline` in epoch ms. Return nonnegative integer `accepted` and `rejected`
counts totaling `itemCount`, plus optional `errorMessage`.

`otlpTransport({ endpoint, headers?, fetch? })` creates one OTLP/HTTP destination.
It uses the same suffixes and JSON header rules as the native endpoint, and reads
OTLP partial-success responses. Unlike the instance's native endpoint worker, this
standalone transport does not add retries itself.

The first destination controls queue success/drop accounting. Additional
destinations are best effort with development warnings, without independent
retries or per-destination durability. Failures, malformed responses and timeout
losses are visible through counters. The queue holds records in memory while
offline and resumes on `online`; reload/tab close loses unsent records. Unload
uses best-effort keepalive and a shared 60 KiB per-page budget, favoring recent
records. A successful flush is not a durable offline or end-to-end delivery promise.

### Faro receiver integration

Import `faroTransport` and `logMeasurement` from `@reatom/opentelemetry/faro`.
`faroTransport({ endpoint, headers?, fetch? })` accepts an **exact absolute HTTP(S)
collection URL**, with no OTLP suffix. It converts captured records and installs
no instrumentation. JSON Content-Type and captured `x-faro-session-id` are fixed;
other headers and fetch are injectable.

App, page and session metadata are captured with records; envelopes are grouped
by that metadata. `session.start` maps to `session_start`, `app.page_view` to
`view_changed`; `reatom.*` maps to console-style logs; exceptions carry captured
stack text in context, without structured stack frames or automatic symbolication.
Span errors are not duplicated as exception events. Measurements retain trace
links. Web Vitals use lowercase values and Faro context aliases `id`, `rating`,
`navigation_type`; no synthetic `navigation_entry_id` is created. This mapping does
not promise that every existing Faro dashboard consumes the custom measurement
schema unchanged.

Each envelope gets one attempt. HTTP **202** is accepted; other responses or
`X-Faro-Session-Status: invalid` reject its records. Applications own session
rotation after rejection. Abort, deadline and unload keepalive are respected;
converted unload envelopes share a 60 KiB in-flight Faro byte budget. Every
unload envelope starts before awaiting responses. The bridge does not implement
managed session invalidation/rotation or a four-hour maximum session lifetime;
analytics uses its own 30-minute idle policy. Managed Grafana Cloud Frontend
Observability has not been verified. The [README's self-hosted Alloy recipe](./README.md#self-hosted-faro-receiver)
is a starting point for Loki/Tempo, not a live-validated deployment.

`logMeasurement(otel, { type, values, context? })` validates nonempty type/name
keys and finite numeric values. `context` cannot override `measurement.type` or
`measurement.values`. It calls public `otel.log`, obeys `signals.logs`, and leaves
category consent and explicit-attribute privacy to the caller. These are
**log-derived measurements**, not OTLP metrics instruments or a Prometheus registry.
Use stable names/units and bounded context values.

## Consent form

`reatomGDPR(options?)` from `@reatom/opentelemetry/gdpr` returns a Reatom form.
Options: `name` (default `'consent'`), `categories` (default diagnostics, analytics,
marketing, all false), `otel` or `instances` (one instance or an array), and
`persist` (default `true`, `false` to disable, or a storage-key string).
The default key is `reatom.gdpr.<name>`. Stored submitted choices restore the
snapshot; unavailable Web Storage uses Reatom's memory fallback.

Use `fields.analytics.change(boolean)` to edit the draft and `submit()` to
apply it. `snapshot` is an atom of `null` or
`{ submitted: true, categories: { ...booleans } }`.
Submit persists the choice and writes `options.consent` on attached instances;
it does not rewrite `signals`. Diagnostics is projected only when offered by the
form. An omitted diagnostics category leaves its prior gate alone. The form
stores a choice, not a visitor identity. It does not provide legal compliance,
identifier erasure or a complete consent-banner UI.

## Helpers and exported types

- `checkSensitiveNames(otel, { patterns? }?)`: development name warnings for future targets while value capture is enabled. Accepts a RegExp or array; returns a cleanup function. It neither changes capture nor redacts data. Install before model definitions and call the cleanup on teardown.
- `readServerTimingTraceparent()`: reads `traceparent` from the first navigation entry's Server-Timing description, or `undefined`. Parse and guard before setting a frame parent.
- `formatServerTimingTraceparent(header)`: produces `traceparent;desc="..."` for a server response. Pass a valid traceparent value. Cross-origin timing visibility needs the server's timing policy.
- Root exported types: `ReatomOpentelemetry`, `ReatomOpentelemetryInput`, `SpanKind`, `OtlpAttrValue`, `LocalValues`, `LocalValuesMode`, `TelemetryStats`, `CheckSensitiveNamesOptions`, `Transport`, `TransportBatch`, `TransportResult`.
- Analytics types: `WebAnalytics`, `WebAnalyticsOptions`, `WebAnalyticsCreateOptions`, `AnalyticsPage`, `AnalyticsSession`, `Attribution`, `NavigationSource`.
- Optional entries export `BrowserNetworkOptions`, `BrowserConsoleOptions`, `ConsoleLevel`, `BrowserPerformanceOptions`, `FaroTransportOptions`; GDPR exports `DEFAULT_GDPR_CATEGORIES`, `GdprCategories`, `GdprConsentSnapshot`, `ReatomGDPR`, `ReatomGDPROptions`.

## Current boundaries

The package has no session replay, source-map upload/symbolication service,
error-grouping UI, arbitrary DOM named actions, frustration/rage-click/scroll/form
analytics, CSP or long-task collector, experiment/e-commerce schema, automatic
title/referrer/viewport enrichment, automatic login/logout identity stitching,
native OTLP metrics, durable offline storage, managed Faro session parity,
cross-tab/worker trace propagation, or automatic mount/render profiling.
Session storage synchronization across tabs is distinct from trace propagation.
Generic attributes can carry caller-owned `user.id`; the application owns that
identity lifecycle and policy. These are current boundaries, not a roadmap.
