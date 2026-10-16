import { action, context } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const serverOtel = reatomOpentelemetry({
  name: 'shop-ssr',
  endpoint: 'http://collector.internal:4318',
  serviceName: 'shop-ssr',
  skipGlobalExtension: true,
})

const renderProductPage = action(
  (path: string) => ({ path, traceparent: serverOtel.traceparent() ?? '' }),
  'ssr.renderProduct',
).extend(serverOtel.withOTel({ kind: 'server' }))

export const handleRequest = (request: Request) =>
  context.start(() => {
    const render = action(() => {
      const incoming = serverOtel.parseTraceparent(request.headers.get('traceparent'))
      if (incoming) serverOtel.traceVar.set(incoming)
      return renderProductPage(new URL(request.url).pathname)
    }, 'ssr.request')
    return render()
  })
