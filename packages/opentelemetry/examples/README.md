# OpenTelemetry reference snippet

Copy `with-tracing.ts` into an application that depends on `@reatom/core` and
`@reatom/opentelemetry`. This directory remains a reference snippet, with no
standalone package or server. It uses the adapter's context and export pipeline.

```ts
import { createTracedCounter } from './with-tracing.ts'

const counter = createTracedCounter({
  name: 'counter-app',
  endpoint: 'https://collector.example.com',
  serviceName: 'counter-app',
})

// Call in the application's current Reatom context.
const result = counter.update()
console.log(result.count, result.doubled, result.context)

const gate = Promise.resolve()
console.log(await counter.updateAfter(gate))

// Before shutting down; flush completion is not a delivery guarantee.
await counter.flush()
counter.dispose()
```

`example.update` is a root action span with `example.increment` as its child.
The counter write and the `example.double` computed read are ordinary Reatom
work; repeated cached reads emit nothing.

`example.updateAfter` is the async form. The trace lives in `otel.traceVar`, a
Reatom frame variable, so `await wrap(wait)` preserves it together with the
store and cancellation scope. The resumed `example.increment` is a child of
`example.updateAfter` without any extra context API.

To start a trace by hand, call `otel.traceVar.set(otel.createTrace({ name }))`
inside an action. To read the current pair, call `otel.traceVar.get()`.
