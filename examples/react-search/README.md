# Reatom search component example

An example showing how to implement an interactive search component with Reatom and React.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/reatom/reatom/tree/v1001/examples/react-search)

## Telemetry

`src/setup.ts` creates a named `reatomOpentelemetry` instance (`search`) and optional `connectWebAnalytics`. Analytics stay off until the visitor ticks Analytics and clicks **Save preferences**. Omitted consent is `false`: nothing analytics-related is stored or sent before that submit.

Set `VITE_OTEL_ENDPOINT` to an absolute OTLP/HTTP collector URL (no `/v1/traces` suffix) to export traces and logs. Leave it unset for local-only `records()` (the header hint in dev). `setup.ts` passes this instance to `reatomGDPR`. The banner offers analytics only, so Save does not hold search traces. Analytics stays off until Save.

GitHub search stays a `CLIENT` span locally. `traceparent` is attached only for allowlisted origins (this page and `VITE_OTEL_ENDPOINT`); `api.github.com` is never on that list.

```sh
VITE_OTEL_ENDPOINT=https://collector.example.com pnpm --filter reatom-react-search dev
```
