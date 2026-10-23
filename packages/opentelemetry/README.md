# @reatom/opentelemetry

Connect Reatom actions, state updates and application logs to an OpenTelemetry
backend. Traces follow Reatom's existing async context through `wrap`; cause ids
connect the exported activity to local inspection in [Reatom admin](../admin/README.md).
Add consented page/session analytics or browser diagnostics through explicit,
independent imports.

**Unreleased:** this package is not published to npm. In this monorepo use
`"@reatom/opentelemetry": "workspace:*"` and one shared `@reatom/core` dependency.

- [API reference](./API.md): every instance, target, analytics and connector option, privacy boundary, transport and helper.
- [Worked guide](../../docs/src/content/docs/guides/opentelemetry.md): eighteen scenarios covering routing, consent, widgets, async work, SSR and debugging. The docs-site guide remains a draft.
- [Collector E2E guide](./e2e/collector/README.md): local receiver setup and ClickHouse queries.

## Quick start

Install before defining application models; earlier targets need explicit
`.extend(otel.withOTel())`.

```ts
import { action, atom, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
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

`name`, `endpoint` and `serviceName` are required. The endpoint must be absolute
HTTP(S); native export appends `/v1/traces` and `/v1/logs`. Configure receiver CORS
for your origin. `endpoint: null` enables local inspection; explicit custom
transports can still export. `keepRecords: true` keeps local records beside an
endpoint. Distinct instance names have separate context/queues; the same name
replaces and disposes its previous instance, including connectors.

## Choose the data you need

| Import suffix          | API and purpose                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| root                   | `reatomOpentelemetry`, tracing, local records, OTLP transport and helpers                 |
| `/web-analytics`       | `connectWebAnalytics`: page views, sessions, engagement, attribution and window errors    |
| `/gdpr`                | `reatomGDPR`: submitted category-choice snapshot                                          |
| `/browser-network`     | `connectBrowserNetwork`: fetch/XHR CLIENT spans; optional allowlisted propagation         |
| `/browser-console`     | `connectBrowserConsole`: console logs, default warn/error                                 |
| `/web-vitals`          | `connectWebVitals`: CLS, FCP, INP, LCP, TTFB via official `web-vitals`                    |
| `/browser-performance` | `connectBrowserPerformance`: native navigation/resource timing measurements               |
| `/faro`                | `faroTransport`, `logMeasurement`: Faro receiver integration and log-derived measurements |

There is no plugin registry or root re-export of optional collectors. Import only
what you use. No patches install until you call a connector. Each returns
`{ dispose() }`, follows parent disposal and replaces a prior connector of its
kind on that parent. Missing browser APIs produce a no-op. Network and console
instrumentation observe the whole page, so separate widget instances do not
isolate the page's native requests or console calls.

```ts
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { connectBrowserConsole } from '@reatom/opentelemetry/browser-console'
import { connectBrowserNetwork } from '@reatom/opentelemetry/browser-network'
import { connectBrowserPerformance } from '@reatom/opentelemetry/browser-performance'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'
import { connectWebVitals } from '@reatom/opentelemetry/web-vitals'
import { atom } from '@reatom/core'

const analyticsAllowed = atom(false, 'consent.analyticsAllowed')
const otel = reatomOpentelemetry({
  name: 'shop.browser',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})
const analytics = connectWebAnalytics(otel, { consent: analyticsAllowed })
connectBrowserNetwork(otel, {
  propagateTraceparent: ['https://api.shop.example'],
})
connectBrowserConsole(otel, { levels: ['warn', 'error'] })
connectWebVitals(otel)
connectBrowserPerformance(otel, { navigation: true, resources: true })

