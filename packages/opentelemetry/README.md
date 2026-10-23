# @reatom/opentelemetry

Capture Reatom actions, state updates and application logs locally, then add
OpenTelemetry export when you need a backend. Traces follow Reatom's existing async context through `wrap`; cause ids
connect the exported activity to local inspection in [Reatom admin](../admin/README.md).
Add consented page/session analytics or browser diagnostics through explicit,
independent imports.

**Unreleased:** this package is not published to npm. In this monorepo use
`"@reatom/opentelemetry": "workspace:*"` and one shared `@reatom/core` dependency.

- [API reference](./API.md): every instance, target, analytics and connector option, privacy boundary, transport and helper.
- [Worked guide](../../docs/src/content/docs/guides/opentelemetry.md): eighteen scenarios covering routing, consent, widgets, async work, SSR and debugging. The docs-site guide remains a draft.
- [Collector E2E guide](./e2e/collector/README.md): local receiver setup and ClickHouse queries.

## Quick start

`reatomOpentelemetry` returns a native settings atom: read `otel()`, update with
`otel.set(...)`, and compose optional capabilities with `.extend(with...)`.
Its `records`, `stats` and `disposed` children are readonly observables; commands
are native actions. Install before defining application models; earlier targets need explicit
`.extend(otel.withOTel())`.

```ts
import { action, atom, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'shop',
  serviceName: 'shop-web',
  serviceVersion: '1.0.0',
  environment: 'production',
})

const saved = atom(false, 'cart.saved')
export const saveCart = action(async () => {
  const response = await wrap(fetch('/api/cart', { method: 'POST' }))
  if (!response.ok) throw new Error(`Save failed: HTTP ${response.status}`)
  saved.set(true)
}, 'cart.save')

import.meta.hot?.dispose(() => otel.dispose())
```

Actions become spans, atom/computed updates become logs, and core `log` calls
become `reatom.log`. Use `await wrap(promise)` inside async Reatom work and
`wrap(callback)` for platform callbacks. For a larger application, initialize the
instance, then `await wrap(import('./app.ts'))` so imported models are observed.

The root SDK is **local-only by default**. Only `name` and `serviceName` are
required; no endpoint or delivery worker is installed. `records()` exposes safe
canonical records for Admin/debugging, with plain attribute maps, millisecond
timestamps and string span kinds/statuses. Automatic bounded value snapshots
remain typed; OTLP wire formatting happens only in the exporter.

Add an exporter explicitly when needed:

```ts
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { withOTLP } from '@reatom/opentelemetry/otlp'

const otel = reatomOpentelemetry({
  name: 'shop.export',
  serviceName: 'shop-web',
}).extend(withOTLP({ endpoint: 'https://shop.example/otel' }))

otel.otlp.set((current) => ({ ...current, headers: { 'x-tenant': 'shop' } }))
const capture = otel.stats()
const delivery = otel.otlp.stats()
```

