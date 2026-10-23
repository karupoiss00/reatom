# OpenTelemetry API reference

This reference describes the **unreleased workspace package**. Start with the
[README](./README.md) for setup and optional imports, or the
[worked guide](../../docs/src/content/docs/guides/opentelemetry.md) for eighteen
application scenarios. Use one shared `@reatom/core` peer dependency.

## Instance creation

`reatomOpentelemetry(input)` returns a genuine `Atom<OtelOptions>` with native
`.extend`, `.set`, hooks and subscriptions. Read live settings with `otel()` and
update with `otel.set(current => ({ ...current, headers: nextHeaders }))`.
There is no `.options` alias. Native `.name` is `otel.<name>`; `.instanceName`
retains the raw construction name used for registry identity and analytics storage.

Install before application model definitions; earlier targets need explicit
`.extend(otel.withOTel())`. Normal `await wrap(promise)` and externally called
`wrap(callback)` rules apply. This is not a general OpenTelemetry provider or
zone patch for other SDKs. The root imports no optional browser collectors.

The factory owns one runtime and shared queues across Reatom roots. Readonly
`records` preserves isolated-root views and a default/Admin aggregate view; do
not treat a context boundary as an independent queue or delivery lifecycle.
Distinct instances have their own runtimes. Same-name construction disposes the
previous instance and its installed features.

| Constructor input                               | Default and behavior                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                          | Required nonempty raw registry key, exposed as `instanceName`.                                                                                                              |
| `endpoint`                                      | Required absolute HTTP(S) base URL or `null`. Appends `/v1/traces` and `/v1/logs`; empty/relative URLs throw. `null` disables native export, not explicit transports.       |
| `serviceName`                                   | Required construction-time resource `service.name`.                                                                                                                         |
| `serviceVersion`, `environment`                 | Optional construction-time `service.version`, `deployment.environment.name`.                                                                                                |
| `resourceAttributes`                            | Extra bounded resource attributes, captured at construction and exposed through readonly `.resource`.                                                                       |
| `skipGlobalExtension`                           | `false`; observe future actions and atom/computed updates automatically. Explicit `withOTel` works with `true`. Fixed at construction.                                      |
| `extend(target, withOTel)`                      | Construction hook for future model definitions, e.g. assign client kind to `api.*`. This is distinct from native `otel.extend(...)`.                                        |
| `serialize(value, key)`                         | Fixed value transform replacing instance `redact`; sensitive-key masking still follows.                                                                                     |
| `batchInterval`, `maxBatchSize`, `maxQueueSize` | `3000` ms, `100` records/batch, `1000` reservations per signal queue. Queue capacity/scheduling and local `.recordLimit` are fixed.                                         |
| `exportTimeoutMs`                               | `30000` ms; separate batch and flush-caller deadlines. Fixed at construction.                                                                                               |
| `retry`                                         | Native endpoint: `{ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000 }`, exponential backoff/full jitter. Up to four attempts; no unload retries. Fixed at construction. |
| `useBeacon`                                     | `false`; fixed opt-in unload fallback. Cannot carry custom headers; acceptance is not receipt.                                                                              |
| `version`                                       | Scope version, default `''`, separate from `serviceVersion`. Fixed at construction.                                                                                         |
| `fetch`, `sendBeacon`                           | Fixed platform injection points, primarily for tests.                                                                                                                       |
| Live inputs below                               | Set initial live settings; their current values are read from `otel()`.                                                                                                     |

A random `service.instance.id`, SDK metadata and available low-entropy browser
hints are added to the resource; the raw user agent is not collected. Recreate an
instance to change construction-only inputs. Those fields are absent from the
public writable `OtelOptions` type; no live `resource` option is provided.

### Live settings