import.meta.hot?.dispose(() => otel.dispose())
```

Connect analytics before collectors when consented session/page joins matter.
Web Vitals and navigation timings snapshot metadata at attachment; a later grant
will not add identity to that snapshot. HTTP spans use request-start metadata;
resource timings use observer-delivery metadata. Web Vitals describe the document,
not every SPA route. See [schemas and lifecycle](./API.md#browser-connectors).

Network propagation defaults off, preserves an existing header, and accepts exact
origins or a predicate over the full resolved URL. Configure API CORS for
`traceparent`. Captured network URLs omit credentials, query and fragment, and no
request headers/bodies are recorded. Multiple collectors can record a request;
only one context can be propagated. Custom collector URLs need explicit exclusions
from network/performance collection; see the
[combined example](./API.md#excluding-custom-collectors). Built-in OTLP and Faro
endpoints are excluded automatically.

## Consent and captured values

Analytics defaults to denied: it emits no analytics records or stored identity
until allowed. Diagnostics are independent and **default on**. An unsubmitted
`reatomGDPR` form does not disable them. To require an explicit diagnostics grant,
set the gate before defining models or attaching connectors:

```ts
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { reatomGDPR } from '@reatom/opentelemetry/gdpr'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

const otel = reatomOpentelemetry({
  name: 'shop.consent',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})
otel.options.set((current) => ({
  ...current,
  consent: { diagnostics: false },
}))
const consent = reatomGDPR({ name: 'shop-choice', otel })
const analytics = connectWebAnalytics(otel, { consent })
// Render consent.fields.*; call consent.submit() when the choice is saved.
```

The form reads its submitted snapshot, not checkbox drafts, and leaves app-owned
`signals` switches unchanged. `signals.logs: false` also stops public `otel.log`.
Manual logs and `logMeasurement` require caller-owned category consent and
attribute privacy. Revocation stops analytics identity use; it does not erase
previously stored identifiers. See the [full consent contract](./API.md#consent-form).

Automatic values are bounded/redacted snapshots by default. Disable with
`captureValues: false` or customize per target with `withOTel`. Explicit log and
domain attributes are not automatically masked. `localValues` is a separate,
default-off debugging channel: raw live references beside retained records,
never masked/exported and independent of capture/redaction/consent. Read them
with `localValuesOf(record)`; enable deliberately. See
[local values](./API.md#local-records-and-values).

## Self-hosted Faro receiver

Use a receiver that speaks the Faro JSON protocol alongside an OTLP backend or
as your only export destination:

```ts
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { faroTransport, logMeasurement } from '@reatom/opentelemetry/faro'

const otel = reatomOpentelemetry({
  name: 'shop.faro',
  serviceName: 'shop-web',
  serviceVersion: '1.0.0',
  environment: 'development',
  endpoint: null,
  transports: [faroTransport({ endpoint: 'http://localhost:12347/collect' })],
})

// Invoke only when your measurement's category policy allows it.
logMeasurement(otel, {
  type: 'checkout',
  values: { duration_ms: 120, items: 3 },
  context: { currency: 'EUR' },
})
```

The endpoint is an exact absolute collection URL; no suffix is appended.
Measurements are logs with finite numeric values, not OTLP metrics or Prometheus
instruments. The bridge groups captured app/session/page metadata and maps events,
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

Other OTLP backends use `endpoint`, `otlpTransport`, or a custom `Transport`. With
multiple destinations, the first controls queue accounting; additional
transports are best effort without independent retries. Native endpoint exports
retry up to three times. Queues are in memory, including offline holds; unload
and beacon are best effort. See [delivery](./API.md#delivery-and-transports).

## Bundle cost

Measurements on **2026-10-23**, esbuild minified ES2022 built package-entry builds with
`@reatom/core` external, bytes compressed with gzip/Brotli. These exclude the core
peer dependency and application code; they are bundle sizes, not runtime speed
measurements. Connector rows are **increments over root**, not standalone totals.

| Selected imports                             | gzip bytes | Brotli bytes |
| -------------------------------------------- | ---------: | -----------: |
| Root                                         |     22,921 |       20,727 |
| Root + analytics                             |     27,570 |       24,785 |
| Analytics increment                          |      4,649 |        4,058 |
| Network increment                            |      1,685 |            — |
| Console increment                            |        543 |            — |
| Web Vitals increment, including `web-vitals` |      3,544 |            — |
| Performance increment                        |        791 |            — |

Reproduce: `pnpm --filter @reatom/opentelemetry test:bundles` (builds and checks
source/dist import graphs). Optional imports stay outside root bundles.

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