`withOTLP` owns destinations, batching, retry, wire encoding and unload delivery.
The endpoint must be absolute HTTP(S); it appends `/v1/traces` and `/v1/logs`.
Configure receiver CORS for your origin. `endpoint: null` is valid only with a
nonempty custom transport list; it does not select a fake successful exporter.
Local retention defaults on (`keepRecords: true`), independent of export.
`recordLimit` bounds retained records and `maxActive` bounds unfinished capture
operations, both 1000 by default. `otel.stats()` reports capture; use
`otel.otlp.stats()` for delivery. See the [reference](./API.md#delivery-and-transports).

Distinct instance names have separate capture runtimes and trace variables; the
same name replaces/disposes the previous instance. One optional exporter owns
shared delivery queues across that instance's Reatom roots. Isolated roots have
local record views; the default/Admin view aggregates records.

## Choose the data you need

Optional factories are inert until applied through native `.extend`. Applied
collectors start eagerly, even without UI/Admin subscribers. Import only the
features you use; the root never imports these optional entries.

| Import suffix          | Extension and added member                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/otlp`                | `withOTLP(input)` → `otel.otlp`: optional export settings, delivery stats and transport action                     |
| `/web-analytics`       | `withWebAnalytics(options?)` → `otel.analytics`: page views, sessions, engagement, attribution and window errors   |
| `/gdpr`                | `withGDPR(optionsOrForm?)` → `otel.gdpr`: submitted consent form; standalone `reatomGDPR` is also exported         |
| `/attributes`          | `withAttributes(source)` → readonly `otel.attributes`: common user/tenant/domain attributes from app state         |
| `/browser-network`     | `withBrowserNetworkMonkeypatch(options?)` → `otel.browserNetwork`: fetch/XHR CLIENT spans and optional propagation |
| `/browser-console`     | `withBrowserConsoleMonkeypatch(options?)` → `otel.browserConsole`: console logs, default warn/error                |
| `/web-vitals`          | `withWebVitals()` → `otel.webVitals`: CLS, FCP, INP, LCP and TTFB                                                  |
| `/browser-performance` | `withBrowserPerformance(options?)` → `otel.browserPerformance`: native navigation/resource timing measurements     |
| `/faro`                | `faroTransport`, `logMeasurement`: receiver transport and log-derived measurements                                 |

```ts
import { withOTLP } from '@reatom/opentelemetry/otlp'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { withBrowserConsoleMonkeypatch } from '@reatom/opentelemetry/browser-console'
import { withBrowserNetworkMonkeypatch } from '@reatom/opentelemetry/browser-network'
import { withBrowserPerformance } from '@reatom/opentelemetry/browser-performance'
import { withGDPR } from '@reatom/opentelemetry/gdpr'
import { withWebAnalytics } from '@reatom/opentelemetry/web-analytics'
import { withWebVitals } from '@reatom/opentelemetry/web-vitals'

const otel = reatomOpentelemetry({
  name: 'shop.browser',
  serviceName: 'shop-web',
}).extend(
  withGDPR({ categories: { analytics: false } }),
  withOTLP({
    endpoint: 'https://shop.example/otel',
  }),
  withWebAnalytics(),
  withBrowserNetworkMonkeypatch({
    propagateTraceparent: ['https://api.shop.example'],
  }),
  withBrowserConsoleMonkeypatch({ levels: ['warn', 'error'] }),
  withWebVitals(),
  withBrowserPerformance(),
)

// Analytics is requested on, but remains consent-denied until form submission.
otel.browserConsole.setFalse()
otel.browserConsole.setTrue()
import.meta.hot?.dispose(() => otel.dispose())
```

Analytics and browser feature members are boolean atoms expressing **requested
enablement**, with `.set`, `.setTrue`, `.setFalse`, `.toggle` and `.reset`.
Toggling applies synchronously; it does not grant consent or override signal
switches. Missing browser APIs make collection a no-op. Duplicate extension
application throws before installing effects, even if the existing feature is
disabled. Disposal is terminal: dispose the old instance and create a fresh one
for HMR. See [lifecycle details](./API.md#extension-lifecycle).

Network and console capture observe the whole page. Widget instances do not
isolate native requests or console calls. Network propagation defaults off,
preserves existing headers and accepts exact origins or a full-URL predicate.
Configure API CORS for `traceparent`. Captured URLs omit credentials/query/hash;
no headers or bodies are recorded. Only one context can be injected into a
request. Built-in OTLP/Faro destinations are excluded; custom transports need
explicit URL exclusions in both [network and performance collection](./API.md#excluding-custom-collectors).

Apply analytics and common attributes before document measurements when joins
matter. Web Vitals and navigation capture document identity when their extension
is applied and preserve it across toggles; later login or consent changes do not
relabel those document measurements. HTTP spans use request-start identity;
resource timings use observer-delivery identity. Vitals describe a document,
not each SPA route. See [schemas and timing](./API.md#browser-connectors).

## Consent and captured identity

Without GDPR, diagnostics remain available for development and Admin. Analytics
requires an effective analytics grant. Apply `withGDPR` **first**, before other
collectors or the first capture, when you need category control from startup:

```ts
import { withOTLP } from '@reatom/opentelemetry/otlp'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { withGDPR } from '@reatom/opentelemetry/gdpr'
import { withWebAnalytics } from '@reatom/opentelemetry/web-analytics'

const otel = reatomOpentelemetry({
  name: 'shop.consent',
  serviceName: 'shop-web',
}).extend(
  withGDPR(),
  withOTLP({
    endpoint: 'https://shop.example/otel',
  }),
  withWebAnalytics(),
)

const consent = otel.gdpr
// Render consent.fields.* and call consent.submit() when the choice is saved.
```

No-argument `withGDPR()` creates the default form with diagnostics, analytics and
marketing initially false. Draft fields do not grant permission; only the
submitted snapshot applies. A supplied `categories` object is the exact offered
schema: `{ analytics: false }` gates analytics and leaves diagnostics available.
`withWebAnalytics()` uses the effective analytics category by default; an explicit
`consent` option selects a separate source. A shared app-owned `reatomGDPR` form
can also be passed to `withGDPR(form)`. SDK disposal unbinds it without disposing
the form. Late GDPR attachment rejects; it cannot retroactively protect captures.
See the [full consent contract](./API.md#consent-form).

Use an app-owned computed to bind known-user or tenant metadata. The SDK does
not create a second auth store:

```ts
import { atom, computed } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { withAttributes } from '@reatom/opentelemetry/attributes'

type User = { id: string; name: string; roles: string[] }
const signedInUser = atom<User | null>(null, 'auth.user')
const userAttributes = computed(() => {
  const user = signedInUser()
  return user
    ? { 'user.id': user.id, 'user.name': user.name, 'user.roles': user.roles }
    : null
}, 'auth.telemetryAttributes')
const otel = reatomOpentelemetry({
  name: 'shop.identity',
  serviceName: 'shop-web',
}).extend(withAttributes(userAttributes))
```

Complete immutable attribute snapshots are taken at admission, including an
empty source. An async operation keeps the identity that started it even after
login/logout changes. Returning `null` affects future captures; it does not erase
queued history or revoke export permission. Analytics visitor/session identifiers
stay separate from known-user identity. See [attribute timing and Faro mapping](./API.md#common-attributes).

Automatic values are bounded/redacted snapshots. Disable with `captureValues:
false` or customize per target. Explicit common/domain/manual attributes require
caller-owned privacy and category policy; `otel.log` and `logMeasurement` obey the
logs signal but do not supply that policy. `localValues` is a separate,
default-off debugging channel of raw live references beside retained records,
never masked/exported and independent of capture/redaction/consent. See
[local values](./API.md#local-records-and-values).

## Self-hosted Faro receiver

Use a receiver that speaks the Faro JSON protocol alongside an OTLP backend or
as your only export destination:

```ts
import { withOTLP } from '@reatom/opentelemetry/otlp'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { faroTransport, logMeasurement } from '@reatom/opentelemetry/faro'

const otel = reatomOpentelemetry({
  name: 'shop.faro',
  serviceName: 'shop-web',
  serviceVersion: '1.0.0',
  environment: 'development',
}).extend(
  withOTLP({
    endpoint: null,
    transports: [faroTransport({ endpoint: 'http://localhost:12347/collect' })],
  }),
)

// Invoke only when your measurement's category policy allows it.
logMeasurement(otel, {
  type: 'checkout',
  values: { duration_ms: 120, items: 3 },
  context: { currency: 'EUR' },
})
```

The endpoint is an exact absolute collection URL; no suffix is appended.
Measurements are logs with finite numeric values, not OTLP metrics or Prometheus
instruments. The bridge groups captured app/user/session/page metadata and maps events,
logs, measurements, exceptions and traces. HTTP 202 is required; invalid session
responses require application-owned rotation. The
[protocol and delivery reference](./API.md#faro-receiver-integration) covers
headers, deadlines, unload limits and custom schemas.

This Alloy route is a starting point for self-hosted Loki/Tempo:

```alloy
faro.receiver "browser" {
  log_format = "json"
  server {
    listen_address = "0.0.0.0"
    listen_port = 12347
    cors_allowed_origins = ["https://shop.example"]
  }
  output {
    logs = [loki.write.local.receiver]
    traces = [otelcol.exporter.otlp.tempo.input]
  }
}

loki.write "local" {
  endpoint { url = "http://loki:3100/loki/api/v1/push" }
}

otelcol.exporter.otlp "tempo" {
  client {
    endpoint = "tempo:4317"
    tls { insecure = true }
  }
}
```

Configure your production ingress, HTTPS, origin and access controls. This recipe
follows [Alloy's receiver documentation](https://grafana.com/docs/alloy/latest/reference/components/faro/faro.receiver/)
and has not been validated against a running receiver here. Managed Grafana Cloud
Frontend Observability is unverified; this bridge does not implement its session
lifecycle. Custom measurement schemas may need custom panels.

Other backends use `withOTLP`, the `/otlp` entry's `otlpTransport`, or a custom `Transport`. With
multiple destinations, the first controls queue accounting; additional
transports are best effort without independent retries. Native endpoint exports
retry up to three times. Queues are in memory, including offline holds; unload
and beacon are best effort. See [delivery](./API.md#delivery-and-transports).

## Bundle cost

Measured **2026-10-24**, built package entries, esbuild minified ES2022 and
Node gzip/Brotli defaults, with only `@reatom/core` external:

| Selected imports     | minified bytes | gzip bytes | Brotli bytes |
| -------------------- | -------------: | ---------: | -----------: |
| Local capture root   |         51,403 |     18,910 |       17,255 |
| Root + OTLP exporter |         73,864 |     26,741 |       24,161 |

Local capture and export are separate import graphs. The root does not include
the OTLP worker, protocol encoding, retry or unload delivery; `/otlp` adds those
capabilities. Optional entry bundles are not additive costs: shared code changes
the combined bundle.

Reproduce with `pnpm --filter @reatom/opentelemetry test:bundles`. The check builds
40 source/dist graphs using esbuild minified ES2022, with only `@reatom/core`
external, and reports raw/gzip/Brotli bytes. These are download sizes, not runtime
speed measurements. Separate size-limit checks use their configured method and
unchanged budgets; a passing import-graph check does not imply every size budget
passes. The current separate size-limit checks exceed the root, GDPR, analytics and
combined caps; Faro remains within its cap. Those configured checks use a
different method from this esbuild table. Historical pre-split measurements are preserved in the
[design investigation](./design/size-reduction.md).

## Verification and boundaries

```sh
pnpm --filter @reatom/opentelemetry test
pnpm --filter @reatom/opentelemetry test:types
pnpm --filter @reatom/opentelemetry test:browser
pnpm --filter @reatom/opentelemetry test:bundles
```

See the [current boundaries](./API.md#current-boundaries) for unsupported features,
including replay, symbolication, automatic login linking, mount/render profiling,
native metrics and durable offline delivery. The guide's scenarios show how to
combine the existing features with routing, consent and your backend.