| Setting                             | Default and behavior                                                                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`, `headers`, `transports` | Delivery destinations and headers. Native JSON Content-Type is fixed; browser CORS must allow your origin/headers. Extra `Transport` destinations work even with `endpoint: null`.                                                                                                |
| `filter(target)`                    | Select automatic targets; future installation only. Existing target middleware is not removed by changing the filter. Explicit `withOTel` still records. Internal `analytics.*`/`otel.*` names are excluded; private targets are normally skipped, with route-related exceptions. |
| `captureValues`                     | Enabled by default. `false` disables automatic snapshots; `{ redact(key, value) }` transforms before sensitive-key masking. A failing transform can discard a record.                                                                                                             |
| `keepRecords`                       | `false`; enable local retention alongside native export. `endpoint: null` already retains records.                                                                                                                                                                                |
| `localValues`                       | `false`, `true` or `'all'`; [raw local references](#local-records-and-values).                                                                                                                                                                                                    |
| `sampling`                          | `{ ratio: 1, by: 'trace', updates: 1, errors: 'always' }`. Ratios clamp to 0–1. `updates` samples update logs; remote parent flags take precedence. `by: 'session'` shares a tracer-session decision, independent of analytics storage.                                           |
| `roots`                             | `['route', 'mount', 'action', 'atom']`; `[]` disables automatic root machines, while manual roots and app-session fallback remain. The accepted `mount` flag does not implement mount/render profiling.                                                                           |
| `route`                             | `'child'` joins top-level actions to the page; `'link'` creates action traces linked to it.                                                                                                                                                                                       |
| `maxSpansPerTrace`, `maxTraceMs`    | `1000` / `60000` ms; later spans start linked continuation traces. `Infinity` disables a limit.                                                                                                                                                                                   |
| `warnContextLoss`                   | Enabled in development/test (`NODE_ENV`, or `import.meta.env.DEV` when unset). Warns once per target about some missing `wrap` boundaries; not every context loss is detectable.                                                                                                  |
| `consent`                           | Category record, absent by default. Explicit `diagnostics: false` holds diagnostic admission/export and automatic values. Prefer first-applied [withGDPR](#consent-form) for submitted choice binding.                                                                            |
| `signals`                           | `{ traces?, logs? }`, absent means on. A false signal independently blocks it. Public manual logs obey `logs`, while the caller owns category consent.                                                                                                                            |

`consent` and `signals` are live settings, not constructor inputs. Without a
bound form, set them through `otel.set`; omitted fields retain prior values.
With `withGDPR`, the submitted form is the effective category source, so change
the form rather than trying to grant a different policy through the settings.
Omitting GDPR leaves diagnostics enabled. Analytics has a separate denied-by-default
category and [feature switch](#extension-lifecycle).

## Instance members

| Member                                        | Contract                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `otel()`, `otel.set(...)`, `otel.extend(...)` | Ordinary configuration atom operations. Extensions attach optional members to the same atom.                                                                                                                                                                                                     |
| `name`, `instanceName`                        | Native instrumentation name (`otel.shop`) and readonly raw name (`shop`).                                                                                                                                                                                                                        |
| `resource`, `recordLimit`                     | Readonly construction resource snapshot and local record retention capacity.                                                                                                                                                                                                                     |
| `records`                                     | Genuine readonly computed of serialized records; [local inspection](#local-records-and-values). No `.set` or mutable array append.                                                                                                                                                               |
| `stats`                                       | Genuine readonly computed of immutable delivery/capacity snapshots; supports reactive reads/subscriptions. Counters: `active`, `queued`, `inFlight`, `exported`, `dropped`, `droppedByReason`, `beaconAccepted`, `flushTimeouts`, `transportQuarantined`. Runtime also includes `invalidParent`. |
| `disposed`                                    | Readonly computed terminal lifecycle state.                                                                                                                                                                                                                                                      |
| `withOTel(options?)`                          | Target extension; [options below](#target-options).                                                                                                                                                                                                                                              |
| `traceVar`                                    | Frame variable `{ traceId, spanId }`. Set manual/parsed parents inside a frame or scope with `.run(context, callback)`.                                                                                                                                                                          |
| `attributesVar`                               | Frame-scoped explicit domain attributes. `.run(attributes, callback)` supplies a complete owned snapshot for that subtree; [capture timing](#common-attributes).                                                                                                                                 |
| `createTrace({ name?, attributes? }?)`        | Fresh context with a short root; use `traceVar.set(otel.createTrace(...))` inside an action.                                                                                                                                                                                                     |
| `traceparent()`                               | W3C header for active context, or `undefined`; propagation is manual unless explicitly configured.                                                                                                                                                                                               |
| `parseTraceparent(header)`                    | Accepts `string \| null \| undefined`; context or `undefined`. Guard before setting. Malformed headers increment runtime `invalidParent` and warn once in dev; absent headers are silent.                                                                                                        |
| `pageTrace()`                                 | Route root pair or `undefined`; need not be an analytics page trace.                                                                                                                                                                                                                             |
| `localValuesOf(record)`                       | Raw values for a retained record, or `undefined`.                                                                                                                                                                                                                                                |
| `clearRecords()`                              | Native action releasing retained records.                                                                                                                                                                                                                                                        |
| `log(eventName, attributes?)`                 | Native manual-log action; obeys the logs signal. Explicit attributes are not auto-masked; caller owns category/privacy policy.                                                                                                                                                                   |
| `transport(batch)`                            | Native action delivering one batch and fanning out to configured transports.                                                                                                                                                                                                                     |
| `flush()`                                     | Native async action attempting finished records present at invocation, bounded by timeout. Does not await unfinished app actions or guarantee receipt.                                                                                                                                           |
| `dispose()`                                   | Native terminal action stopping observation/features/queues and requesting export abort. Clears local records. Attempt flush first when shutdown delivery matters.                                                                                                                               |

Drop reasons are `capacity`, `oversized`, `disposed`, `export`, `timeout`,
`observation`, `consent`, and optional analytics `rateLimit`. Production export
failures stay out of the application error path; monitor counters and the receiver.

Actions become spans; updates become `reatom.atom.update` /
`reatom.computed.update` logs; core `log` becomes `reatom.log`. Cross-trace computed
dependencies get links. Reatom cause ids retain the state-change graph. Route
match changes create roots; same-route parameter changes need not. Orphan logs
use `app.session`, distinct from analytics sessions. Abort/pending outcomes are
not ordinary application errors.

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

## Common attributes

Import `withAttributes(source)` from `@reatom/opentelemetry/attributes` and apply
it to the SDK. It adds readonly `.attributes`, a projection of the **app-owned**
synchronous computed/reader. The reader returns `Readonly<Record<string,
OtlpAttrValue>> | null`; async readers, undefined results, functions/methods and
per-value null tombstones are unsupported. Use whole-source `null` or `{}` to
express absence. There is no second mutable user/auth store in the SDK.

```ts
import { atom, computed, action, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { withAttributes } from '@reatom/opentelemetry/attributes'

const userId = atom<string | null>(null, 'auth.userId')
const source = computed(() => {
  const id = userId()
  return id === null ? null : { 'user.id': id, 'app.tenant.id': 'shop' }
}, 'auth.telemetry')
const otel = reatomOpentelemetry({
  name: 'shop.attributes',
  endpoint: null,
  serviceName: 'shop-web',
}).extend(withAttributes(source))
const load = action(async () => {
  await wrap(fetch('/api/orders'))
  otel.log('orders.loaded')
}, 'orders.load')
```

The reader is bound to its attachment context. Operation/update admission takes
a complete immutable bounded snapshot, including **empty** identity, so a later
login cannot backfill an anonymous operation. Async completion logs and nested
native HTTP preserve the initiating identity across `wrap`; a source change
only affects future captures. Explicit `attributesVar` scopes use the same
snapshot boundary. Analytics' consented session/page provider composes with this
source; anonymous visitor/session identifiers never become a known user.

Attributes have depth/entry/string/byte budgets (5 / 100 / 2048 / 8192), copied
arrays and binary values, and no shared mutable object references. A source error,
invalid value or exceeded budget omits the **whole common attribute map**, adding
`reatom.attributes_error` with `TypeError` or `RangeError`. Explicit attributes
are not sensitive-key masked: your reader owns privacy/category selection.
Returning null after logout affects future captures, not queued history or
consent revocation. Document measurements preserve application-time identity
across feature toggles; resources snapshot at observer delivery. See
[Faro user projection](#faro-receiver-integration).

## Web analytics

Import `withWebAnalytics(options?)` from `@reatom/opentelemetry/web-analytics` and
apply through `otel.extend(...)`. It adds `.analytics`, a native requested-enable
boolean atom with readonly `.visitor`, `.session`, `.page`, `.attribution`, `.focus`
children and a `.pageView(attributes?)` action. The feature uses its parent's
transport, queues and local record stream. There is no instance-creating overload,
separate `.otel` or separate analytics `.dispose`; use `.setFalse()` to disable
or `otel.dispose()` for terminal teardown. Without `window`, capture is a no-op
with a development warning. See [extension lifecycle](#extension-lifecycle).

| Option                | Default and behavior                                                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `consent`             | By default, effective `otel().consent.analytics === true` (typically from first-applied `withGDPR`). An explicit boolean, atom/reader, `{ analytics: reader }`, or submitted form selects a separate analytics source. Arbitrary readers are reevaluated on activity and may not trigger grants immediately. |
| `autoPageViews`       | `true`. `false` skips the initial automatic view; navigation listeners remain active.                                                                                                                                                                                                                        |
| `errors`              | `true`; listen to window `error` and `unhandledrejection`, deduplicating Error objects already captured by the tracer.                                                                                                                                                                                       |
| `captureErrorDetails` | `false`; type only. `true` adds scrubbed message/stack to analytics errors. Does not alter tracer error capture.                                                                                                                                                                                             |
| `captureQuery`        | `false`; analytics page URLs omit query/hash. `true` includes the full URL in analytics page-view data. General diagnostic page metadata stays query-free.                                                                                                                                                   |
| `persistVisitor`      | `true`; `false` keeps the visitor only in RAM. Session storage continues.                                                                                                                                                                                                                                    |
| `navigation`          | Chosen once: `'urlAtom'` if routes exist, else `'navigation-api'` if available, else `'popstate'`. Fallback foreign `pushState`/`replaceState` requires `pageView()`. Explicit `'urlAtom'` without routes needs router integration; see guide E4.                                                            |
| `storageKey`          | Instance name; visitor/session keys are `<key>.visitor` and `<key>.session`.                                                                                                                                                                                                                                 |
| `sessionTimeout`      | `1800000` ms idle; checked when session state synchronizes, not by a precise expiry timer.                                                                                                                                                                                                                   |
| `perTab`              | `false`: shared localStorage session and storage-event synchronization. `true`: sessionStorage session per tab.                                                                                                                                                                                              |
| `rotateAtMidnight`    | `false`; optional rotation on a new local day.                                                                                                                                                                                                                                                               |
| `attributionParams`   | `utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `yclid`, `fbclid`, `msclkid`. `utm_term`/`utm_content` are additionally captured; alone they do not rotate sessions.                                                                                                                                    |
| `errorSampling`       | `1`; ratio for analytics exceptions only.                                                                                                                                                                                                                                                                    |
| `rateLimit`           | `{ errorsPerMin: 10, eventsPerMin: 60, byName: {} }`. Error cap per signature and named-event cap per name, per page per minute. `byName` overrides a name's cap; `0` means no client cap.                                                                                                                   |

The feature's readonly children are `visitor` (`string | undefined`), `session`
(`{ id?, start?, previousId? }`), `page` (`{ path?, url? }`), `attribution`
(`Attribution`) and `focus` (`boolean`). Use `otel.analytics.session()` or
subscribe to that child; writes belong to the feature lifecycle. `Attribution`
has optional source/medium/campaign/term/content, click ids and custom keys.
`otel.analytics()` reports requested enablement, not permission or browser support.
Use named actions with `withOTel` for operations or caller-consented manual logs;
there is no `trackEvent` method.

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

## Extension lifecycle

All optional factories are inert until native `.extend` applies them left to
right. Applied collectors start eagerly and work without subscribers. Analytics,
console, network, vitals and performance add requested-enable boolean atoms:
`.analytics`, `.browserConsole`, `.browserNetwork`, `.webVitals`, `.browserPerformance`.
They support `.set(boolean)`, `.setTrue()`, `.setFalse()`, `.toggle()` and `.reset()`
(reset requests true). Toggling stops/starts collection synchronously. A true value
does not grant consent, override signal gates or assert browser API support.

Apply GDPR before collectors/capture. Duplicate installation, even while disabled,
and installation on a disposed SDK throw before side effects. Each feature owns
its cleanup and rolls back its own failed setup; earlier extensions in the same
`.extend(...)` call remain applied if a later one fails. `dispose()` is terminal,
sets feature requests false and prevents re-enabling. HMR should dispose the old
SDK and construct a fresh one. There are no public `connect*` compatibility aliases.

## Browser connectors

Each collector has its own explicit optional import and native extension factory;
there is no root barrel export or plugin registry. Missing browser APIs make
capture a no-op. Diagnostics and signal gates control admission/export separately
from the requested-enable switch. Analytics permission is unnecessary for
identity-free diagnostic collection, and does not itself enable diagnostics.

Collectors observe the **whole document/page**. Multiple instances receive their
own records from shared native instrumentation; a widget's instance does not
isolate its network or console activity from the host. Consent and the parent
signal settings apply independently to each subscriber.

### Network

`withBrowserNetworkMonkeypatch({ propagateTraceparent?, ignoreUrl? })` from
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

`withBrowserConsoleMonkeypatch({ levels? })` from
`@reatom/opentelemetry/browser-console` wraps console methods while preserving
native calls. Defaults to `['warn', 'error']`; available levels are `debug`, `info`,
`log`, `warn`, `error`. Emits `reatom.console` logs with `console.level`, severity,
bounded/redacted arguments, and captured Error details when capture is enabled.
Avoid logging sensitive values even with automatic masking.

### Web Vitals

`withWebVitals()` from `@reatom/opentelemetry/web-vitals` uses the official
`web-vitals` **6.2.3** dependency, reachable only through this entry. It records
CLS, FCP, INP, LCP and TTFB as `measurement` logs of type `web-vitals`:

- `measurement.values`: lowercase name plus `delta`, e.g. `{ lcp: 1200, delta: 1200 }`.
- `measurement.unit`: `1` for CLS, `ms` otherwise.
- `web_vital.name` (uppercase), `.id`, `.rating`, `.navigation_type`, `.delta`.

These are document metrics, not a new measurement for each SPA route. Browser
support, upstream reporting and late attachment constrain availability. A shared
collector registers five callbacks per document; it caches only five primitive
measurements and weak subscribers. Disposal stops this instance's reports;
upstream observers may remain until document end. Document metadata is snapshotted when the extension is applied and preserved
across toggles. Apply analytics/common attributes first if measurements need
those joins. Later login/grants do not backfill identity into that snapshot.

### Navigation and resources

`withBrowserPerformance({ navigation?, resources?, ignoreUrl? })` from
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
disconnects observers. Navigation uses extension-application-time document metadata, preserved across toggles; resource
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
import { withBrowserNetworkMonkeypatch } from '@reatom/opentelemetry/browser-network'
import { withBrowserPerformance } from '@reatom/opentelemetry/browser-performance'

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
}).extend(
  withBrowserNetworkMonkeypatch({ ignoreUrl: ignoreCollector }),
  withBrowserPerformance({ ignoreUrl: ignoreCollector }),
)
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
by that metadata, including known-user metadata. `session.start` maps to `session_start`, `app.page_view` to
`view_changed`; `reatom.*` maps to console-style logs; exceptions carry captured
stack text in context, without structured stack frames or automatic symbolication.
Span errors are not duplicated as exception events. Measurements retain trace
links. Web Vitals use lowercase values and Faro context aliases `id`, `rating`,
`navigation_type`; no synthetic `navigation_entry_id` is created. This mapping does
not promise that every existing Faro dashboard consumes the custom measurement
schema unchanged.

