import { connectBrowserNetwork } from '../src/browser-network/index.ts'
import { connectBrowserConsole } from '../src/browser-console/index.ts'
import type { ReatomOpentelemetry } from '../src/index.ts'
import { connectBrowserPerformance } from '../src/browser-performance/index.ts'
import { connectWebVitals } from '../src/web-vitals/index.ts'

export const verifyMetrics = (otel: ReatomOpentelemetry) => {
  connectBrowserNetwork(otel, {
    propagateTraceparent: ['https://api.example.test'],
  }).dispose()
  connectBrowserConsole(otel, { levels: ['warn', 'error'] }).dispose()
  // @ts-expect-error Propagation requires an explicit origin list or URL predicate.
  connectBrowserNetwork(otel, { propagateTraceparent: true })
  // @ts-expect-error Console capture only supports named console levels.
  connectBrowserConsole(otel, { levels: ['trace'] })
  connectWebVitals(otel).dispose()
  connectBrowserPerformance(otel, {
    navigation: true,
    resources: false,
    ignoreUrl: (url) => url.pathname === '/custom-collector',
  }).dispose()
  // @ts-expect-error Web Vitals has no configuration registry.
  connectWebVitals(otel, { enabled: true })
  // @ts-expect-error resources must be a boolean.
  connectBrowserPerformance(otel, { resources: 'all' })
  // @ts-expect-error URL exclusion must be a URL predicate.
  connectBrowserPerformance(otel, { ignoreUrl: ['https://collector.test'] })
  // @ts-expect-error replay is outside the timing connector.
  connectBrowserPerformance(otel, { replay: true })
}
