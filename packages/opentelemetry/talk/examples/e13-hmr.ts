import { reatomOpentelemetry } from '@reatom/opentelemetry'

type HotModule = { dispose: (callback: () => void) => void }

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: null,
  serviceName: 'shop-web',
  environment: 'development',
})

const hot = (import.meta as ImportMeta & { hot?: HotModule }).hot
hot?.dispose(() => otel.dispose())