Faro user metadata comes only from captured record attributes, never from resource
fallbacks or current auth at flush. `user.id`, `user.name`, `user.email`,
`user.full_name`, `user.hash` map to `meta.user.id`, `username`, `email`, `fullName`,
`hash`. A nonempty `user.roles` array of nonempty comma-free strings maps to a
comma-separated roles string. Invalid roles are omitted from metadata while the
typed record attributes remain. User metadata participates in envelope grouping,
so records from distinct principals cannot share an envelope just because their
page/session match. Anonymous visitor/session ids are not projected as users.

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

Import `withGDPR` and standalone `reatomGDPR` from `@reatom/opentelemetry/gdpr`.
`otel.extend(withGDPR(optionsOrForm?))` adds `.gdpr`. Apply it **first**, before
collectors or any capture; late installation rejects. The initial denied offered
categories are established before consent-form construction; the caller must
apply this extension before constructing/capturing application models. Late binding cannot
retroactively protect earlier capture.

`withGDPR()` creates exactly the default `reatomGDPR()` form: diagnostics,
analytics and marketing all false. A supplied `categories` object is the exact
schema, e.g. `{ analytics: false }` leaves diagnostics unoffered and unaffected.
Draft fields do not grant permission: edit `otel.gdpr.fields.analytics.change(true)`
and call `otel.gdpr.submit()` when the visitor saves. Only submitted/restored
`snapshot` categories are effective. `withWebAnalytics()` reads that effective
analytics category by default; explicit analytics `consent` opts into another source.

