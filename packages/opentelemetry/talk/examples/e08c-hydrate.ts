import { action } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})

export const continueServerTrace = action(() => {
  const meta = document.querySelector('meta[name="traceparent"]')
  const remote = otel.parseTraceparent(meta?.getAttribute('content'))
  if (remote) otel.traceVar.set(remote)
}, 'app.continueServerTrace')
