import type { ReatomOpentelemetry, Transport } from '../src/index.ts'
import { faroTransport, logMeasurement } from '../src/faro/index.ts'

declare const otel: ReatomOpentelemetry
const transport: Transport = faroTransport({
  endpoint: 'https://faro.test/collect',
})
void transport
logMeasurement(otel, { type: 'checkout', values: { duration_ms: 12 } })
// @ts-expect-error Measurement values must be numeric.
logMeasurement(otel, { type: 'checkout', values: { duration_ms: '12' } })
// @ts-expect-error Explicit measurement type is required.
logMeasurement(otel, { values: { duration_ms: 12 } })