`withGDPR(sharedForm)` accepts an existing app-owned form, including one shared
across SDKs. SDK disposal removes its binding/subscription; it does not dispose
the shared form. The standalone form has no `otel` or `instances` option.

`reatomGDPR(options?)` options are `name` (default `'consent'`), `categories`
(default three false categories), and `persist` (`true`, `false`, or a key string).
The default key is `reatom.gdpr.<name>`. Restored submitted choices populate
`snapshot`, an atom of `null` or `{ submitted: true, categories }`. Storage
unavailability uses Reatom's memory fallback. Submit persists the snapshot and
the SDK binding updates category settings; it never rewrites app-owned signal
switches. No diagnostics category means no diagnostics denial. The form remembers
a choice, not a visitor identity; it is not a banner UI or identifier-erasure API.

## Helpers and exported types

- `checkSensitiveNames(otel, { patterns? }?)`: development name warnings for future targets while value capture is enabled. Accepts a RegExp or array; returns a cleanup function. It neither changes capture nor redacts data. Install before model definitions and call the cleanup on teardown.
- `readServerTimingTraceparent()`: reads `traceparent` from the first navigation entry's Server-Timing description, or `undefined`. Parse and guard before setting a frame parent.
- `formatServerTimingTraceparent(header)`: produces `traceparent;desc="..."` for a server response. Pass a valid traceparent value. Cross-origin timing visibility needs the server's timing policy.
- Root exported types: `ReatomOpentelemetry`, `ReatomOpentelemetryInput`, `OtelOptions`, `SpanKind`, `OtlpAttrValue`, `LocalValues`, `LocalValuesMode`, `TelemetryStats`, `CheckSensitiveNamesOptions`, `Transport`, `TransportBatch`, `TransportResult`.
- Analytics types: `WebAnalytics`, `WebAnalyticsOptions`, `AnalyticsPage`, `AnalyticsSession`, `Attribution`, `NavigationSource`.
- `/attributes` exports `TelemetryAttributeSource`. Other optional entries export `BrowserNetworkOptions`, `BrowserConsoleOptions`, `ConsoleLevel`, `BrowserPerformanceOptions`, `FaroTransportOptions`; GDPR exports `DEFAULT_GDPR_CATEGORIES`, `GdprCategories`, `GdprConsentSnapshot`, `ReatomGDPR`, `ReatomGDPROptions`.

## Current boundaries

The package has no session replay, source-map upload/symbolication service,
error-grouping UI, arbitrary DOM named actions, frustration/rage-click/scroll/form
analytics, CSP or long-task collector, experiment/e-commerce schema, automatic
title/referrer/viewport enrichment, automatic login/logout identity stitching,
native OTLP metrics, durable offline storage, managed Faro session parity,
cross-tab/worker trace propagation, or automatic mount/render profiling.
Session storage synchronization across tabs is distinct from trace propagation.
`withAttributes` and scoped attributes can carry app-owned user/tenant metadata;
the application still owns authentication, identity lifecycle and policy. These are current boundaries, not a roadmap.
