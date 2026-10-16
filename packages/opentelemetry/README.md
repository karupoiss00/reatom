# @reatom/opentelemetry

OpenTelemetry tracing for [Reatom](https://www.reatom.dev). v2 reads the
async context Reatom already keeps (`traceVar` on the frame): `wrap` preserves
the trace the same way it preserves Reatom context. No OpenTelemetry SDK, no
`fetch` patch, no `@reatom/core` changes.

The long explainer (consent, CORS, widgets, HMR, GDPR / 152-ФЗ, launch
checklist) is the draft guide
[`docs/src/content/docs/guides/opentelemetry.md`](../../docs/src/content/docs/guides/opentelemetry.md)
(docs site `/docs/guides/opentelemetry`, unreleased).

The packages are **not published**. Measured sizes, brotli without
`@reatom/core`: tracer **15.17 kB**, `gdpr` **432 B**, analytics delta
**4.26 kB** against a **4.5 KB** honest gate. Spec А1 (~3 KB) is missed
by 1.26 kB. Combined tracer+analytics is **18.82 kB** against **19 KB**.

## Install

The package is not on npm yet. Inside this monorepo, depend on the workspace
package: `"@reatom/opentelemetry": "workspace:*"`. After the release it will be
`npm install @reatom/opentelemetry`.

Use one shared copy of `@reatom/core`. `name` is required. Analytics is a
separate entry: `@reatom/opentelemetry/web-analytics`, not the root barrel.

## Quick start

```ts
import { wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})

export const analytics = connectWebAnalytics(otel)
// omitted consent ≡ false: no analytics OTLP and no identity storage until submit

import.meta.hot?.dispose(() => {
  analytics.dispose()
  otel.dispose()
})

await wrap(import('./app.ts'))
```

Two live widgets on one page need two instances with two `name`s (`host` and
`widget`). A second live instance with the same name replaces the first.

`endpoint: null` is local-only (`records()`). A string must be an absolute
`http:` or `https:` URL; a relative path such as `/otel` throws when the
instance is created. The instance posts `/v1/traces` and `/v1/logs`. The
collector must allow your origin (CORS).

`localValues` is `false` by default. `true` or `'all'` keeps plain references
to params, payload, state, and errors beside records that stay on the page
(`endpoint: null` or `keepRecords`). Read them with `otel.localValuesOf(record)`.
They are never masked and never enter the OTLP body. `true` still skips a
target with `withOTel({ captureValues: false })`; `'all'` keeps those too.
Instance `captureValues: false`, redaction, and consent do not apply to this
side channel.

Outgoing `traceparent` is explicit:
`otel.traceparent()` on allowlisted origins (your collector or API). Do not
send it to third parties, and do not patch `fetch`. APIs that receive the
header must allow it in CORS.

`skipGlobalExtension: true` turns off automatic action spans and automatic
atom/computed update logs. Explicit `withOTel()` still records.
`withOTel({ attributes, captureValues, serialize, enabled })` applies to that
target. Names starting with `analytics.` or `otel.` are left out of automatic
observation. Development warnings follow `NODE_ENV` of `development` or
`test`, or `import.meta.env.DEV` when `NODE_ENV` is unset; production and a
bundle with neither signal stay quiet.

## Entries

| Import                                | What                      |
| ------------------------------------- | ------------------------- |
| `@reatom/opentelemetry`               | `reatomOpentelemetry`     |
| `@reatom/opentelemetry/web-analytics` | `connectWebAnalytics`     |
| `@reatom/opentelemetry/gdpr`          | `reatomGDPR` consent form |

Omitted consent is `false`. Analytics stores nothing and sends nothing before
the visitor **submits** a choice. `submit()` writes `consent` and does not
rewrite `signals`. Explicit `diagnostics: false` holds tracer export. A form
with no diagnostics field does not. Until that submit, attaching `reatomGDPR`
leaves the tracer exporting. An instance with no consent form stays fully on.
Tick-only drafts are not consent. `signals.logs: false` also stops `otel.log`.

ClickHouse is the guaranteed logs query backend (e2e proves spans, logs and
`reatom.cause.ids` land there via the contrib exporter). Do not point logs at
Jaeger.

## Testing

```sh
pnpm --filter @reatom/opentelemetry test
pnpm --filter @reatom/opentelemetry test:e2e:collector:oracle
pnpm --filter @reatom/opentelemetry test:e2e:clickhouse
```

The [Collector E2E guide](./e2e/collector/README.md) covers isolation, the
v2 `traceVar` / `wrap` model, and ClickHouse queries.
